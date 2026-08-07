import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class OrganizationOwnershipLifecycleTests: XCTestCase {
    func testLateAccessCannotRepopulateAfterSynchronousSignOut()
        async throws
    {
        let repository = ControlledOrganizationOwnershipRepository()
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: repository,
            cache: cache
        )
        let admitted = admittedState(
            id: UUID(
                uuidString: "10000000-0000-4000-8000-000000000011"
            )!
        )
        let lateAccess = accessSnapshot(
            organizationID: "late-organization",
            organizationName: "Late Organization"
        )

        let activation = Task {
            await viewModel.activate(authState: admitted)
        }
        await repository.waitForAccessCallCount(1)

        let purge = viewModel.deactivate(reason: .signedOut)
        XCTAssertEqual(viewModel.state, .authenticationRequired)
        XCTAssertEqual(viewModel.reviewState, .authenticationRequired)

        try await repository.resolveAccess(
            call: 1,
            with: .success(lateAccess)
        )
        await activation.value
        await purge.value

        XCTAssertEqual(viewModel.state, .authenticationRequired)
        let finalSnapshot = await cache.snapshot()
        XCTAssertEqual(finalSnapshot, .empty)
    }

    func testLateFirstUserAccessCannotOverwriteAccountSwitch()
        async throws
    {
        let repository = ControlledOrganizationOwnershipRepository()
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: repository,
            cache: cache
        )
        let firstUser = admittedState(
            id: UUID(
                uuidString: "10000000-0000-4000-8000-000000000021"
            )!
        )
        let secondUser = admittedState(
            id: UUID(
                uuidString: "10000000-0000-4000-8000-000000000022"
            )!
        )
        let firstAccess = accessSnapshot(
            organizationID: "first-user-organization",
            organizationName: "First User Organization"
        )
        let secondAccess = accessSnapshot(
            organizationID: "second-user-organization",
            organizationName: "Second User Organization"
        )

        let firstActivation = Task {
            await viewModel.activate(authState: firstUser)
        }
        await repository.waitForAccessCallCount(1)

        let secondActivation = Task {
            await viewModel.activate(authState: secondUser)
        }
        await repository.waitForAccessCallCount(2)

        try await repository.resolveAccess(
            call: 2,
            with: .success(secondAccess)
        )
        await secondActivation.value
        assertLoadedOrganization(
            "second-user-organization",
            in: viewModel.state
        )

        try await repository.resolveAccess(
            call: 1,
            with: .success(firstAccess)
        )
        await firstActivation.value

        assertLoadedOrganization(
            "second-user-organization",
            in: viewModel.state
        )
        let finalSnapshot = await cache.snapshot()
        XCTAssertEqual(finalSnapshot.access, secondAccess)
    }

    func testReviewDeactivationHidesEvidenceSynchronouslyAndPurgesCache()
        async throws
    {
        let repository = ControlledOrganizationOwnershipRepository()
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: repository,
            cache: cache
        )
        let admitted = admittedState(
            id: UUID(
                uuidString: "10000000-0000-4000-8000-000000000031"
            )!
        )
        let access = accessSnapshot(
            organizationID: "reviewable-organization",
            organizationName: "Reviewable Organization"
        )
        let evidence = "PRIVATE-LIFECYCLE-EVIDENCE"
        await repository.setReviewPage(
            OrganizationClaimReviewPage(
                claims: [
                    OrganizationReviewableClaim(
                        claimID: UUID(
                            uuidString:
                                "20000000-0000-4000-8000-000000000031"
                        )!,
                        organizationID: "reviewable-organization",
                        organizationName: "Reviewable Organization",
                        claimantDisplayName: "Private Claimant",
                        claimantHandle: "private-claimant",
                        evidence: evidence,
                        createdAt: Date(timeIntervalSince1970: 1_785_369_660)
                    )
                ],
                next: nil
            )
        )

        let activation = Task {
            await viewModel.activate(authState: admitted)
        }
        await repository.waitForAccessCallCount(1)
        try await repository.resolveAccess(
            call: 1,
            with: .success(access)
        )
        await activation.value
        await viewModel.activateReviewQueue(authState: admitted)

        XCTAssertTrue(
            String(describing: viewModel.reviewState).contains(evidence)
        )
        let populatedSnapshot = await cache.snapshot()
        XCTAssertEqual(
            populatedSnapshot.reviewClaims.map(\.evidence),
            [evidence]
        )

        let purge = viewModel.deactivateReviewQueue()
        XCTAssertEqual(viewModel.reviewState, .inactive)
        XCTAssertFalse(
            String(describing: viewModel.reviewState).contains(evidence)
        )

        await purge.value
        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot.access, access)
        XCTAssertTrue(snapshot.reviewClaims.isEmpty)
    }

    func testIdenticalConcurrentClaimsCoalesceToOneMutation()
        async throws
    {
        let repository = ControlledOrganizationOwnershipRepository()
        let cache = OrganizationOwnershipCache()
        let viewModel = OrganizationAdminViewModel(
            repository: repository,
            cache: cache
        )
        let admitted = admittedState(
            id: UUID(
                uuidString: "10000000-0000-4000-8000-000000000041"
            )!
        )
        let access = accessSnapshot(
            organizationID: "claimable-organization",
            organizationName: "Claimable Organization"
        )
        let outcome = OrganizationClaimOutcome.pending(
            claimID: UUID(
                uuidString: "20000000-0000-4000-8000-000000000041"
            )!
        )

        let activation = Task {
            await viewModel.activate(authState: admitted)
        }
        await repository.waitForAccessCallCount(1)
        try await repository.resolveAccess(
            call: 1,
            with: .success(access)
        )
        await activation.value
        await repository.setClaimResolution(
            .success(outcome),
            forCall: 2
        )

        let firstClaim = Task {
            try await viewModel.claim(
                organizationID: "claimable-organization",
                evidence: "Elected president"
            )
        }
        await repository.waitForClaimCallCount(1)

        let secondClaim = Task {
            try await viewModel.claim(
                organizationID: "claimable-organization",
                evidence: "Elected president"
            )
        }
        await Task.yield()
        await Task.yield()

        let overlappingCallCount = await repository.claimCallCount()
        XCTAssertEqual(overlappingCallCount, 1)
        try await repository.resolveClaim(
            call: 1,
            with: .success(outcome)
        )

        let firstOutcome = try await firstClaim.value
        let secondOutcome = try await secondClaim.value
        XCTAssertEqual(firstOutcome, outcome)
        XCTAssertEqual(secondOutcome, outcome)
        let finalCallCount = await repository.claimCallCount()
        XCTAssertEqual(finalCallCount, 1)
    }

    func testTerminalUnauthorizedInvokesHandlerAndPurgesSession()
        async
    {
        let repository = ControlledOrganizationOwnershipRepository()
        let cache = OrganizationOwnershipCache()
        let terminalErrors = TerminalAuthorizationRecorder()
        await repository.setAccessResolution(
            .failure(.unauthorized),
            forCall: 1
        )
        let viewModel = OrganizationAdminViewModel(
            repository: repository,
            cache: cache,
            terminalAuthorizationHandler: { error in
                await terminalErrors.record(error)
            }
        )

        await viewModel.activate(
            authState: admittedState(
                id: UUID(
                    uuidString:
                        "10000000-0000-4000-8000-000000000051"
                )!
            )
        )

        let recordedErrors = await terminalErrors.recordedErrors()
        XCTAssertEqual(recordedErrors, [.unauthorized])
        XCTAssertEqual(viewModel.state, .authenticationRequired)
        XCTAssertEqual(viewModel.reviewState, .authenticationRequired)
        let finalSnapshot = await cache.snapshot()
        XCTAssertEqual(finalSnapshot, .empty)
    }

    private func admittedState(id: UUID) -> AuthState {
        .admitted(
            AdmittedIdentity(
                id: id,
                email: "member@brown.edu"
            )
        )
    }

    private func accessSnapshot(
        organizationID: String,
        organizationName: String
    ) -> OrganizationAccessSnapshot {
        OrganizationAccessSnapshot(
            memberships: [
                OrganizationMembership(
                    organizationID: organizationID,
                    organizationName: organizationName,
                    role: .owner,
                    grantedAt: Date(
                        timeIntervalSince1970: 1_785_369_660
                    )
                )
            ],
            claims: []
        )
    }

    private func assertLoadedOrganization(
        _ organizationID: String,
        in state: OrganizationAdminViewModel.State,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .loaded(access) = state else {
            return XCTFail(
                "Expected loaded organization access.",
                file: file,
                line: line
            )
        }
        XCTAssertEqual(
            access.memberships.map(\.organizationID),
            [organizationID],
            file: file,
            line: line
        )
    }
}

private actor TerminalAuthorizationRecorder {
    private var errors: [APIError] = []

    func record(_ error: APIError) {
        errors.append(error)
    }

    func recordedErrors() -> [APIError] {
        errors
    }
}

private enum ControlledRepositoryResult<Value: Sendable>: Sendable {
    case success(Value)
    case failure(APIError)

    func get() throws -> Value {
        switch self {
        case let .success(value):
            return value
        case let .failure(error):
            throw error
        }
    }
}

private enum ControlledRepositoryError: Error {
    case missingAccessContinuation(Int)
    case missingClaimContinuation(Int)
    case unstubbedOperation(String)
}

private actor ControlledOrganizationOwnershipRepository:
    OrganizationOwnershipRepository
{
    typealias AccessResult =
        ControlledRepositoryResult<OrganizationAccessSnapshot>
    typealias ClaimResult =
        ControlledRepositoryResult<OrganizationClaimOutcome>

    private var accessCalls = 0
    private var accessResolutions: [Int: AccessResult] = [:]
    private var accessContinuations:
        [Int: CheckedContinuation<OrganizationAccessSnapshot, Error>] = [:]
    private var accessWaiters:
        [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    private var claimCalls = 0
    private var claimResolutions: [Int: ClaimResult] = [:]
    private var claimContinuations:
        [Int: CheckedContinuation<OrganizationClaimOutcome, Error>] = [:]
    private var claimWaiters:
        [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    private var reviewPageStub: OrganizationClaimReviewPage?

    func access() async throws -> OrganizationAccessSnapshot {
        accessCalls += 1
        let call = accessCalls
        resumeAccessWaiters()
        if let resolution = accessResolutions.removeValue(forKey: call) {
            return try resolution.get()
        }
        return try await withCheckedThrowingContinuation { continuation in
            accessContinuations[call] = continuation
        }
    }

    func create(
        _: OrganizationCreateDraft
    ) async throws -> OrganizationCreateOutcome {
        throw ControlledRepositoryError.unstubbedOperation("create")
    }

    func claim(
        organizationID _: String,
        evidence _: String?
    ) async throws -> OrganizationClaimOutcome {
        claimCalls += 1
        let call = claimCalls
        resumeClaimWaiters()
        if let resolution = claimResolutions.removeValue(forKey: call) {
            return try resolution.get()
        }
        return try await withCheckedThrowingContinuation { continuation in
            claimContinuations[call] = continuation
        }
    }

    func update(
        organizationID _: String,
        baseline _: PublicOrganizationProfile,
        expectedRevision _: Int,
        patch _: OrganizationEditPatchIntent
    ) async throws -> OrganizationEditOutcome {
        throw ControlledRepositoryError.unstubbedOperation("update")
    }

    func reviewPage(
        after _: OrganizationClaimCursor?,
        limit _: Int
    ) async throws -> OrganizationClaimReviewPage {
        guard let reviewPageStub else {
            throw ControlledRepositoryError.unstubbedOperation(
                "reviewPage"
            )
        }
        return reviewPageStub
    }

    func allReviewableClaims(
        pageSize _: Int
    ) async throws -> [OrganizationReviewableClaim] {
        throw ControlledRepositoryError.unstubbedOperation(
            "allReviewableClaims"
        )
    }

    func decideClaim(
        claimID _: UUID,
        approve _: Bool,
        note _: String?
    ) async throws -> OrganizationClaimDecisionOutcome {
        throw ControlledRepositoryError.unstubbedOperation("decideClaim")
    }

    func waitForAccessCallCount(_ count: Int) async {
        guard accessCalls < count else { return }
        await withCheckedContinuation { continuation in
            accessWaiters.append((count, continuation))
        }
    }

    func setAccessResolution(
        _ resolution: AccessResult,
        forCall call: Int
    ) {
        accessResolutions[call] = resolution
    }

    func resolveAccess(
        call: Int,
        with resolution: AccessResult
    ) throws {
        guard let continuation = accessContinuations.removeValue(
            forKey: call
        ) else {
            throw ControlledRepositoryError.missingAccessContinuation(
                call
            )
        }
        switch resolution {
        case let .success(access):
            continuation.resume(returning: access)
        case let .failure(error):
            continuation.resume(throwing: error)
        }
    }

    func setReviewPage(_ page: OrganizationClaimReviewPage) {
        reviewPageStub = page
    }

    func waitForClaimCallCount(_ count: Int) async {
        guard claimCalls < count else { return }
        await withCheckedContinuation { continuation in
            claimWaiters.append((count, continuation))
        }
    }

    func claimCallCount() -> Int {
        claimCalls
    }

    func setClaimResolution(
        _ resolution: ClaimResult,
        forCall call: Int
    ) {
        claimResolutions[call] = resolution
    }

    func resolveClaim(
        call: Int,
        with resolution: ClaimResult
    ) throws {
        guard let continuation = claimContinuations.removeValue(
            forKey: call
        ) else {
            throw ControlledRepositoryError.missingClaimContinuation(
                call
            )
        }
        switch resolution {
        case let .success(outcome):
            continuation.resume(returning: outcome)
        case let .failure(error):
            continuation.resume(throwing: error)
        }
    }

    private func resumeAccessWaiters() {
        var remaining:
            [(count: Int, continuation: CheckedContinuation<Void, Never>)] =
                []
        for waiter in accessWaiters {
            if accessCalls >= waiter.count {
                waiter.continuation.resume()
            } else {
                remaining.append(waiter)
            }
        }
        accessWaiters = remaining
    }

    private func resumeClaimWaiters() {
        var remaining:
            [(count: Int, continuation: CheckedContinuation<Void, Never>)] =
                []
        for waiter in claimWaiters {
            if claimCalls >= waiter.count {
                waiter.continuation.resume()
            } else {
                remaining.append(waiter)
            }
        }
        claimWaiters = remaining
    }
}
