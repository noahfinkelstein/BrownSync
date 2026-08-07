import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class OrganizationEditConflictREDTests: XCTestCase {
    func testVersionedEditPatchDistinguishesOmittedFieldsFromExplicitClear()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "updateOrganization": [
                    .json(200, Phase4Fixture.editJSON()),
                    .json(
                        200,
                        Phase4Fixture.editJSON(
                            revision: 4,
                            changed: false
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let patch = OrganizationEditPatchIntent(
            description: .set("Updated description"),
            aboutMarkdown: .clear,
            meetingInformation: .unchanged,
            links: .unchanged
        )

        let outcome = try await repository.update(
            organizationID: Phase4Fixture.organizationID,
            baseline: Phase4Fixture.baselineProfile,
            expectedRevision: 3,
            patch: patch
        )
        let replayed = try await repository.update(
            organizationID: Phase4Fixture.organizationID,
            baseline: Phase4Fixture.baselineProfile,
            expectedRevision: 3,
            patch: patch
        )

        XCTAssertEqual(
            outcome,
            .updated(
                organizationID: Phase4Fixture.organizationID,
                revision: 4,
                changed: true
            )
        )
        XCTAssertEqual(
            replayed,
            .updated(
                organizationID: Phase4Fixture.organizationID,
                revision: 4,
                changed: false
            )
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["updateOrganization", "updateOrganization"]
        )
        let request = try phase4JSONObject(records[0].body)
        XCTAssertEqual(request["version"] as? Int, 2)
        XCTAssertEqual(request["expectedRevision"] as? Int, 3)
        let encodedPatch = try XCTUnwrap(
            request["patch"] as? [String: Any]
        )
        XCTAssertEqual(
            Set(encodedPatch.keys),
            ["description", "aboutMd"],
            "Unchanged fields must be omitted, not encoded as null."
        )
        let descriptionCommand = try XCTUnwrap(
            encodedPatch["description"] as? [String: Any]
        )
        XCTAssertEqual(descriptionCommand["action"] as? String, "set")
        XCTAssertEqual(
            descriptionCommand["value"] as? String,
            "Updated description"
        )
        let clearCommand = try XCTUnwrap(
            encodedPatch["aboutMd"] as? [String: Any]
        )
        XCTAssertEqual(clearCommand["action"] as? String, "clear")
        XCTAssertNil(
            clearCommand["value"],
            "The generated-representable clear command normalizes server-side to legacy explicit null."
        )
    }

    func testEmptyEditPatchFailsBeforeTheGeneratedOperation() async {
        let transport = Phase4OrganizationTransport()
        let repository = makeRepository(transport: transport)
        let patch = OrganizationEditPatchIntent(
            description: .unchanged,
            aboutMarkdown: .unchanged,
            meetingInformation: .unchanged,
            links: .unchanged
        )

        do {
            _ = try await repository.update(
                organizationID: Phase4Fixture.organizationID,
                baseline: Phase4Fixture.baselineProfile,
                expectedRevision: 3,
                patch: patch
            )
            XCTFail("Expected an empty-patch error.")
        } catch {
            XCTAssertEqual(
                error as? OrganizationOwnershipError,
                .emptyEditPatch
            )
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testRevisionConflictRefetchesLatestAndBuildsFieldReviewWithoutRetry()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "updateOrganization": [
                    .json(409, Phase4Fixture.conflictJSON)
                ]
            ]
        )
        let publicRepository = Phase4PublicOrganizationRepositoryFake(
            profile: Phase4Fixture.latestProfile
        )
        let repository = makeRepository(
            transport: transport,
            publicOrganizations: publicRepository
        )
        let patch = OrganizationEditPatchIntent(
            description: .set("My proposed description"),
            aboutMarkdown: .unchanged,
            meetingInformation: .set("Mondays at 5"),
            links: .unchanged
        )

        let outcome = try await repository.update(
            organizationID: Phase4Fixture.organizationID,
            baseline: Phase4Fixture.baselineProfile,
            expectedRevision: 3,
            patch: patch
        )

        guard case let .conflict(review) = outcome else {
            return XCTFail("Expected a field-level conflict review.")
        }
        XCTAssertEqual(review.organizationID, Phase4Fixture.organizationID)
        XCTAssertEqual(review.expectedRevision, 3)
        XCTAssertEqual(review.latestRevision, 4)
        XCTAssertEqual(
            review.fields.map(\.field),
            [.description, .meetingInformation]
        )
        XCTAssertEqual(
            review.fields[0].baselineText,
            "Original description"
        )
        XCTAssertEqual(
            review.fields[0].submittedText,
            "My proposed description"
        )
        XCTAssertEqual(
            review.fields[0].latestText,
            "Someone else's description"
        )
        XCTAssertEqual(
            review.fields[1].baselineText,
            "Mondays at 5"
        )
        XCTAssertEqual(
            review.fields[1].submittedText,
            "Mondays at 5"
        )
        XCTAssertEqual(
            review.fields[1].latestText,
            "Tuesdays at 6"
        )

        let operationRecords = await transport.records()
        XCTAssertEqual(
            operationRecords.map(\.operationID),
            ["updateOrganization"],
            "A conflict must not trigger a blind PATCH retry."
        )
        let profileCalls = await publicRepository.calls()
        XCTAssertEqual(
            profileCalls,
            [
                .init(
                    id: Phase4Fixture.organizationID,
                    at: nil,
                    policy: .reload
                )
            ]
        )
    }

    func testConflictCompositionStoresOnlySafeProfileInPublicDiskCache()
        async throws
    {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "brownsync-phase4-public-cache-\(UUID().uuidString)",
                isDirectory: true
            )
        defer { try? FileManager.default.removeItem(at: directory) }
        let protectedEvidence = "PHASE4-SECRET-EVIDENCE-SENTINEL"
        let transport = Phase4OrganizationTransport(
            responses: [
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.claimID,
                                    protectedEvidence,
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    )
                ],
                "updateOrganization": [
                    .json(409, Phase4Fixture.conflictJSON)
                ],
                "getOrganizationProfile": [
                    .json(200, Phase4Fixture.latestProfileJSON)
                ],
            ]
        )
        let client = BrownSyncAPI.Client(
            serverURL: URL(string: "https://api.brownsync.invalid")!,
            configuration: WorkerAPIClientDefaults.configuration,
            transport: transport
        )
        let publicRepository = WorkerOrganizationRepository(
            client: client,
            cache: PublicResponseCache(
                directory: directory,
                schemaVersion: 1
            ),
            now: { Phase4Fixture.baseDate }
        )
        let repository = WorkerOrganizationOwnershipRepository(
            client: client,
            publicOrganizations: publicRepository,
            logger: Phase4OwnershipLogRecorder()
        )
        _ = try await repository.reviewPage(after: nil, limit: 50)

        _ = try await repository.update(
            organizationID: Phase4Fixture.organizationID,
            baseline: Phase4Fixture.baselineProfile,
            expectedRevision: 3,
            patch: OrganizationEditPatchIntent(
                description: .set("My proposed description"),
                aboutMarkdown: .unchanged,
                meetingInformation: .unchanged,
                links: .unchanged
            )
        )

        let publicBytes = try recursivelyReadFiles(in: directory)
        let publicCacheText = String(decoding: publicBytes, as: UTF8.self)
        XCTAssertFalse(publicCacheText.contains(protectedEvidence))
        XCTAssertFalse(publicCacheText.contains("claimantHandle"))
        XCTAssertFalse(publicCacheText.contains("reviewNote"))
        XCTAssertTrue(
            publicCacheText.contains("Brown Lecture Board"),
            "The safe public profile may still use the Phase 2 cache."
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "listReviewableOrganizationClaims",
                "updateOrganization",
                "getOrganizationProfile",
            ]
        )
    }

    private func makeRepository(
        transport: Phase4OrganizationTransport,
        publicOrganizations: any OrganizationRepository =
            Phase4PublicOrganizationRepositoryFake()
    ) -> WorkerOrganizationOwnershipRepository {
        WorkerOrganizationOwnershipRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(
                    string: "https://api.brownsync.invalid"
                )!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            publicOrganizations: publicOrganizations,
            logger: Phase4OwnershipLogRecorder()
        )
    }

    private func recursivelyReadFiles(in directory: URL) throws -> Data {
        guard
            let enumerator = FileManager.default.enumerator(
                at: directory,
                includingPropertiesForKeys: [.isRegularFileKey]
            )
        else {
            return Data()
        }
        var result = Data()
        for case let fileURL as URL in enumerator {
            let values = try fileURL.resourceValues(
                forKeys: [.isRegularFileKey]
            )
            if values.isRegularFile == true {
                result.append(try Data(contentsOf: fileURL))
            }
        }
        return result
    }
}
