import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class OrganizationOwnershipRepositoryREDTests: XCTestCase {
    func testAccessUsesGeneratedListOperationAndMapsOnlyOwnSafeRows()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listMyOrganizations": [
                    .json(200, Phase4Fixture.myOrganizationsJSON)
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let snapshot = try await repository.access()

        XCTAssertEqual(snapshot.memberships.count, 1)
        XCTAssertEqual(
            snapshot.memberships[0].organizationID,
            "brown-lecture-board"
        )
        XCTAssertEqual(snapshot.memberships[0].role, .owner)
        XCTAssertEqual(snapshot.claims.count, 1)
        XCTAssertEqual(snapshot.claims[0].status, .pending)
        XCTAssertNil(snapshot.claims[0].reviewNote)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["listMyOrganizations"])
        XCTAssertEqual(records.first?.path, "/api/me/organizations")
        XCTAssertTrue(records.first?.body.isEmpty == true)
    }

    func testCreateMapsFreshAndIdempotentlyReplayedOutcomes()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "createOrganization": [
                    .json(201, Phase4Fixture.createdOrganizationJSON),
                    .json(201, Phase4Fixture.replayedOrganizationJSON),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let draft = OrganizationCreateDraft(
            name: "BrownSync Builders",
            description: "Campus software.",
            aboutMarkdown: nil,
            meetingInformation: "Wednesdays at 6",
            links: [
                OrganizationLink(
                    platform: .website,
                    url: URL(string: "https://example.edu/builders")!,
                    label: nil
                )
            ]
        )

        let created = try await repository.create(draft)
        let replayed = try await repository.create(draft)

        XCTAssertEqual(created.organizationID, "brownsync-builders")
        XCTAssertEqual(created.revision, 0)
        XCTAssertEqual(created.role, .owner)
        XCTAssertEqual(created.disposition, .created)
        XCTAssertEqual(replayed.revision, 1)
        XCTAssertEqual(replayed.disposition, .replayed)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["createOrganization", "createOrganization"]
        )
        XCTAssertEqual(records.map(\.method), ["POST", "POST"])
        XCTAssertEqual(records.map(\.path), ["/api/orgs", "/api/orgs"])
        let body = try phase4JSONObject(records[0].body)
        XCTAssertEqual(body["name"] as? String, "BrownSync Builders")
        XCTAssertNil(body["id"])
        XCTAssertNil(body["actorId"])
        XCTAssertNil(body["adminRole"])
    }

    func testClaimMapsAutoApprovedPendingAndReplayStatesExactly()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "claimOrganization": [
                    .json(
                        200,
                        Phase4Fixture.claimJSON(
                            disposition: "auto_approved",
                            role: "owner",
                            claimID: Phase4Fixture.claimID
                        )
                    ),
                    .json(
                        200,
                        Phase4Fixture.claimJSON(
                            disposition: "pending",
                            role: nil,
                            claimID: Phase4Fixture.claimID
                        )
                    ),
                    .json(
                        200,
                        Phase4Fixture.claimJSON(
                            disposition: "already_admin",
                            role: "editor",
                            claimID: nil
                        )
                    ),
                    .json(
                        200,
                        Phase4Fixture.claimJSON(
                            disposition: "already_pending",
                            role: nil,
                            claimID: Phase4Fixture.claimID
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let autoApproved = try await repository.claim(
            organizationID: Phase4Fixture.organizationID,
            evidence: "Elected president"
        )
        let pending = try await repository.claim(
            organizationID: Phase4Fixture.organizationID,
            evidence: "Elected president"
        )
        let alreadyAdmin = try await repository.claim(
            organizationID: Phase4Fixture.organizationID,
            evidence: "Elected president"
        )
        let replayed = try await repository.claim(
            organizationID: Phase4Fixture.organizationID,
            evidence: "Elected president"
        )

        XCTAssertEqual(
            autoApproved,
            .autoApproved(role: .owner, claimID: Phase4Fixture.claimID)
        )
        XCTAssertEqual(
            pending,
            .pending(claimID: Phase4Fixture.claimID)
        )
        XCTAssertEqual(alreadyAdmin, .alreadyAdmin(role: .editor))
        XCTAssertEqual(
            replayed,
            .replayedPending(claimID: Phase4Fixture.claimID)
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            Array(repeating: "claimOrganization", count: 4)
        )
        XCTAssertTrue(
            records.allSatisfy {
                $0.path
                    == "/api/orgs/brown-lecture-board/claims"
            }
        )
        let body = try phase4JSONObject(records[0].body)
        XCTAssertEqual(body["evidence"] as? String, "Elected president")
        XCTAssertNil(body["role"])
        XCTAssertNil(body["status"])
    }

    func testReviewPageUsesGeneratedOperationAndMapsProtectedEvidence()
        async throws
    {
        let createdAt = Date(
            timeIntervalSince1970: 1_785_369_660
        )
        let transport = Phase4OrganizationTransport(
            responses: [
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.claimID,
                                    "Elected president",
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: (
                                createdAt,
                                Phase4Fixture.claimID
                            )
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let page = try await repository.reviewPage(
            after: nil,
            limit: 50
        )

        XCTAssertEqual(page.claims.map(\.claimID), [Phase4Fixture.claimID])
        XCTAssertEqual(page.claims.map(\.evidence), ["Elected president"])
        XCTAssertEqual(page.claims.map(\.claimantHandle), ["student"])
        XCTAssertEqual(page.next?.afterClaimID, Phase4Fixture.claimID)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["listReviewableOrganizationClaims"]
        )
        XCTAssertEqual(
            records[0].path,
            "/api/me/org-claims/reviewable?limit=50"
        )
    }

    func testDecisionMapsApprovedRejectedAndIdempotentResultsExactly()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "decideOrganizationClaim": [
                    .json(200, Phase4Fixture.decisionJSON()),
                    .json(
                        200,
                        Phase4Fixture.decisionJSON(
                            status: "rejected",
                            grantedRole: nil,
                            changed: false
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let approved = try await repository.decideClaim(
            claimID: Phase4Fixture.claimID,
            approve: true,
            note: "Verified roster"
        )
        let replayedRejection = try await repository.decideClaim(
            claimID: Phase4Fixture.claimID,
            approve: false,
            note: nil
        )

        XCTAssertEqual(approved.claimID, Phase4Fixture.claimID)
        XCTAssertEqual(approved.status, .approved)
        XCTAssertEqual(approved.grantedRole, .editor)
        XCTAssertTrue(approved.changed)
        XCTAssertEqual(replayedRejection.claimID, Phase4Fixture.claimID)
        XCTAssertEqual(replayedRejection.status, .rejected)
        XCTAssertNil(replayedRejection.grantedRole)
        XCTAssertFalse(replayedRejection.changed)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["decideOrganizationClaim", "decideOrganizationClaim"]
        )
        XCTAssertEqual(
            records.first?.path,
            "/api/org-claims/20000000-0000-4000-8000-000000000001/decision"
        )
        let body = try phase4JSONObject(records[0].body)
        XCTAssertEqual(body["approve"] as? Bool, true)
        XCTAssertEqual(body["note"] as? String, "Verified roster")
        XCTAssertNil(body["claimId"])
        XCTAssertNil(body["role"])
        let replayBody = try phase4JSONObject(records[1].body)
        XCTAssertEqual(replayBody["approve"] as? Bool, false)
        XCTAssertNil(replayBody["note"])
    }

    func testProtectedMutationErrorSurfacesWithoutAutomaticRetry()
        async
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "claimOrganization": [
                    .json(503, Phase4Fixture.unavailableJSON)
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.claim(
                organizationID: Phase4Fixture.organizationID,
                evidence: "Elected president"
            )
            XCTFail("Expected the protected mutation failure.")
        } catch {
            XCTAssertEqual(error as? APIError, .unavailable)
        }

        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["claimOrganization"])
    }

    private func makeRepository(
        transport: Phase4OrganizationTransport,
        publicOrganizations: any OrganizationRepository =
            Phase4PublicOrganizationRepositoryFake(),
        logger: any OrganizationOwnershipLogSink =
            Phase4OwnershipLogRecorder()
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
            logger: logger
        )
    }
}
