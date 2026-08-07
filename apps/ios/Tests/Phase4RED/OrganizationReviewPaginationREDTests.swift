import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class OrganizationReviewPaginationREDTests: XCTestCase {
    func testNullableNextTerminatesAndPreservesServerOrderAcrossPages()
        async throws
    {
        let firstCreatedAt = try isoDate(
            "2026-07-30T00:01:00.000Z"
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
                                    "First evidence",
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: (
                                firstCreatedAt,
                                Phase4Fixture.claimID
                            )
                        )
                    ),
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.nextClaimID,
                                    "Second evidence",
                                    "2026-07-30T00:02:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        let claims = try await repository.allReviewableClaims()

        XCTAssertEqual(
            claims.map(\.claimID),
            [Phase4Fixture.claimID, Phase4Fixture.nextClaimID]
        )
        XCTAssertEqual(
            claims.map(\.evidence),
            ["First evidence", "Second evidence"]
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            Array(
                repeating: "listReviewableOrganizationClaims",
                count: 2
            )
        )
        let firstQuery = try queryItems(in: records[0].path)
        XCTAssertEqual(firstQuery["limit"], "50")
        XCTAssertNil(firstQuery["afterCreatedAt"])
        XCTAssertNil(firstQuery["afterClaimId"])

        let secondQuery = try queryItems(in: records[1].path)
        XCTAssertEqual(secondQuery["limit"], "50")
        XCTAssertEqual(
            secondQuery["afterClaimId"],
            Phase4Fixture.claimID.uuidString.lowercased()
        )
        XCTAssertNotNil(secondQuery["afterCreatedAt"])
    }

    func testCursorAlwaysSendsTimestampAndClaimIDTogether() async throws {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [],
                            next: nil
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let cursor = OrganizationClaimCursor(
            afterCreatedAt: try isoDate(
                "2026-07-30T00:01:00.000Z"
            ),
            afterClaimID: Phase4Fixture.claimID
        )

        _ = try await repository.reviewPage(
            after: cursor,
            limit: 25
        )

        let records = await transport.records()
        let query = try queryItems(in: records[0].path)
        XCTAssertNotNil(query["afterCreatedAt"])
        XCTAssertEqual(
            query["afterClaimId"],
            Phase4Fixture.claimID.uuidString.lowercased()
        )
        XCTAssertEqual(query["limit"], "25")
    }

    func testRequestedPageSizeIsCappedAtOneHundred() async throws {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [],
                            next: nil
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        _ = try await repository.allReviewableClaims(pageSize: 500)

        let records = await transport.records()
        let query = try queryItems(in: records[0].path)
        XCTAssertEqual(query["limit"], "100")
    }

    func testNonPositivePageSizeFailsBeforeNetwork() async {
        let transport = Phase4OrganizationTransport()
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.allReviewableClaims(pageSize: 0)
            XCTFail("Expected an invalid page-size error.")
        } catch {
            XCTAssertEqual(
                error as? OrganizationOwnershipError,
                .invalidReviewPageSize
            )
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testRepeatedCursorFailsClosedWithoutLoopingForever()
        async throws
    {
        let repeatedCreatedAt = try isoDate(
            "2026-07-30T00:01:00.000Z"
        )
        let repeatedCursor = (
            repeatedCreatedAt,
            Phase4Fixture.claimID
        )
        let transport = Phase4OrganizationTransport(
            responses: [
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [],
                            next: repeatedCursor
                        )
                    ),
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [],
                            next: repeatedCursor
                        )
                    ),
                ]
            ]
        )
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.allReviewableClaims()
            XCTFail("Expected a repeated cursor to fail closed.")
        } catch {
            XCTAssertEqual(error as? APIError, .invalidResponse)
        }

        let records = await transport.records()
        XCTAssertEqual(records.count, 2)
    }

    private func makeRepository(
        transport: Phase4OrganizationTransport
    ) -> WorkerOrganizationOwnershipRepository {
        WorkerOrganizationOwnershipRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(
                    string: "https://api.brownsync.invalid"
                )!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            publicOrganizations:
                Phase4PublicOrganizationRepositoryFake(),
            logger: Phase4OwnershipLogRecorder()
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
