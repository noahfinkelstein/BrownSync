import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class UserEventPaginationREDTests: XCTestCase {
    func testProtectedReadsRefreshOnceAfterUnauthorized() async throws {
        let transport = Phase5UserEventTransport(
            responses: [
                "listMyUserEvents": [
                    .json(401, Phase5UserEventFixture.unauthorizedJSON),
                    .json(
                        200,
                        Phase5UserEventFixture.pageJSON(
                            events: [],
                            next: nil
                        )
                    ),
                ],
                "getMyUserEvent": [
                    .json(401, Phase5UserEventFixture.unauthorizedJSON),
                    .json(
                        200,
                        Phase5UserEventFixture.managementJSON()
                    ),
                ],
            ]
        )
        let session = Phase5UserEventRefreshSession()
        let repository = makeRepository(
            transport: transport,
            retrier: WorkerRequestRetrier(session: session)
        )

        _ = try await repository.page(before: nil, limit: 25)
        _ = try await repository.detail(
            eventID: Phase5UserEventFixture.eventID
        )

        let refreshCount = await session.refreshCount()
        XCTAssertEqual(refreshCount, 2)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "listMyUserEvents",
                "listMyUserEvents",
                "getMyUserEvent",
                "getMyUserEvent",
            ]
        )
    }

    func testNullableNextStopsAndPreservesDescendingServerOrder()
        async throws
    {
        let firstCursorTimestamp = "2026-07-30T16:02:00.000Z"
        let transport = Phase5UserEventTransport(
            responses: [
                "listMyUserEvents": [
                    .json(
                        200,
                        Phase5UserEventFixture.pageJSON(
                            events: [
                                Phase5UserEventFixture.managementJSON(
                                    title: "Newest personal event",
                                    updatedAt: firstCursorTimestamp
                                )
                            ],
                            next: (
                                firstCursorTimestamp,
                                Phase5UserEventFixture.eventID
                            )
                        )
                    ),
                    .json(
                        200,
                        Phase5UserEventFixture.pageJSON(
                            events: [
                                Phase5UserEventFixture.managementJSON(
                                    id: Phase5UserEventFixture.secondEventID,
                                    organizationID: "brown-band",
                                    organizationName: "Brown Band",
                                    title: "Older organization event",
                                    updatedAt:
                                        "2026-07-30T16:01:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let events = try await repository.allManageableEvents()

        XCTAssertEqual(
            events.map(\.id),
            [
                Phase5UserEventFixture.eventID,
                Phase5UserEventFixture.secondEventID,
            ]
        )
        XCTAssertEqual(
            events.map(\.title),
            ["Newest personal event", "Older organization event"]
        )
        XCTAssertEqual(
            events.map(\.owner),
            [
                .personal,
                .organization(id: "brown-band", name: "Brown Band"),
            ]
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["listMyUserEvents", "listMyUserEvents"]
        )
        let first = try queryItems(in: records[0].path)
        XCTAssertEqual(first["limit"], "50")
        XCTAssertNil(first["beforeUpdatedAt"])
        XCTAssertNil(first["beforeEventId"])
        let second = try queryItems(in: records[1].path)
        XCTAssertEqual(second["limit"], "50")
        XCTAssertNotNil(second["beforeUpdatedAt"])
        XCTAssertEqual(
            second["beforeEventId"],
            Phase5UserEventFixture.eventID.uuidString.lowercased()
        )
    }

    func testManagementCursorAlwaysSendsTimestampAndEventIDTogether()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "listMyUserEvents": [
                    .json(
                        200,
                        Phase5UserEventFixture.pageJSON(
                            events: [],
                            next: nil
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let cursor = UserEventManagementCursor(
            beforeUpdatedAt: try isoDate(
                "2026-07-30T16:01:00.000Z"
            ),
            beforeEventID: Phase5UserEventFixture.eventID
        )

        _ = try await repository.page(before: cursor, limit: 25)

        let records = await transport.records()
        let query = try queryItems(in: records[0].path)
        XCTAssertNotNil(query["beforeUpdatedAt"])
        XCTAssertEqual(
            query["beforeEventId"],
            Phase5UserEventFixture.eventID.uuidString.lowercased()
        )
        XCTAssertEqual(query["limit"], "25")
    }

    func testRequestedPageSizeIsCappedAtOneHundred() async throws {
        let transport = Phase5UserEventTransport(
            responses: [
                "listMyUserEvents": [
                    .json(
                        200,
                        Phase5UserEventFixture.pageJSON(
                            events: [],
                            next: nil
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        _ = try await repository.allManageableEvents(pageSize: 500)

        let records = await transport.records()
        let query = try queryItems(in: records[0].path)
        XCTAssertEqual(query["limit"], "100")
    }

    func testNonPositivePageSizeFailsBeforeNetwork() async {
        let transport = Phase5UserEventTransport()
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.allManageableEvents(pageSize: 0)
            XCTFail("Expected an invalid page-size error.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .invalidPageSize
            )
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    private func makeRepository(
        transport: Phase5UserEventTransport,
        retrier: WorkerRequestRetrier = .withoutAuthenticationRetry
    ) -> WorkerUserEventRepository {
        WorkerUserEventRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(
                    string: "https://api.brownsync.invalid"
                )!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            retrier: retrier,
            uuidProvider: Phase5UUIDSequence(
                [Phase5UserEventFixture.requestID]
            )
        )
    }

    private func isoDate(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]
        return try XCTUnwrap(formatter.date(from: value))
    }

    private func queryItems(in path: String) throws -> [String: String] {
        let components = try XCTUnwrap(
            URLComponents(string: "https://example.invalid\(path)")
        )
        return Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map {
                ($0.name, $0.value ?? "")
            }
        )
    }
}

private actor Phase5UserEventRefreshSession: SessionProviding {
    private var refreshes = 0

    func exchangeGoogleIdentity(
        _: GoogleIdentityTokenPair
    ) async throws {}

    func validAccessToken() async throws -> String {
        "phase-5-user-event-token"
    }

    func refreshSession() async throws {
        refreshes += 1
    }

    func signOutLocal() async throws {}

    nonisolated func authEvents() async -> AsyncStream<AuthSessionEvent> {
        AsyncStream { $0.finish() }
    }

    func refreshCount() -> Int {
        refreshes
    }
}
