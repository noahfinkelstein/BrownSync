import Foundation
import SwiftUI

struct MyUserEventsView: View {
    @ObservedObject private var model: UserEventManagementViewModel
    private let authState: AuthState
    private let places: any PlaceRepository
    private let organizationMemberships: [OrganizationMembership]

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var statusIsFocused: Bool
    @State private var flowLease: UserEventProtectedFlowLease?

    init(
        model: UserEventManagementViewModel,
        authState: AuthState,
        places: any PlaceRepository,
        organizationMemberships: [OrganizationMembership] = []
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
        self.places = places
        self.organizationMemberships = organizationMemberships
    }

    var body: some View {
        content
            .navigationTitle("My Events")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                enterProtectedFlow()
            }
            .task(id: authState) {
                guard scenePhase == .active else { return }
                await model.activate(authState: authState)
            }
            .onChange(of: scenePhase) { phase in
                if phase == .active {
                    Task {
                        await model.activate(authState: authState)
                    }
                } else {
                    Task {
                        await model.deactivate(
                            reason: .sceneBackgrounded
                        )
                    }
                }
            }
            .onChange(of: authState) { state in
                guard case .admitted = state else {
                    Task {
                        await model.deactivate(reason: .signedOut)
                    }
                    return
                }
            }
            .onChange(of: model.state) { state in
                statusIsFocused = state.requiresAccessibilityFocus
            }
            .onDisappear {
                leaveProtectedFlow()
            }
    }

    @ViewBuilder
    private var content: some View {
        if scenePhase != .active {
            stateList(
                title: "Event management hidden",
                message:
                    "Protected event information returns when BrownSync is active.",
                systemImage: "eye.slash"
            )
        } else if !hasAdmittedAuthState {
            authenticationRequiredList
        } else {
            switch model.state {
            case .authenticationRequired:
                authenticationRequiredList

            case .loading:
                List {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Loading your events")
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Loading your events")
                }

            case .empty:
                List {
                    eventActions
                    UserEventStateRow(
                        title: "No events yet",
                        message:
                            "Create a personal event or an event for an organization you manage.",
                        systemImage: "calendar.badge.plus"
                    )
                }
                .refreshable {
                    await model.refresh(authState: authState)
                }

            case .loaded(let events):
                loadedList(events)

            case .submitting:
                stateList(
                    title: "Submitting event",
                    message:
                        "BrownSync is sending this event change once.",
                    systemImage: "arrow.up.circle"
                )

            case .created(let eventID, _):
                outcomeList(
                    title: "Event created",
                    message:
                        "Your event was created with identifier \(eventID.uuidString.lowercased()).",
                    systemImage: "checkmark.circle"
                )

            case .replayed(let eventID, _):
                outcomeList(
                    title: "Event already created",
                    message:
                        "The earlier submission was found safely as \(eventID.uuidString.lowercased()).",
                    systemImage: "arrow.clockwise.circle"
                )

            case .conflict(let review):
                outcomeList(
                    title: "Review event changes",
                    message:
                        "\(review.fields.count) submitted field changes need a conscious review against revision \(review.latestRevision).",
                    systemImage: "arrow.triangle.2.circlepath"
                )

            case .canceling:
                stateList(
                    title: "Canceling event",
                    message:
                        "BrownSync is removing this event from public visibility.",
                    systemImage: "calendar.badge.minus"
                )

            case .canceled(let outcome):
                outcomeList(
                    title: outcome.changed
                        ? "Event canceled"
                        : "Event already canceled",
                    message:
                        "The event is no longer publicly visible. Repeating this action is safe.",
                    systemImage: "checkmark.circle"
                )

            case .failed(let failure):
                failureList(failure)
            }
        }
    }

    private var authenticationRequiredList: some View {
        stateList(
            title: "Brown sign-in required",
            message:
                "Sign in with an admitted Brown account to manage events.",
            systemImage: "lock"
        )
    }

    private func loadedList(
        _ events: [ManagedUserEvent]
    ) -> some View {
        List {
            eventActions
            Section("Events you can manage") {
                ForEach(events) { event in
                    NavigationLink {
                        EditUserEventView(
                            model: model,
                            authState: authState,
                            event: event,
                            places: places
                        )
                    } label: {
                        UserEventManagementRow(event: event)
                    }
                    .accessibilityHint(
                        event.isEditable
                            ? "Opens explicit edit and cancel controls."
                            : "Opens read-only event details."
                    )
                }
            }
        }
        .privacySensitive()
        .refreshable {
            await model.refresh(authState: authState)
        }
    }

    @ViewBuilder
    private var eventActions: some View {
        Section("Event actions") {
            NavigationLink {
                CreateUserEventView(
                    model: model,
                    authState: authState,
                    places: places,
                    organizationMemberships:
                        organizationMemberships
                )
            } label: {
                Label(
                    "Create an event",
                    systemImage: "calendar.badge.plus"
                )
            }
            .accessibilityHint(
                "Opens a protected event creation form."
            )
        }
    }

    private func stateList(
        title: String,
        message: String,
        systemImage: String
    ) -> some View {
        List {
            UserEventStateRow(
                title: title,
                message: message,
                systemImage: systemImage
            )
            .accessibilityFocused($statusIsFocused)
        }
    }

    private func outcomeList(
        title: String,
        message: String,
        systemImage: String
    ) -> some View {
        List {
            UserEventStateRow(
                title: title,
                message: message,
                systemImage: systemImage
            )
            .accessibilityFocused($statusIsFocused)

            Button {
                Task {
                    await model.refresh(authState: authState)
                }
            } label: {
                Label("Return to my events", systemImage: "calendar")
            }
        }
        .privacySensitive()
    }

    private func failureList(
        _ failure: UserEventFailurePresentation
    ) -> some View {
        List {
            UserEventFailureRow(failure: failure)
                .accessibilityFocused($statusIsFocused)

            if let retryLabel = failure.retryLabel {
                Button {
                    Task {
                        await model.refresh(authState: authState)
                    }
                } label: {
                    Label(
                        retryLabel,
                        systemImage: "arrow.clockwise"
                    )
                }
                .accessibilityHint(
                    "Attempts to load protected event management again."
                )
            }
        }
    }

    private var hasAdmittedAuthState: Bool {
        if case .admitted = authState {
            return true
        }
        return false
    }

    private func enterProtectedFlow() {
        guard flowLease == nil else { return }
        flowLease = model.enterProtectedFlow()
    }

    private func leaveProtectedFlow() {
        guard let flowLease else { return }
        self.flowLease = nil
        guard
            let exit = model.prepareProtectedFlowExit(flowLease)
        else {
            return
        }
        Task { @MainActor in
            await Task.yield()
            await model.completeProtectedFlowExit(exit)
        }
    }
}

struct UserEventStateRow: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text(message)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(message)")
    }
}

struct UserEventFailureRow: View {
    let failure: UserEventFailurePresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                failure.title,
                systemImage: failure.systemImage
            )
            .font(.headline)
            .foregroundStyle(.red)
            Text(failure.message)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(failure.accessibilityLabel)
    }
}

private struct UserEventManagementRow: View {
    let event: ManagedUserEvent

    var body: some View {
        let presentation = event.managementStatePresentation

        VStack(alignment: .leading, spacing: 6) {
            Text(event.title)
                .font(.headline)
            Text(event.owner.displayName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Label(
                event.start.formatted(
                    date: .abbreviated,
                    time: .shortened
                ),
                systemImage: "calendar"
            )
            .font(.subheadline)
            Label(event.placeName, systemImage: "mappin")
                .font(.subheadline)
            HStack {
                Label(
                    presentation.primaryTitle,
                    systemImage: presentation.primarySystemImage
                )
                if let secondaryTitle = presentation.secondaryTitle,
                    let secondarySystemImage =
                        presentation.secondarySystemImage
                {
                    Label(
                        secondaryTitle,
                        systemImage: secondarySystemImage
                    )
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let deletedAt = presentation.deletedAt {
                Label(
                    "Deleted \(deletedAt.formatted(date: .abbreviated, time: .shortened))",
                    systemImage: "clock"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(event.accessibilitySummary)
    }
}

extension UserEventOwner {
    var displayName: String {
        switch self {
        case .personal:
            return "Personal event"
        case .organization(_, let name):
            return name
        }
    }
}

extension UserEventCategory {
    var displayName: String {
        switch self {
        case .academic:
            return "Academic"
        case .class:
            return "Class"
        case .club:
            return "Club"
        case .arts:
            return "Arts"
        case .athletics:
            return "Athletics"
        case .food:
            return "Food"
        case .social:
            return "Social"
        case .career:
            return "Career"
        case .wellness:
            return "Wellness"
        case .admin:
            return "Administrative"
        }
    }
}

extension UserEventStatus {
    var displayName: String {
        switch self {
        case .draft:
            return "Draft"
        case .published:
            return "Published"
        case .canceled:
            return "Canceled"
        }
    }

    var systemImage: String {
        switch self {
        case .draft:
            return "doc"
        case .published:
            return "checkmark.circle"
        case .canceled:
            return "calendar.badge.minus"
        }
    }
}

extension UserEventModerationState {
    var displayName: String {
        switch self {
        case .active:
            return "Visible"
        case .hidden:
            return "Hidden by moderation"
        }
    }

    var systemImage: String {
        switch self {
        case .active:
            return "eye"
        case .hidden:
            return "eye.slash"
        }
    }
}

struct UserEventManagementStatePresentation: Equatable, Sendable {
    let primaryTitle: String
    let primarySystemImage: String
    let secondaryTitle: String?
    let secondarySystemImage: String?
    let deletedAt: Date?
    let readOnlyTitle: String
    let readOnlyMessage: String

    var accessibilityStatus: String {
        [primaryTitle, secondaryTitle]
            .compactMap { $0 }
            .joined(separator: ". ")
    }
}

struct UserEventReadOnlyDetails: Equatable, Sendable {
    let title: String
    let description: String?
    let start: Date
    let end: Date?
    let placeName: String
    let categoryTitle: String
    let eventURL: URL?
}

extension ManagedUserEvent {
    var managementStatePresentation: UserEventManagementStatePresentation {
        if let deletedAt {
            return UserEventManagementStatePresentation(
                primaryTitle: "Deleted",
                primarySystemImage: "trash",
                secondaryTitle: nil,
                secondarySystemImage: nil,
                deletedAt: deletedAt,
                readOnlyTitle: "Deleted event",
                readOnlyMessage:
                    "This event was deleted and cannot be edited or restored."
            )
        }

        return UserEventManagementStatePresentation(
            primaryTitle: status.displayName,
            primarySystemImage: status.systemImage,
            secondaryTitle: moderationState.displayName,
            secondarySystemImage: moderationState.systemImage,
            deletedAt: nil,
            readOnlyTitle: status == .canceled
                ? "Canceled event"
                : "Read-only event",
            readOnlyMessage: status == .canceled
                ? "This event is no longer publicly visible and cannot be edited."
                : "This event cannot be edited."
        )
    }

    var readOnlyDetails: UserEventReadOnlyDetails {
        UserEventReadOnlyDetails(
            title: title,
            description: description,
            start: start,
            end: end,
            placeName: placeName,
            categoryTitle: category.displayName,
            eventURL: url.flatMap {
                UserEventHTTPSURL.isValid($0) ? $0 : nil
            }
        )
    }

    fileprivate var accessibilitySummary: String {
        var values = [
            title,
            owner.displayName,
            start.formatted(date: .long, time: .shortened),
            placeName,
            managementStatePresentation.accessibilityStatus,
        ]
        if let deletedAt = managementStatePresentation.deletedAt {
            values.append(
                "Deleted \(deletedAt.formatted(date: .long, time: .shortened))"
            )
        }
        return values.joined(separator: ". ")
    }
}

extension UserEventManagementViewModel.State {
    fileprivate var requiresAccessibilityFocus: Bool {
        switch self {
        case .created, .replayed, .conflict, .canceled, .failed:
            return true
        case .authenticationRequired, .loading, .empty, .loaded,
            .submitting, .canceling:
            return false
        }
    }
}
