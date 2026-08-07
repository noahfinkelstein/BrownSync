import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class OrganizationOwnershipSecurityREDTests: XCTestCase {
    func testSignedOutAndAuthenticatingStatesNeverCallProtectedOperation()
        async
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listMyOrganizations": [
                    .json(200, Phase4Fixture.myOrganizationsJSON)
                ]
            ]
        )
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: makeRepository(transport: transport),
            cache: cache
        )

        await viewModel.activate(authState: .signedOut)
        XCTAssertEqual(viewModel.state, .authenticationRequired)
        await viewModel.activate(authState: .authenticating)
        XCTAssertEqual(viewModel.state, .authenticationRequired)

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testAdmittedStateLoadsOnlyThroughProtectedRepository()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listMyOrganizations": [
                    .json(200, Phase4Fixture.myOrganizationsJSON)
                ]
            ]
        )
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: makeRepository(transport: transport),
            cache: cache
        )

        await viewModel.activate(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase4Fixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        guard case let .loaded(snapshot) = viewModel.state else {
            return XCTFail("Expected protected access state.")
        }
        XCTAssertEqual(snapshot.memberships.map(\.role), [.owner])
        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["listMyOrganizations"])
    }

    func testOwnershipCacheIsMemoryOnlyAndFreshInstanceIsEmpty()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listMyOrganizations": [
                    .json(200, Phase4Fixture.myOrganizationsJSON)
                ],
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.claimID,
                                    "Private roster evidence",
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    )
                ],
            ]
        )
        let repository = makeRepository(transport: transport)
        let access = try await repository.access()
        let reviewPage = try await repository.reviewPage(
            after: nil,
            limit: 50
        )
        let cache = OrganizationOwnershipCache()
        await cache.replaceAccess(access)
        await cache.replaceReviewClaims(reviewPage.claims)

        let populated = await cache.snapshot()
        XCTAssertEqual(populated.access, access)
        XCTAssertEqual(
            populated.reviewClaims.map(\.evidence),
            ["Private roster evidence"]
        )

        let fresh = OrganizationOwnershipCache()
        let freshSnapshot = await fresh.snapshot()
        XCTAssertEqual(freshSnapshot, .empty)
    }

    func testAuthLossAndNavigationExitPurgeEvidenceAndAdminState()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listMyOrganizations": [
                    .json(200, Phase4Fixture.myOrganizationsJSON)
                ],
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.claimID,
                                    "Private roster evidence",
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    ),
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.claimID,
                                    "Private roster evidence",
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    ),
                ],
            ]
        )
        let repository = makeRepository(transport: transport)
        let access = try await repository.access()
        let firstReview = try await repository.reviewPage(
            after: nil,
            limit: 50
        )
        let cache = OrganizationOwnershipCache()
        await cache.replaceAccess(access)
        await cache.replaceReviewClaims(firstReview.claims)

        await cache.purge(reason: .authExpired)
        var snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)

        let secondReview = try await repository.reviewPage(
            after: nil,
            limit: 50
        )
        await cache.replaceAccess(access)
        await cache.replaceReviewClaims(secondReview.claims)
        await cache.purgeOnNavigationExit()
        snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
    }

    func testDecisionMutationRemovesReviewedClaimFromMemory()
        async throws
    {
        let transport = Phase4OrganizationTransport(
            responses: [
                "listMyOrganizations": [
                    .json(200, Phase4Fixture.myOrganizationsJSON)
                ],
                "listReviewableOrganizationClaims": [
                    .json(
                        200,
                        Phase4Fixture.reviewQueueJSON(
                            claims: [
                                (
                                    Phase4Fixture.claimID,
                                    "Private roster evidence",
                                    "2026-07-30T00:01:00.000Z"
                                )
                            ],
                            next: nil
                        )
                    )
                ],
                "decideOrganizationClaim": [
                    .json(200, Phase4Fixture.decisionJSON())
                ],
            ]
        )
        let repository = makeRepository(transport: transport)
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: repository,
            cache: cache
        )
        let admitted = AuthState.admitted(
            AdmittedIdentity(
                id: Phase4Fixture.actorID,
                email: "member@brown.edu"
            )
        )

        await viewModel.activate(authState: admitted)
        await viewModel.activateReviewQueue(authState: admitted)

        _ = try await viewModel.decideClaim(
            claimID: Phase4Fixture.claimID,
            approve: true,
            note: "Verified roster"
        )

        let snapshot = await cache.snapshot()
        XCTAssertTrue(snapshot.reviewClaims.isEmpty)
    }

    func testUnauthenticatedDecisionNeverCallsProtectedOperation() async {
        let transport = Phase4OrganizationTransport(
            responses: [
                "decideOrganizationClaim": [
                    .json(200, Phase4Fixture.decisionJSON())
                ]
            ]
        )
        let viewModel = OrganizationAdminViewModel(
            repository: makeRepository(transport: transport),
            cache: OrganizationOwnershipCache()
        )

        do {
            _ = try await viewModel.decideClaim(
                claimID: Phase4Fixture.claimID,
                approve: true,
                note: "This must never leave the device"
            )
            XCTFail("Expected authentication to be required.")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testLoggerReceivesOnlyTypedSafeFailureWithoutEvidence()
        async
    {
        let evidence = "PHASE4-PRIVATE-EVIDENCE-SENTINEL"
        let transport = Phase4OrganizationTransport(
            responses: [
                "claimOrganization": [
                    .json(503, Phase4Fixture.unavailableJSON)
                ]
            ]
        )
        let logger = Phase4OwnershipLogRecorder()
        let repository = makeRepository(
            transport: transport,
            logger: logger
        )

        do {
            _ = try await repository.claim(
                organizationID: Phase4Fixture.organizationID,
                evidence: evidence
            )
            XCTFail("Expected protected operation failure.")
        } catch {
            XCTAssertEqual(error as? APIError, .unavailable)
        }

        let events = await logger.events()
        XCTAssertEqual(
            events,
            [
                .operationFailed(
                    operation: .claim,
                    error: .unavailable
                )
            ]
        )
        XCTAssertFalse(String(describing: events).contains(evidence))
    }

    func testFailurePresentationNeverReflectsServerCodesOrEvidence() {
        let privateSentinel = "PHASE4-PRIVATE-EVIDENCE-SENTINEL"
        let failures = [
            SafeFailurePresentation.make(
                for: APIError.forbidden(code: privateSentinel)
            ),
            SafeFailurePresentation.make(
                for: APIError.server(
                    status: 500,
                    code: privateSentinel
                )
            ),
        ]

        for failure in failures {
            XCTAssertFalse(
                String(describing: failure).contains(privateSentinel)
            )
        }
    }

    private func makeRepository(
        transport: Phase4OrganizationTransport,
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
            publicOrganizations:
                Phase4PublicOrganizationRepositoryFake(),
            logger: logger
        )
    }
}
