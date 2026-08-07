import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class UserEventSecurityStateREDTests: XCTestCase {
    func testPersonalAgeAndOrganizationAuthorityFailuresSurfaceWithoutRetry()
        async
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "createUserEvent": [
                    .json(403, Phase5UserEventFixture.forbiddenJSON),
                    .json(403, Phase5UserEventFixture.forbiddenJSON),
                ]
            ]
        )
        let repository = makeRepository(
            transport: transport,
            uuids: Phase5UUIDSequence(
                [
                    Phase5UserEventFixture.requestID,
                    Phase5UserEventFixture.secondRequestID,
                ]
            )
        )
        let personal = await repository.prepareCreate(
            Phase5UserEventFixture.personalDraft()
        )
        let organization = await repository.prepareCreate(
            Phase5UserEventFixture.organizationDraft()
        )

        do {
            _ = try await repository.create(personal)
            XCTFail("Expected the sanitized personal eligibility failure.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .eligibilityOrAuthorityRequired
            )
        }
        do {
            _ = try await repository.create(organization)
            XCTFail("Expected the sanitized organization authority failure.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .eligibilityOrAuthorityRequired
            )
        }

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["createUserEvent", "createUserEvent"],
            "The sanitized 403 does not identify account age versus organization authority, and neither branch may retry."
        )
    }

    func testTenPerTwentyFourHourLimitSurfacesWithoutRetry() async {
        let transport = Phase5UserEventTransport(
            responses: [
                "createUserEvent": [
                    .json(429, Phase5UserEventFixture.rateLimitedJSON)
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let submission = await repository.prepareCreate(
            Phase5UserEventFixture.personalDraft()
        )

        do {
            _ = try await repository.create(submission)
            XCTFail("Expected the creation-rate-limit failure.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .rateLimited
            )
        }

        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["createUserEvent"])
    }

    func testProtectedManagementCacheIsMemoryOnlyAndPurgesOnAuthAndExit()
        async
    {
        let cache = UserEventManagementCache()
        await cache.replaceEvents([Phase5UserEventFixture.baselineEvent])
        var snapshot = await cache.snapshot()
        XCTAssertEqual(
            snapshot.events.map(\.id),
            [Phase5UserEventFixture.eventID]
        )

        let fresh = UserEventManagementCache()
        let freshSnapshot = await fresh.snapshot()
        XCTAssertEqual(freshSnapshot, .empty)

        await cache.purge(reason: .authExpired)
        snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)

        await cache.replaceEvents([Phase5UserEventFixture.baselineEvent])
        await cache.purgeOnNavigationExit()
        snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
    }

    func testSignedOutAndAuthenticatingStatesPurgeAndNeverCallProtectedAPI()
        async
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
        let cache = UserEventManagementCache()
        await cache.replaceEvents([Phase5UserEventFixture.baselineEvent])
        let viewModel = UserEventManagementViewModel(
            repository: makeRepository(transport: transport),
            cache: cache
        )

        await viewModel.activate(authState: .signedOut)
        XCTAssertEqual(viewModel.state, .authenticationRequired)
        let signedOutSnapshot = await cache.snapshot()
        XCTAssertEqual(signedOutSnapshot, .empty)

        await viewModel.activate(authState: .authenticating)
        XCTAssertEqual(viewModel.state, .authenticationRequired)
        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testAdmittedEmptyManagementPageHasExplicitAccessibleEmptyState()
        async
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
        let viewModel = UserEventManagementViewModel(
            repository: makeRepository(transport: transport),
            cache: UserEventManagementCache()
        )

        await viewModel.activate(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase5UserEventFixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        XCTAssertEqual(viewModel.state, .empty)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["listMyUserEvents"])
    }

    func testConcurrentCreateSubmissionsUseOneRequestIdentityAndOnePost()
        async
    {
        let repository = Phase5GatedCreateRepository()
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = AuthState.admitted(
            AdmittedIdentity(
                id: Phase5UserEventFixture.actorID,
                email: "member@brown.edu"
            )
        )
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: Phase5UserEventFixture.personalDraft(),
                authState: authState
            )
        }
        await repository.waitUntilFirstPreparationStarts()

        let second = Task { @MainActor in
            await viewModel.submitCreate(
                draft: Phase5UserEventFixture.personalDraft(),
                authState: authState
            )
        }
        await second.value

        let preparationCount = await repository.preparationCount()
        XCTAssertEqual(
            preparationCount,
            1,
            "A concurrent tap must not mint a second request identity."
        )

        await repository.releaseFirstPreparation()
        await first.value

        let createCount = await repository.createCount()
        XCTAssertEqual(
            createCount,
            1,
            "A concurrent tap must not issue a second create request."
        )
    }

    func testCompletedCreateRequiresExplicitResetBeforeAnotherSubmission()
        async
    {
        let repository = Phase5GatedCreateRepository()
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: Phase5UserEventFixture.personalDraft(),
                authState: authState
            )
        }
        await repository.waitUntilFirstPreparationStarts()
        await repository.releaseFirstPreparation()
        await first.value

        await viewModel.submitCreate(
            draft: Phase5UserEventFixture.personalDraft(),
            authState: authState
        )
        var preparationCount = await repository.preparationCount()
        var createCount = await repository.createCount()
        XCTAssertEqual(preparationCount, 1)
        XCTAssertEqual(createCount, 1)
        XCTAssertTrue(viewModel.createRequiresExplicitReset)

        viewModel.startNewCreateSubmission()
        XCTAssertFalse(viewModel.createRequiresExplicitReset)
        XCTAssertEqual(viewModel.state, .empty)

        await viewModel.submitCreate(
            draft: Phase5UserEventFixture.personalDraft(),
            authState: authState
        )
        preparationCount = await repository.preparationCount()
        createCount = await repository.createCount()
        let submittedRequestIDs = await repository.submittedRequestIDs()
        XCTAssertEqual(preparationCount, 2)
        XCTAssertEqual(createCount, 2)
        XCTAssertEqual(
            submittedRequestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.secondRequestID,
            ]
        )
    }

    func testInternalFlowTransitionPreservesDelayedCreateResult()
        async throws
    {
        let repository = Phase5DelayedCreateRepository()
        let cache = UserEventManagementCache()
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: cache
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        let listLease = viewModel.enterProtectedFlow()

        let create = Task { @MainActor in
            await viewModel.submitCreate(
                draft: Phase5UserEventFixture.personalDraft(),
                authState: authState
            )
        }
        await repository.waitUntilCreateStarts()

        let staleExit = try XCTUnwrap(
            viewModel.prepareProtectedFlowExit(listLease)
        )
        _ = viewModel.enterProtectedFlow()
        await viewModel.completeProtectedFlowExit(staleExit)
        await viewModel.activate(authState: authState)

        await repository.releaseCreate()
        await create.value

        XCTAssertEqual(
            viewModel.state,
            .created(
                eventID: Phase5UserEventFixture.eventID,
                revision: 0
            )
        )
        let createCount = await repository.createCount()
        XCTAssertEqual(createCount, 1)
    }

    func testTrueFlowExitPurgesAndRejectsDelayedCreatePresentation()
        async throws
    {
        let repository = Phase5DelayedCreateRepository()
        let cache = UserEventManagementCache()
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: cache
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        let listLease = viewModel.enterProtectedFlow()

        let create = Task { @MainActor in
            await viewModel.submitCreate(
                draft: Phase5UserEventFixture.personalDraft(),
                authState: authState
            )
        }
        await repository.waitUntilCreateStarts()

        let exit = try XCTUnwrap(
            viewModel.prepareProtectedFlowExit(listLease)
        )
        await viewModel.completeProtectedFlowExit(exit)
        await repository.releaseCreate()
        await create.value

        let snapshot = await cache.snapshot()
        let createCount = await repository.createCount()
        XCTAssertEqual(viewModel.state, .authenticationRequired)
        XCTAssertNil(viewModel.pendingSubmission)
        XCTAssertEqual(snapshot, .empty)
        XCTAssertEqual(createCount, 1)
    }

    func testAmbiguousCreateAfterLifecyclePurgeReusesIssuedRequestIdentity()
        async
    {
        let repository = Phase5LifecycleCreateRepository(
            firstCompletion: .unavailable
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        let draft = Phase5UserEventFixture.personalDraft()
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: draft,
                authState: authState
            )
        }
        await repository.waitUntilFirstCreateStarts()
        await viewModel.deactivate(reason: .sceneBackgrounded)
        XCTAssertNil(viewModel.pendingSubmission)
        await repository.releaseFirstCreate()
        await first.value

        await viewModel.activate(authState: authState)
        await viewModel.submitCreate(
            draft: draft,
            authState: authState
        )

        let requestIDs = await repository.submittedRequestIDs()
        let preparationCount = await repository.preparationCount()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.requestID,
            ],
            "An ambiguous issued POST must be retried with its exact request identity."
        )
        XCTAssertEqual(preparationCount, 1)
        XCTAssertEqual(
            viewModel.state,
            .replayed(
                eventID: Phase5UserEventFixture.eventID,
                revision: 0
            )
        )
        XCTAssertTrue(viewModel.createRequiresExplicitReset)
    }

    func testLateCreateSuccessSurvivesRacingRefreshAsExplicitResetBarrier()
        async
    {
        let repository = Phase5LifecycleCreateRepository(
            firstCompletion: .created
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        let draft = Phase5UserEventFixture.personalDraft()
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: draft,
                authState: authState
            )
        }
        await repository.waitUntilFirstCreateStarts()
        await viewModel.deactivate(reason: .sceneBackgrounded)
        XCTAssertNil(viewModel.pendingSubmission)

        let reactivation = Task { @MainActor in
            await viewModel.activate(authState: authState)
            await viewModel.refresh(authState: authState)
        }
        await repository.releaseFirstCreate()
        await first.value
        await reactivation.value

        XCTAssertTrue(viewModel.createRequiresExplicitReset)
        await viewModel.submitCreate(
            draft: draft,
            authState: authState
        )
        var requestIDs = await repository.submittedRequestIDs()
        XCTAssertEqual(
            requestIDs,
            [Phase5UserEventFixture.requestID],
            "A known accepted create must block another submission until explicit reset."
        )

        viewModel.startNewCreateSubmission()
        XCTAssertFalse(viewModel.createRequiresExplicitReset)
        await viewModel.submitCreate(
            draft: draft,
            authState: authState
        )

        requestIDs = await repository.submittedRequestIDs()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.secondRequestID,
            ]
        )
    }

    func testAmbiguousCreateRequestIdentityIsOwnerBound() async {
        let repository = Phase5LifecycleCreateRepository(
            firstCompletion: .unavailable
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let firstOwner = admittedAuthState
        let secondOwner = AuthState.admitted(
            AdmittedIdentity(
                id: UUID(
                    uuidString:
                        "30000000-0000-4000-8000-000000000002"
                )!,
                email: "other@brown.edu"
            )
        )
        let draft = Phase5UserEventFixture.personalDraft()
        await viewModel.activate(authState: firstOwner)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: draft,
                authState: firstOwner
            )
        }
        await repository.waitUntilFirstCreateStarts()
        await viewModel.deactivate(reason: .signedOut)
        await repository.releaseFirstCreate()
        await first.value

        await viewModel.activate(authState: secondOwner)
        await viewModel.submitCreate(
            draft: draft,
            authState: secondOwner
        )

        let requestIDs = await repository.submittedRequestIDs()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.secondRequestID,
            ],
            "A request identity issued by one owner must never be reused by another."
        )
    }

    func testChangedDraftRequestConflictRequiresResetBeforeFreshIdentity()
        async
    {
        let repository = Phase5LifecycleCreateRepository(
            firstCompletion: .unavailable,
            secondCompletion: .requestConflict
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: Phase5UserEventFixture.personalDraft(),
                authState: authState
            )
        }
        await repository.waitUntilFirstCreateStarts()
        await viewModel.deactivate(reason: .sceneBackgrounded)
        await repository.releaseFirstCreate()
        await first.value

        await viewModel.activate(authState: authState)
        let changedDraft = Phase5UserEventFixture.organizationDraft()
        await viewModel.submitCreate(
            draft: changedDraft,
            authState: authState
        )

        guard case .failed(let failure) = viewModel.state else {
            return XCTFail("Expected the request conflict to remain visible.")
        }
        XCTAssertEqual(failure.title, "Request conflict")
        XCTAssertNil(
            viewModel.pendingSubmission,
            "A conflicting payload must not remain available for a looping retry."
        )
        XCTAssertTrue(viewModel.createRequiresExplicitReset)

        await viewModel.submitCreate(
            draft: changedDraft,
            authState: authState
        )
        var requestIDs = await repository.submittedRequestIDs()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.requestID,
            ],
            "The consumed request identity must block another POST before reset."
        )

        viewModel.startNewCreateSubmission()
        XCTAssertFalse(viewModel.createRequiresExplicitReset)
        await viewModel.submitCreate(
            draft: changedDraft,
            authState: authState
        )

        requestIDs = await repository.submittedRequestIDs()
        let preparationCount = await repository.preparationCount()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.secondRequestID,
            ]
        )
        XCTAssertEqual(preparationCount, 2)
    }

    func testRateLimitedPostPurgeRetryDoesNotConsumeIssuedIdentity()
        async
    {
        let repository = Phase5LifecycleCreateRepository(
            firstCompletion: .unavailable,
            secondCompletion: .rateLimited
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        let draft = Phase5UserEventFixture.personalDraft()
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: draft,
                authState: authState
            )
        }
        await repository.waitUntilFirstCreateStarts()
        await viewModel.deactivate(reason: .sceneBackgrounded)
        await repository.releaseFirstCreate()
        await first.value

        await viewModel.activate(authState: authState)
        await viewModel.submitCreate(
            draft: draft,
            authState: authState
        )

        XCTAssertFalse(viewModel.createRequiresExplicitReset)
        XCTAssertEqual(
            viewModel.pendingSubmission?.requestID,
            Phase5UserEventFixture.requestID
        )
        await viewModel.retryCreate(authState: authState)

        let requestIDs = await repository.submittedRequestIDs()
        let preparationCount = await repository.preparationCount()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.requestID,
            ]
        )
        XCTAssertEqual(preparationCount, 1)
        XCTAssertTrue(viewModel.createRequiresExplicitReset)
    }

    func testAccountDeletionDropsBarrierAndLateSuccessCannotRestoreIt()
        async
    {
        let repository = Phase5LifecycleCreateRepository(
            firstCompletion: .created
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        let draft = Phase5UserEventFixture.personalDraft()
        await viewModel.activate(authState: authState)

        let first = Task { @MainActor in
            await viewModel.submitCreate(
                draft: draft,
                authState: authState
            )
        }
        await repository.waitUntilFirstCreateStarts()
        await viewModel.deactivate(reason: .accountDeleted)
        await repository.releaseFirstCreate()
        await first.value

        XCTAssertEqual(viewModel.state, .authenticationRequired)
        XCTAssertNil(viewModel.pendingSubmission)
        await viewModel.activate(authState: authState)
        XCTAssertFalse(
            viewModel.createRequiresExplicitReset,
            "A deleted account must not regain request metadata from a late result."
        )

        await viewModel.submitCreate(
            draft: draft,
            authState: authState
        )

        let requestIDs = await repository.submittedRequestIDs()
        let preparationCount = await repository.preparationCount()
        XCTAssertEqual(
            requestIDs,
            [
                Phase5UserEventFixture.requestID,
                Phase5UserEventFixture.secondRequestID,
            ]
        )
        XCTAssertEqual(preparationCount, 2)
    }

    func testLateEditorCleanupCannotClobberPurgedPresentation() async {
        let repository = Phase5DelayedCreateRepository()
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        viewModel.beginEditing(Phase5UserEventFixture.baselineEvent)

        await viewModel.deactivate(reason: .sceneBackgrounded)
        viewModel.endEditing()

        XCTAssertEqual(viewModel.state, .authenticationRequired)
        XCTAssertNil(viewModel.editBaseline)
        XCTAssertNil(viewModel.conflictReview)
    }

    func testProtectedEditFormPurgeDropsBaselineAndEveryRetainedValue() {
        let ownerID = Phase5UserEventFixture.actorID
        let otherOwnerID = UUID(
            uuidString: "30000000-0000-4000-8000-000000000002"
        )!
        var form = UserEventEditProtectedFormState(
            event: Phase5UserEventFixture.baselineEvent,
            ownerID: ownerID
        )
        form.places = [
            PublicPlace(
                id: "salomon-center",
                name: "Salomon Center",
                aliases: ["Salomon"],
                kind: "building",
                address: "79 Waterman Street",
                latitude: 41.826,
                longitude: -71.402
            )
        ]
        form.placeSearch = "Salomon"
        form.placeLoadFailure = "Protected place failure"
        form.validationMessage = "Protected validation"
        form.successMessage = "Protected success"

        XCTAssertTrue(form.canRender(for: ownerID))
        XCTAssertFalse(form.canRender(for: otherOwnerID))

        form.purge()

        XCTAssertFalse(form.canRender(for: ownerID))
        XCTAssertNil(form.ownerID)
        XCTAssertNil(form.baseline)
        XCTAssertEqual(form.titleText, "")
        XCTAssertEqual(form.descriptionText, "")
        XCTAssertEqual(form.start, .distantPast)
        XCTAssertEqual(form.end, .distantPast)
        XCTAssertEqual(form.category, .academic)
        XCTAssertEqual(form.urlText, "")
        XCTAssertEqual(form.selectedPlaceID, "")
        XCTAssertTrue(form.places.isEmpty)
        XCTAssertEqual(form.placeSearch, "")
        XCTAssertNil(form.placeLoadFailure)
        XCTAssertNil(form.validationMessage)
        XCTAssertNil(form.successMessage)
    }

    func testNewerSameOwnerRefreshWinsOverOlderLoadInUIAndCache()
        async
    {
        let repository = Phase5OutOfOrderLoadRepository()
        let cache = UserEventManagementCache()
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: cache
        )
        let authState = admittedAuthState

        let olderLoad = Task { @MainActor in
            await viewModel.activate(authState: authState)
        }
        await repository.waitUntilOlderLoadStarts()

        let newerLoad = Task { @MainActor in
            await viewModel.refresh(authState: authState)
        }
        await newerLoad.value
        await repository.releaseOlderLoad()
        await olderLoad.value

        let expected = [
            Phase5UserEventFixture.managedEvent(
                title: "Newest refresh",
                revision: 4
            )
        ]
        XCTAssertEqual(viewModel.events, expected)
        XCTAssertEqual(viewModel.state, .loaded(expected))
        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot.events, expected)
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

    private var admittedAuthState: AuthState {
        .admitted(
            AdmittedIdentity(
                id: Phase5UserEventFixture.actorID,
                email: "member@brown.edu"
            )
        )
    }
}

private actor Phase5LifecycleCreateRepository: UserEventRepository {
    enum FirstCompletion: Sendable {
        case created
        case unavailable
    }

    enum SecondCompletion: Sendable {
        case replayed
        case requestConflict
        case rateLimited
    }

    private let firstCompletion: FirstCompletion
    private let secondCompletion: SecondCompletion
    private var preparations = 0
    private var submittedIDs: [UUID] = []
    private var firstCreateStarted = false
    private var firstCreateStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var firstCreateRelease: CheckedContinuation<Void, Never>?

    init(
        firstCompletion: FirstCompletion,
        secondCompletion: SecondCompletion = .replayed
    ) {
        self.firstCompletion = firstCompletion
        self.secondCompletion = secondCompletion
    }

    func waitUntilFirstCreateStarts() async {
        guard !firstCreateStarted else { return }
        await withCheckedContinuation { continuation in
            firstCreateStartWaiters.append(continuation)
        }
    }

    func releaseFirstCreate() {
        firstCreateRelease?.resume()
        firstCreateRelease = nil
    }

    func preparationCount() -> Int {
        preparations
    }

    func submittedRequestIDs() -> [UUID] {
        submittedIDs
    }

    func prepareCreate(
        _ draft: UserEventCreateDraft
    ) async -> UserEventCreateSubmission {
        preparations += 1
        return UserEventCreateSubmission(
            requestID: preparations == 1
                ? Phase5UserEventFixture.requestID
                : Phase5UserEventFixture.secondRequestID,
            draft: draft
        )
    }

    func create(
        _ submission: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome {
        submittedIDs.append(submission.requestID)
        if submittedIDs.count == 1 {
            firstCreateStarted = true
            let waiters = firstCreateStartWaiters
            firstCreateStartWaiters.removeAll()
            for waiter in waiters {
                waiter.resume()
            }
            await withCheckedContinuation { continuation in
                firstCreateRelease = continuation
            }
            switch firstCompletion {
            case .created:
                return .created(
                    eventID: Phase5UserEventFixture.eventID,
                    revision: 0
                )
            case .unavailable:
                throw UserEventRepositoryError.unavailable
            }
        }
        if submittedIDs.count == 2 {
            switch secondCompletion {
            case .replayed:
                break
            case .requestConflict:
                throw UserEventRepositoryError.requestConflict
            case .rateLimited:
                throw UserEventRepositoryError.rateLimited
            }
        }
        return .replayed(
            eventID: Phase5UserEventFixture.eventID,
            revision: 0
        )
    }

    func update(
        eventID _: UUID,
        baseline _: ManagedUserEvent,
        expectedRevision _: Int,
        patch _: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("update")
    }

    func cancel(
        eventID _: UUID
    ) async throws -> UserEventMutationOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("cancel")
    }

    func page(
        before _: UserEventManagementCursor?,
        limit _: Int
    ) async throws -> UserEventManagementPage {
        UserEventManagementPage(events: [], next: nil)
    }

    func allManageableEvents(
        pageSize _: Int
    ) async throws -> [ManagedUserEvent] {
        []
    }

    func detail(
        eventID _: UUID
    ) async throws -> ManagedUserEvent {
        throw Phase5UserEventTestFailure.unexpectedOperation("detail")
    }
}

private actor Phase5GatedCreateRepository: UserEventRepository {
    private var preparations = 0
    private var creates = 0
    private var submittedIDs: [UUID] = []
    private var firstPreparationStarted = false
    private var firstPreparationWaiters: [CheckedContinuation<Void, Never>] = []
    private var firstPreparationRelease: CheckedContinuation<Void, Never>?

    func waitUntilFirstPreparationStarts() async {
        guard !firstPreparationStarted else { return }
        await withCheckedContinuation { continuation in
            firstPreparationWaiters.append(continuation)
        }
    }

    func releaseFirstPreparation() {
        firstPreparationRelease?.resume()
        firstPreparationRelease = nil
    }

    func preparationCount() -> Int {
        preparations
    }

    func createCount() -> Int {
        creates
    }

    func prepareCreate(
        _ draft: UserEventCreateDraft
    ) async -> UserEventCreateSubmission {
        preparations += 1
        let preparation = preparations
        if preparation == 1 {
            firstPreparationStarted = true
            let waiters = firstPreparationWaiters
            firstPreparationWaiters.removeAll()
            for waiter in waiters {
                waiter.resume()
            }
            await withCheckedContinuation { continuation in
                firstPreparationRelease = continuation
            }
        }
        let requestID =
            preparation == 1
            ? Phase5UserEventFixture.requestID
            : Phase5UserEventFixture.secondRequestID
        return UserEventCreateSubmission(
            requestID: requestID,
            draft: draft
        )
    }

    func create(
        _ submission: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome {
        creates += 1
        submittedIDs.append(submission.requestID)
        return .created(
            eventID: Phase5UserEventFixture.eventID,
            revision: 0
        )
    }

    func submittedRequestIDs() -> [UUID] {
        submittedIDs
    }

    func update(
        eventID _: UUID,
        baseline _: ManagedUserEvent,
        expectedRevision _: Int,
        patch _: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("update")
    }

    func cancel(
        eventID _: UUID
    ) async throws -> UserEventMutationOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("cancel")
    }

    func page(
        before _: UserEventManagementCursor?,
        limit _: Int
    ) async throws -> UserEventManagementPage {
        UserEventManagementPage(events: [], next: nil)
    }

    func allManageableEvents(
        pageSize _: Int
    ) async throws -> [ManagedUserEvent] {
        []
    }

    func detail(
        eventID _: UUID
    ) async throws -> ManagedUserEvent {
        throw Phase5UserEventTestFailure.unexpectedOperation("detail")
    }
}

private actor Phase5DelayedCreateRepository: UserEventRepository {
    private var creates = 0
    private var createStarted = false
    private var createStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var createRelease: CheckedContinuation<Void, Never>?

    func waitUntilCreateStarts() async {
        guard !createStarted else { return }
        await withCheckedContinuation { continuation in
            createStartWaiters.append(continuation)
        }
    }

    func releaseCreate() {
        createRelease?.resume()
        createRelease = nil
    }

    func createCount() -> Int {
        creates
    }

    func prepareCreate(
        _ draft: UserEventCreateDraft
    ) async -> UserEventCreateSubmission {
        UserEventCreateSubmission(
            requestID: Phase5UserEventFixture.requestID,
            draft: draft
        )
    }

    func create(
        _: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome {
        creates += 1
        await withCheckedContinuation { continuation in
            createRelease = continuation
            createStarted = true
            let waiters = createStartWaiters
            createStartWaiters.removeAll()
            for waiter in waiters {
                waiter.resume()
            }
        }
        return .created(
            eventID: Phase5UserEventFixture.eventID,
            revision: 0
        )
    }

    func update(
        eventID _: UUID,
        baseline _: ManagedUserEvent,
        expectedRevision _: Int,
        patch _: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("update")
    }

    func cancel(
        eventID _: UUID
    ) async throws -> UserEventMutationOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("cancel")
    }

    func page(
        before _: UserEventManagementCursor?,
        limit _: Int
    ) async throws -> UserEventManagementPage {
        UserEventManagementPage(events: [], next: nil)
    }

    func allManageableEvents(
        pageSize _: Int
    ) async throws -> [ManagedUserEvent] {
        []
    }

    func detail(
        eventID _: UUID
    ) async throws -> ManagedUserEvent {
        throw Phase5UserEventTestFailure.unexpectedOperation("detail")
    }
}

private actor Phase5OutOfOrderLoadRepository: UserEventRepository {
    private var loadCount = 0
    private var olderLoadStarted = false
    private var olderLoadStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var olderLoadRelease: CheckedContinuation<Void, Never>?

    func waitUntilOlderLoadStarts() async {
        guard !olderLoadStarted else { return }
        await withCheckedContinuation { continuation in
            olderLoadStartWaiters.append(continuation)
        }
    }

    func releaseOlderLoad() {
        olderLoadRelease?.resume()
        olderLoadRelease = nil
    }

    func prepareCreate(
        _ draft: UserEventCreateDraft
    ) async -> UserEventCreateSubmission {
        UserEventCreateSubmission(
            requestID: Phase5UserEventFixture.requestID,
            draft: draft
        )
    }

    func create(
        _: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("create")
    }

    func update(
        eventID _: UUID,
        baseline _: ManagedUserEvent,
        expectedRevision _: Int,
        patch _: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("update")
    }

    func cancel(
        eventID _: UUID
    ) async throws -> UserEventMutationOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("cancel")
    }

    func page(
        before _: UserEventManagementCursor?,
        limit _: Int
    ) async throws -> UserEventManagementPage {
        throw Phase5UserEventTestFailure.unexpectedOperation("page")
    }

    func allManageableEvents(
        pageSize _: Int
    ) async throws -> [ManagedUserEvent] {
        loadCount += 1
        if loadCount == 1 {
            olderLoadStarted = true
            let waiters = olderLoadStartWaiters
            olderLoadStartWaiters.removeAll()
            for waiter in waiters {
                waiter.resume()
            }
            await withCheckedContinuation { continuation in
                olderLoadRelease = continuation
            }
            return [
                Phase5UserEventFixture.managedEvent(
                    title: "Stale refresh",
                    revision: 3
                )
            ]
        }
        return [
            Phase5UserEventFixture.managedEvent(
                title: "Newest refresh",
                revision: 4
            )
        ]
    }

    func detail(
        eventID _: UUID
    ) async throws -> ManagedUserEvent {
        throw Phase5UserEventTestFailure.unexpectedOperation("detail")
    }
}
