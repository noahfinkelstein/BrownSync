import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class UserEventRepositoryREDTests: XCTestCase {
    func testPersonalCreateUsesOneGeneratedUUIDAndCanonicalPlaceOnly()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "createUserEvent": [
                    .json(
                        201,
                        Phase5UserEventFixture.createResultJSON(
                            replayed: false
                        )
                    )
                ]
            ]
        )
        let uuids = Phase5UUIDSequence([Phase5UserEventFixture.requestID])
        let repository = makeRepository(
            transport: transport,
            uuids: uuids
        )

        let submission = await repository.prepareCreate(
            Phase5UserEventFixture.personalDraft()
        )
        let outcome = try await repository.create(submission)

        XCTAssertEqual(
            outcome,
            .created(
                eventID: Phase5UserEventFixture.eventID,
                revision: 0
            )
        )
        let uuidRequestCount = await uuids.requestCount()
        XCTAssertEqual(uuidRequestCount, 1)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["createUserEvent"])
        XCTAssertEqual(records.first?.method, "POST")
        XCTAssertEqual(records.first?.path, "/api/events")
        let body = try phase5UserEventJSONObject(records[0].body)
        XCTAssertEqual(
            body["clientRequestId"] as? String,
            Phase5UserEventFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(body["placeId"] as? String, "salomon-center")
        XCTAssertNil(body["locationRaw"])
        XCTAssertNil(
            body["organizationId"],
            "Generated nil omission must be accepted and normalized to null by the additive create-contract prerequisite."
        )
        XCTAssertNil(body["description"])
        XCTAssertNil(body["end"])
        XCTAssertNil(body["url"])

        let forbidden = Set([
            "actorId",
            "createdBy",
            "source",
            "role",
            "status",
            "moderationState",
            "revision",
            "lat",
            "lng",
            "latitude",
            "longitude",
            "coordinates",
            "accuracy",
            "altitude",
            "speed",
            "course",
        ])
        XCTAssertTrue(
            phase5UserEventAllJSONKeys(body).isDisjoint(with: forbidden)
        )
    }

    func testExplicitRetryReusesSubmissionUUIDAndMapsCreateReplay()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "createUserEvent": [
                    .json(
                        201,
                        Phase5UserEventFixture.createResultJSON(
                            replayed: false
                        )
                    ),
                    .json(
                        201,
                        Phase5UserEventFixture.createResultJSON(
                            replayed: true
                        )
                    ),
                ]
            ]
        )
        let uuids = Phase5UUIDSequence([Phase5UserEventFixture.requestID])
        let repository = makeRepository(
            transport: transport,
            uuids: uuids
        )
        let submission = await repository.prepareCreate(
            Phase5UserEventFixture.organizationDraft()
        )

        let created = try await repository.create(submission)
        let replayed = try await repository.create(submission)

        XCTAssertEqual(
            created,
            .created(
                eventID: Phase5UserEventFixture.eventID,
                revision: 0
            )
        )
        XCTAssertEqual(
            replayed,
            .replayed(
                eventID: Phase5UserEventFixture.eventID,
                revision: 0
            )
        )
        let uuidRequestCount = await uuids.requestCount()
        XCTAssertEqual(uuidRequestCount, 1)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["createUserEvent", "createUserEvent"]
        )
        let first = try phase5UserEventJSONObject(records[0].body)
        let second = try phase5UserEventJSONObject(records[1].body)
        XCTAssertEqual(
            first["clientRequestId"] as? String,
            second["clientRequestId"] as? String
        )
        XCTAssertEqual(first["organizationId"] as? String, "brown-band")
        XCTAssertEqual(second["organizationId"] as? String, "brown-band")
        XCTAssertNil(first["organizationName"])
        XCTAssertNil(first["role"])
        XCTAssertNil(first["actorId"])
    }

    func testManagementDetailUsesGeneratedOperationAndMapsOrganizationOwner()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "getMyUserEvent": [
                    .json(
                        200,
                        Phase5UserEventFixture.managementJSON(
                            organizationID: "brown-band",
                            organizationName: "Brown Band"
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let event = try await repository.detail(
            eventID: Phase5UserEventFixture.eventID
        )

        XCTAssertEqual(
            event.owner,
            .organization(id: "brown-band", name: "Brown Band")
        )
        XCTAssertEqual(event.canonicalPlaceID, "salomon-center")
        XCTAssertEqual(event.status, .published)
        XCTAssertEqual(event.moderationState, .active)
        XCTAssertEqual(event.revision, 2)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["getMyUserEvent"])
        XCTAssertEqual(
            records.first?.path,
            "/api/me/events/40000000-0000-4000-8000-000000000001"
        )
        XCTAssertTrue(records.first?.body.isEmpty == true)
    }

    func testCancelIsBodylessRevisionFreeAndIdempotent() async throws {
        let transport = Phase5UserEventTransport(
            responses: [
                "deleteUserEvent": [
                    .json(
                        200,
                        Phase5UserEventFixture.mutationResultJSON(
                            revision: 3,
                            changed: true
                        )
                    ),
                    .json(
                        200,
                        Phase5UserEventFixture.mutationResultJSON(
                            revision: 3,
                            changed: false
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let changed = try await repository.cancel(
            eventID: Phase5UserEventFixture.eventID
        )
        let replayed = try await repository.cancel(
            eventID: Phase5UserEventFixture.eventID
        )

        XCTAssertEqual(
            changed,
            UserEventMutationOutcome(
                eventID: Phase5UserEventFixture.eventID,
                revision: 3,
                changed: true
            )
        )
        XCTAssertEqual(
            replayed,
            UserEventMutationOutcome(
                eventID: Phase5UserEventFixture.eventID,
                revision: 3,
                changed: false
            )
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["deleteUserEvent", "deleteUserEvent"]
        )
        XCTAssertTrue(records.allSatisfy { $0.method == "DELETE" })
        XCTAssertTrue(records.allSatisfy(\.body.isEmpty))
        XCTAssertTrue(
            records.allSatisfy {
                $0.path
                    == "/api/events/40000000-0000-4000-8000-000000000001"
            }
        )
    }

    func testURLPolicyMatchesLiteralContractHTTPSAndHostRules() {
        let accepted = [
            "https://events.example",
            "https://events.example/path?source=brownsync#details",
            "https://user:password@events.example:8443/path",
        ]
        let rejected = [
            "HTTPS://events.example",
            "Https://events.example",
            "https://",
            "https:///path-only",
            "https://?query-only",
            "http://events.example",
            " https://events.example",
        ]

        for value in accepted {
            XCTAssertNotNil(UserEventHTTPSURL.parse(value), value)
        }
        for value in rejected {
            XCTAssertNil(UserEventHTTPSURL.parse(value), value)
        }
    }

    func testCreateAndEditRejectContractInvalidURLBeforeNetwork()
        async
    {
        let transport = Phase5UserEventTransport()
        let repository = makeRepository(transport: transport)
        let invalidURL = URL(string: "HTTPS://events.example")!
        let draft = UserEventCreateDraft(
            owner: .personal,
            title: "Campus software study break",
            description: nil,
            start: Phase5UserEventFixture.start,
            end: nil,
            category: .social,
            url: invalidURL,
            canonicalPlaceID: "salomon-center"
        )
        let submission = await repository.prepareCreate(draft)

        do {
            _ = try await repository.create(submission)
            XCTFail("Expected local create URL validation.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .invalidInput
            )
        }

        let patch = UserEventEditPatchIntent(
            title: .unchanged,
            description: .unchanged,
            start: .unchanged,
            end: .unchanged,
            category: .unchanged,
            url: .set(invalidURL),
            canonicalPlaceID: .unchanged
        )
        do {
            _ = try await repository.update(
                eventID: Phase5UserEventFixture.eventID,
                baseline: Phase5UserEventFixture.baselineEvent,
                expectedRevision: 2,
                patch: patch
            )
            XCTFail("Expected local edit URL validation.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .invalidInput
            )
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testCreateBadRequestSurfacesAsNonRetryableInputFailure()
        async
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "createUserEvent": [
                    .json(
                        400,
                        """
                        {
                          "error":{
                            "code":"bad_request",
                            "message":"Event request rejected."
                          }
                        }
                        """
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let submission = await repository.prepareCreate(
            Phase5UserEventFixture.personalDraft()
        )

        do {
            _ = try await repository.create(submission)
            XCTFail("Expected an input failure.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .invalidInput
            )
            let presentation = UserEventFailurePresentation.make(
                for: error
            )
            XCTAssertEqual(presentation.title, "Check event details")
            XCTAssertNil(presentation.retryLabel)
        }
    }

    func testManagementResponseRejectsNonLiteralHTTPSURL() async {
        let transport = Phase5UserEventTransport(
            responses: [
                "getMyUserEvent": [
                    .json(
                        200,
                        Phase5UserEventFixture.managementJSON(
                            url: "HTTPS://events.example"
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.detail(
                eventID: Phase5UserEventFixture.eventID
            )
            XCTFail("Expected an invalid protected response.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .invalidResponse
            )
        }
    }

    private func makeRepository(
        transport: Phase5UserEventTransport,
        uuids: any UUIDProviding = Phase5UUIDSequence(
            [Phase5UserEventFixture.requestID]
        )
    ) -> WorkerUserEventRepository {
        WorkerUserEventRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(
                    string: "https://api.brownsync.invalid"
                )!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            retrier: .withoutAuthenticationRetry,
            uuidProvider: uuids
        )
    }
}
