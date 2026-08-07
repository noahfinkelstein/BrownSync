import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class UserEventEditConflictREDTests: XCTestCase {
    func testVersionedEditCommandsPreserveOmitSetAndClearExactly()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "updateUserEvent": [
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
        let patch = UserEventEditPatchIntent(
            title: .unchanged,
            description: .clear,
            start: .unchanged,
            end: .set(Phase5UserEventFixture.laterEnd),
            category: .unchanged,
            url: .clear,
            canonicalPlaceID: .unchanged
        )

        let changed = try await repository.update(
            eventID: Phase5UserEventFixture.eventID,
            baseline: Phase5UserEventFixture.baselineEvent,
            expectedRevision: 2,
            patch: patch
        )
        let replayed = try await repository.update(
            eventID: Phase5UserEventFixture.eventID,
            baseline: Phase5UserEventFixture.baselineEvent,
            expectedRevision: 2,
            patch: patch
        )

        XCTAssertEqual(
            changed,
            .updated(
                UserEventMutationOutcome(
                    eventID: Phase5UserEventFixture.eventID,
                    revision: 3,
                    changed: true
                )
            )
        )
        XCTAssertEqual(
            replayed,
            .updated(
                UserEventMutationOutcome(
                    eventID: Phase5UserEventFixture.eventID,
                    revision: 3,
                    changed: false
                )
            )
        )
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["updateUserEvent", "updateUserEvent"]
        )
        XCTAssertTrue(records.allSatisfy { $0.method == "PATCH" })
        XCTAssertTrue(
            records.allSatisfy {
                $0.path
                    == "/api/events/40000000-0000-4000-8000-000000000001"
            }
        )

        let request = try phase5UserEventJSONObject(records[0].body)
        XCTAssertEqual(request["version"] as? Int, 2)
        XCTAssertEqual(request["expectedRevision"] as? Int, 2)
        let encodedPatch = try XCTUnwrap(
            request["patch"] as? [String: Any]
        )
        XCTAssertEqual(
            Set(encodedPatch.keys),
            ["description", "end", "url"]
        )
        XCTAssertNil(encodedPatch["title"])
        XCTAssertNil(encodedPatch["start"])
        XCTAssertNil(encodedPatch["category"])
        XCTAssertNil(encodedPatch["placeId"])
        XCTAssertNil(encodedPatch["locationRaw"])

        let description = try XCTUnwrap(
            encodedPatch["description"] as? [String: Any]
        )
        XCTAssertEqual(description["action"] as? String, "clear")
        XCTAssertNil(description["value"])

        let end = try XCTUnwrap(
            encodedPatch["end"] as? [String: Any]
        )
        XCTAssertEqual(end["action"] as? String, "set")
        let encodedEnd = try XCTUnwrap(end["value"] as? String)
        XCTAssertEqual(
            try isoDate(encodedEnd),
            Phase5UserEventFixture.laterEnd
        )

        let url = try XCTUnwrap(
            encodedPatch["url"] as? [String: Any]
        )
        XCTAssertEqual(url["action"] as? String, "clear")
        XCTAssertNil(url["value"])
    }

    func testAllUnchangedEditFailsBeforeGeneratedOperation() async {
        let transport = Phase5UserEventTransport()
        let repository = makeRepository(transport: transport)
        let patch = UserEventEditPatchIntent(
            title: .unchanged,
            description: .unchanged,
            start: .unchanged,
            end: .unchanged,
            category: .unchanged,
            url: .unchanged,
            canonicalPlaceID: .unchanged
        )

        do {
            _ = try await repository.update(
                eventID: Phase5UserEventFixture.eventID,
                baseline: Phase5UserEventFixture.baselineEvent,
                expectedRevision: 2,
                patch: patch
            )
            XCTFail("Expected an empty edit patch error.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .emptyEditPatch
            )
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testRevisionConflictRefetchesProtectedDetailAndNeverBlindlyRetries()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "updateUserEvent": [
                    .json(409, Phase5UserEventFixture.conflictJSON)
                ],
                "getMyUserEvent": [
                    .json(
                        200,
                        Phase5UserEventFixture.managementJSON(
                            description: "Someone else's description",
                            end: "2026-09-16T00:30:00.000Z",
                            revision: 3,
                            updatedAt: "2026-07-30T16:02:00.000Z"
                        )
                    )
                ],
            ]
        )
        let repository = makeRepository(transport: transport)
        let patch = UserEventEditPatchIntent(
            title: .unchanged,
            description: .set("My proposed description"),
            start: .unchanged,
            end: .clear,
            category: .unchanged,
            url: .unchanged,
            canonicalPlaceID: .unchanged
        )

        let outcome = try await repository.update(
            eventID: Phase5UserEventFixture.eventID,
            baseline: Phase5UserEventFixture.baselineEvent,
            expectedRevision: 2,
            patch: patch
        )

        guard case .conflict(let review) = outcome else {
            return XCTFail("Expected a field-level conflict review.")
        }
        XCTAssertEqual(review.eventID, Phase5UserEventFixture.eventID)
        XCTAssertEqual(review.expectedRevision, 2)
        XCTAssertEqual(review.latestRevision, 3)
        XCTAssertEqual(
            review.fields.map(\.field),
            [.description, .end]
        )
        XCTAssertEqual(
            review.fields[0].baseline,
            .text("Original description")
        )
        XCTAssertEqual(
            review.fields[0].submitted,
            .text("My proposed description")
        )
        XCTAssertEqual(
            review.fields[0].latest,
            .text("Someone else's description")
        )
        XCTAssertEqual(review.fields[1].submitted, .none)

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["updateUserEvent", "getMyUserEvent"],
            "A conflict must refetch once and never blindly retry PATCH."
        )
        XCTAssertEqual(
            records[1].path,
            "/api/me/events/40000000-0000-4000-8000-000000000001"
        )
        XCTAssertEqual(review.latestEvent.revision, 3)
    }

    func testStartOnlyEditCannotCrossUnchangedEndBeforeNetwork() async {
        let transport = Phase5UserEventTransport()
        let repository = makeRepository(transport: transport)
        let patch = schedulePatch(
            start: .set(Phase5UserEventFixture.end),
            end: .unchanged
        )

        do {
            _ = try await repository.update(
                eventID: Phase5UserEventFixture.eventID,
                baseline: Phase5UserEventFixture.baselineEvent,
                expectedRevision: 2,
                patch: patch
            )
            XCTFail("Expected the effective schedule to be rejected.")
        } catch {
            XCTAssertEqual(
                error as? UserEventRepositoryError,
                .invalidTimeRange
            )
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testStartOnlyEditBeforeUnchangedEndReachesGeneratedOperation()
        async throws
    {
        let transport = Phase5UserEventTransport(
            responses: [
                "updateUserEvent": [
                    .json(
                        200,
                        Phase5UserEventFixture.mutationResultJSON(
                            revision: 3,
                            changed: true
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let patch = schedulePatch(
            start: .set(
                Phase5UserEventFixture.start.addingTimeInterval(60)
            ),
            end: .unchanged
        )

        _ = try await repository.update(
            eventID: Phase5UserEventFixture.eventID,
            baseline: Phase5UserEventFixture.baselineEvent,
            expectedRevision: 2,
            patch: patch
        )

        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["updateUserEvent"])
    }

    func testClearingEndAllowsStartAfterPreviousEnd() async throws {
        let transport = Phase5UserEventTransport(
            responses: [
                "updateUserEvent": [
                    .json(
                        200,
                        Phase5UserEventFixture.mutationResultJSON(
                            revision: 3,
                            changed: true
                        )
                    )
                ]
            ]
        )
        let repository = makeRepository(transport: transport)
        let patch = schedulePatch(
            start: .set(
                Phase5UserEventFixture.end.addingTimeInterval(60)
            ),
            end: .clear
        )

        _ = try await repository.update(
            eventID: Phase5UserEventFixture.eventID,
            baseline: Phase5UserEventFixture.baselineEvent,
            expectedRevision: 2,
            patch: patch
        )

        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["updateUserEvent"])
    }

    func testViewModelAdvancesBaselineAfterEveryAcceptedEdit()
        async
    {
        let revision3 = Phase5UserEventFixture.managedEvent(
            title: "First accepted title",
            revision: 3,
            updatedAt: Date(timeIntervalSince1970: 1_785_427_320)
        )
        let revision4 = Phase5UserEventFixture.managedEvent(
            title: "Second accepted title",
            revision: 4,
            updatedAt: Date(timeIntervalSince1970: 1_785_427_380)
        )
        let repository = Phase5EditSessionRepository(
            initial: Phase5UserEventFixture.baselineEvent,
            steps: [.updated(revision3), .updated(revision4)]
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        viewModel.beginEditing(Phase5UserEventFixture.baselineEvent)

        let first = await viewModel.update(
            patch: titlePatch("First accepted title"),
            authState: authState
        )
        let second = await viewModel.update(
            patch: titlePatch("Second accepted title"),
            authState: authState
        )

        let records = await repository.updateRecords()
        XCTAssertEqual(first, revision3)
        XCTAssertEqual(second, revision4)
        XCTAssertEqual(viewModel.editBaseline, revision4)
        XCTAssertEqual(records.map(\.baselineRevision), [2, 3])
        XCTAssertEqual(records.map(\.expectedRevision), [2, 3])
    }

    func testRepeatedConflictUsesLatestProtectedBaseline()
        async
    {
        let revision3 = Phase5UserEventFixture.managedEvent(
            title: "Server revision three",
            revision: 3,
            updatedAt: Date(timeIntervalSince1970: 1_785_427_320)
        )
        let revision4 = Phase5UserEventFixture.managedEvent(
            title: "Server revision four",
            revision: 4,
            updatedAt: Date(timeIntervalSince1970: 1_785_427_380)
        )
        let repository = Phase5EditSessionRepository(
            initial: Phase5UserEventFixture.baselineEvent,
            steps: [.conflict(revision3), .conflict(revision4)]
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        viewModel.beginEditing(Phase5UserEventFixture.baselineEvent)

        _ = await viewModel.update(
            patch: titlePatch("My selected title"),
            authState: authState
        )
        XCTAssertEqual(viewModel.editBaseline, revision3)

        _ = await viewModel.update(
            patch: titlePatch("My selected title"),
            authState: authState
        )

        let records = await repository.updateRecords()
        XCTAssertEqual(records.map(\.baselineRevision), [2, 3])
        XCTAssertEqual(records.map(\.expectedRevision), [2, 3])
        guard case .conflict(let review) = viewModel.state else {
            return XCTFail("Expected the second conflict review.")
        }
        XCTAssertEqual(review.expectedRevision, 3)
        XCTAssertEqual(review.latestRevision, 4)
        XCTAssertEqual(
            review.fields.first?.baseline,
            .text("Server revision three")
        )
    }

    func testCanceledEventCannotInvokeUpdate() async {
        let canceled = Phase5UserEventFixture.managedEvent(
            status: .canceled,
            revision: 3,
            deletedAt: Date(timeIntervalSince1970: 1_785_427_320)
        )
        let repository = Phase5EditSessionRepository(
            initial: canceled,
            steps: []
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        viewModel.beginEditing(canceled)

        _ = await viewModel.update(
            patch: titlePatch("Impossible edit"),
            authState: authState
        )

        let records = await repository.updateRecords()
        XCTAssertTrue(records.isEmpty)
        XCTAssertFalse(canceled.isEditable)
        guard case .failed = viewModel.state else {
            return XCTFail("Expected an explicit read-only failure.")
        }
    }

    func testDeletedEventCannotInvokeUpdate() async {
        let deleted = Phase5UserEventFixture.managedEvent(
            status: .published,
            revision: 3,
            deletedAt: Date(timeIntervalSince1970: 1_785_427_320)
        )
        let repository = Phase5EditSessionRepository(
            initial: deleted,
            steps: []
        )
        let viewModel = UserEventManagementViewModel(
            repository: repository,
            cache: UserEventManagementCache()
        )
        let authState = admittedAuthState
        await viewModel.activate(authState: authState)
        viewModel.beginEditing(deleted)

        _ = await viewModel.update(
            patch: titlePatch("Impossible edit"),
            authState: authState
        )

        let records = await repository.updateRecords()
        XCTAssertTrue(records.isEmpty)
        XCTAssertFalse(deleted.isEditable)
        guard case .failed = viewModel.state else {
            return XCTFail("Expected an explicit read-only failure.")
        }
    }

    func testDeletedPresentationNeverClaimsPublishedOrVisible() {
        let deletedAt = Date(timeIntervalSince1970: 1_785_427_320)
        let event = Phase5UserEventFixture.managedEvent(
            status: .published,
            deletedAt: deletedAt
        )

        let presentation = event.managementStatePresentation

        XCTAssertEqual(presentation.primaryTitle, "Deleted")
        XCTAssertEqual(presentation.primarySystemImage, "trash")
        XCTAssertNil(presentation.secondaryTitle)
        XCTAssertNil(presentation.secondarySystemImage)
        XCTAssertEqual(presentation.deletedAt, deletedAt)
        XCTAssertEqual(presentation.readOnlyTitle, "Deleted event")
        XCTAssertTrue(
            presentation.readOnlyMessage.contains(
                "cannot be edited or restored"
            )
        )
        XCTAssertFalse(
            presentation.accessibilityStatus.contains("Published")
        )
        XCTAssertFalse(
            presentation.accessibilityStatus.contains("Visible")
        )

        let details = event.readOnlyDetails
        XCTAssertEqual(details.title, event.title)
        XCTAssertEqual(details.description, "Original description")
        XCTAssertEqual(details.start, event.start)
        XCTAssertEqual(details.end, event.end)
        XCTAssertEqual(details.placeName, "Salomon Center")
        XCTAssertEqual(details.categoryTitle, "Social")
        XCTAssertEqual(
            details.eventURL,
            URL(string: "https://example.edu/study-break")
        )

        let unsafeLinkEvent = Phase5UserEventFixture.managedEvent(
            url: URL(string: "HTTPS://example.edu/study-break"),
            deletedAt: deletedAt
        )
        XCTAssertNil(unsafeLinkEvent.readOnlyDetails.eventURL)
    }

    func testConflictRebaseUpdatesKeptFieldsAndPreservesSelectedIntents() {
        var form = UserEventEditProtectedFormState(
            event: Phase5UserEventFixture.baselineEvent,
            ownerID: Phase5UserEventFixture.actorID
        )
        let selectedTitle = "My selected title"
        let selectedEnd = Date(timeIntervalSince1970: 1_789_520_200)
        form.titleText = selectedTitle
        form.end = selectedEnd
        let patch = UserEventEditPatchIntent(
            title: .set(selectedTitle),
            description: .clear,
            start: .unchanged,
            end: .set(selectedEnd),
            category: .unchanged,
            url: .clear,
            canonicalPlaceID: .unchanged
        )
        let latestStart = Date(timeIntervalSince1970: 1_789_511_200)
        let latestURL = URL(string: "https://events.example/latest")!
        let latest = ManagedUserEvent(
            id: Phase5UserEventFixture.eventID,
            owner: .personal,
            title: "Latest server title",
            description: "Latest server description",
            start: latestStart,
            end: Date(timeIntervalSince1970: 1_789_514_800),
            canonicalPlaceID: "sayles-hall",
            placeName: "Sayles Hall",
            category: .arts,
            url: latestURL,
            status: .published,
            moderationState: .active,
            revision: 3,
            deletedAt: nil,
            createdAt: Date(timeIntervalSince1970: 1_785_427_200),
            updatedAt: Date(timeIntervalSince1970: 1_785_427_320)
        )

        form.rebase(to: latest, preserving: patch)

        XCTAssertEqual(form.baseline, latest)
        XCTAssertEqual(form.titleText, selectedTitle)
        XCTAssertEqual(
            form.descriptionText,
            "Original description",
            "Explicit clear intent must not be replaced by server text."
        )
        XCTAssertEqual(form.start, latestStart)
        XCTAssertEqual(form.end, selectedEnd)
        XCTAssertEqual(form.category, .arts)
        XCTAssertEqual(
            form.urlText,
            "https://example.edu/study-break",
            "Explicit clear intent must remain selected."
        )
        XCTAssertEqual(form.selectedPlaceID, "sayles-hall")
    }

    private func makeRepository(
        transport: Phase5UserEventTransport
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
        if let date = formatter.date(from: value) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return try XCTUnwrap(formatter.date(from: value))
    }

    private func titlePatch(_ title: String) -> UserEventEditPatchIntent {
        UserEventEditPatchIntent(
            title: .set(title),
            description: .unchanged,
            start: .unchanged,
            end: .unchanged,
            category: .unchanged,
            url: .unchanged,
            canonicalPlaceID: .unchanged
        )
    }

    private func schedulePatch(
        start: UserEventSetIntent<Date>,
        end: UserEventNullableEditIntent<Date>
    ) -> UserEventEditPatchIntent {
        UserEventEditPatchIntent(
            title: .unchanged,
            description: .unchanged,
            start: start,
            end: end,
            category: .unchanged,
            url: .unchanged,
            canonicalPlaceID: .unchanged
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

private actor Phase5EditSessionRepository: UserEventRepository {
    struct UpdateRecord: Equatable, Sendable {
        let baselineRevision: Int
        let expectedRevision: Int
    }

    enum Step: Sendable {
        case updated(ManagedUserEvent)
        case conflict(ManagedUserEvent)
    }

    private let initial: ManagedUserEvent
    private var steps: [Step]
    private var records: [UpdateRecord] = []
    private var details: [ManagedUserEvent] = []

    init(initial: ManagedUserEvent, steps: [Step]) {
        self.initial = initial
        self.steps = steps
    }

    func updateRecords() -> [UpdateRecord] {
        records
    }

    func prepareCreate(
        _: UserEventCreateDraft
    ) async -> UserEventCreateSubmission {
        UserEventCreateSubmission(
            requestID: Phase5UserEventFixture.requestID,
            draft: Phase5UserEventFixture.personalDraft()
        )
    }

    func create(
        _: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome {
        throw Phase5UserEventTestFailure.unexpectedOperation("create")
    }

    func update(
        eventID: UUID,
        baseline: ManagedUserEvent,
        expectedRevision: Int,
        patch: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome {
        records.append(
            UpdateRecord(
                baselineRevision: baseline.revision,
                expectedRevision: expectedRevision
            )
        )
        guard !steps.isEmpty else {
            throw Phase5UserEventTestFailure.unexpectedOperation("update")
        }
        let step = steps.removeFirst()
        switch step {
        case .updated(let latest):
            details.append(latest)
            return .updated(
                UserEventMutationOutcome(
                    eventID: eventID,
                    revision: latest.revision,
                    changed: true
                )
            )
        case .conflict(let latest):
            let submitted: UserEventEditComparisonValue
            if case .set(let title) = patch.title {
                submitted = .text(title)
            } else {
                submitted = .none
            }
            return .conflict(
                UserEventEditConflictReview(
                    eventID: eventID,
                    expectedRevision: expectedRevision,
                    latestRevision: latest.revision,
                    latestEvent: latest,
                    fields: [
                        UserEventEditFieldComparison(
                            field: .title,
                            baseline: .text(baseline.title),
                            submitted: submitted,
                            latest: .text(latest.title)
                        )
                    ]
                )
            )
        }
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
        UserEventManagementPage(events: [initial], next: nil)
    }

    func allManageableEvents(
        pageSize _: Int
    ) async throws -> [ManagedUserEvent] {
        [initial]
    }

    func detail(
        eventID _: UUID
    ) async throws -> ManagedUserEvent {
        guard !details.isEmpty else {
            throw Phase5UserEventTestFailure.unexpectedOperation("detail")
        }
        return details.removeFirst()
    }
}
