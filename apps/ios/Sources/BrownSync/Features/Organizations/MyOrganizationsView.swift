import Foundation
import SwiftUI

struct MyOrganizationsView: View {
    @ObservedObject private var model: OrganizationAdminViewModel
    private let authState: AuthState
    private let organizations: any OrganizationRepository

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var errorIsFocused: Bool
    @State private var presentsReviewQueue = false

    init(
        model: OrganizationAdminViewModel,
        authState: AuthState,
        organizations: any OrganizationRepository
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
        self.organizations = organizations
    }

    var body: some View {
        content
            .navigationTitle("My Organizations")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: authState) {
                guard scenePhase == .active else { return }
                await model.activate(authState: authState)
            }
            .onChange(of: scenePhase) { phase in
                guard phase == .active else {
                    errorIsFocused = false
                    return
                }
                Task {
                    await model.activate(authState: authState)
                }
            }
            .onChange(of: model.state) { state in
                errorIsFocused = state.hasFailure
            }
            .onChange(of: model.accessFailure) { failure in
                errorIsFocused = failure != nil
            }
            .sheet(
                isPresented: $presentsReviewQueue,
                onDismiss: {
                    let purge = model.deactivateReviewQueue()
                    Task {
                        await purge.value
                    }
                }
            ) {
                NavigationStack {
                    OrganizationReviewQueueView(
                        model: model,
                        authState: authState
                    )
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if scenePhase != .active {
            List {
                OrganizationAdminStateRow(
                    title: "Organization access hidden",
                    message:
                        "Protected organization information returns when BrownSync is active.",
                    systemImage: "eye.slash"
                )
            }
        } else if !hasAdmittedAuthState {
            List {
                OrganizationAdminStateRow(
                    title: "Brown sign-in required",
                    message:
                        "Sign in with an admitted Brown account to manage organizations.",
                    systemImage: "lock"
                )
            }
        } else {
            switch model.state {
        case .authenticationRequired:
            List {
                OrganizationAdminStateRow(
                    title: "Brown sign-in required",
                    message:
                        "Sign in with an admitted Brown account to manage organizations.",
                    systemImage: "lock"
                )
            }

        case .loading:
            List {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Loading your organizations")
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Loading your organizations")
            }

        case .empty:
            List {
                OrganizationAdminStateRow(
                    title: "No organization access yet",
                    message:
                        "Create a new organization or claim an existing public organization.",
                    systemImage: "building.2"
                )
                managementActions
            }
            .refreshable {
                await model.refresh(authState: authState)
            }

        case let .loaded(snapshot):
            organizationList(snapshot)

        case let .failed(failure):
            List {
                Section {
                    OrganizationAdminFailureRow(failure: failure)
                        .accessibilityFocused($errorIsFocused)

                    if let retryLabel = failure.retryLabel {
                        Button {
                            Task {
                                await model.activate(
                                    authState: authState
                                )
                            }
                        } label: {
                            Label(
                                retryLabel,
                                systemImage: "arrow.clockwise"
                            )
                        }
                        .accessibilityHint(
                            "Attempts to load protected organization access again."
                        )
                    }
                }
            }
            }
        }
    }

    private var hasAdmittedAuthState: Bool {
        if case .admitted = authState {
            return true
        }
        return false
    }

    private func organizationList(
        _ snapshot: OrganizationAccessSnapshot
    ) -> some View {
        List {
            if let failure = model.accessFailure {
                Section {
                    OrganizationAdminFailureRow(failure: failure)
                        .accessibilityFocused($errorIsFocused)

                    if let retryLabel = failure.retryLabel {
                        Button {
                            Task {
                                await model.refresh(
                                    authState: authState
                                )
                            }
                        } label: {
                            Label(
                                retryLabel,
                                systemImage: "arrow.clockwise"
                            )
                        }
                        .accessibilityHint(
                            "Retries refreshing your protected organization access."
                        )
                    }
                }
            }

            managementActions

            Section("Organizations you manage") {
                if snapshot.memberships.isEmpty {
                    Text("No organization memberships.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(
                        snapshot.memberships,
                        id: \.organizationID
                    ) { membership in
                        NavigationLink {
                            OrganizationEditView(
                                viewModel: model,
                                organizationID:
                                    membership.organizationID,
                                organizationName:
                                    membership.organizationName,
                                organizations: organizations
                            )
                        } label: {
                            OrganizationMembershipRow(
                                membership: membership
                            )
                        }
                        .accessibilityHint(
                            "Opens explicit organization editing controls."
                        )
                    }
                }
            }

            Section("Your claims") {
                if snapshot.claims.isEmpty {
                    Text("No organization claims.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.claims, id: \.id) { claim in
                        OrganizationClaimSummaryRow(claim: claim)
                    }
                }
            }
        }
        .refreshable {
            await model.refresh(authState: authState)
        }
    }

    @ViewBuilder
    private var managementActions: some View {
        Section("Organization actions") {
            NavigationLink {
                OrganizationCreateView(
                    model: model,
                    authState: authState
                )
            } label: {
                Label(
                    "Create an organization",
                    systemImage: "plus.circle"
                )
            }
            .accessibilityHint(
                "Opens a form for a new organization."
            )

            NavigationLink {
                OrganizationClaimView(
                    model: model,
                    authState: authState,
                    organizations: organizations,
                    preselectedOrganization: nil
                )
            } label: {
                Label(
                    "Claim an existing organization",
                    systemImage: "hand.raised"
                )
            }
            .accessibilityHint(
                "Choose a public organization and optionally provide protected evidence."
            )

            Button {
                presentsReviewQueue = true
            } label: {
                Label(
                    "Review organization claims",
                    systemImage: "checklist"
                )
            }
            .accessibilityHint(
                "Opens the protected claim review queue when this account is authorized."
            )
        }
    }
}

private struct OrganizationMembershipRow: View {
    let membership: OrganizationMembership

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(membership.organizationName)
                .font(.headline)

            Label(
                membership.role.localizedTitle,
                systemImage: membership.role.systemImage
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .accessibilityLabel(
                "Organization role, \(membership.role.localizedTitle)"
            )

            Text(
                "Granted \(membership.grantedAt.formatted(date: .abbreviated, time: .omitted))"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .privacySensitive()
        .accessibilityElement(children: .combine)
    }
}

private struct OrganizationClaimSummaryRow: View {
    let claim: OrganizationClaimSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(claim.organizationName)
                .font(.headline)

            Label(
                claim.status.localizedTitle,
                systemImage: claim.status.systemImage
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .accessibilityLabel(
                "Claim status, \(claim.status.localizedTitle)"
            )

            Text(
                "Submitted \(claim.createdAt.formatted(date: .abbreviated, time: .shortened))"
            )
            .font(.caption)
            .foregroundStyle(.secondary)

            if let reviewedAt = claim.reviewedAt {
                Text(
                    "Reviewed \(reviewedAt.formatted(date: .abbreviated, time: .shortened))"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if let reviewNote = nonBlankOrganizationText(
                claim.reviewNote
            ) {
                LabeledContent("Review note") {
                    Text(reviewNote)
                        .multilineTextAlignment(.trailing)
                }
                .font(.caption)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 4)
        .privacySensitive()
        .accessibilityElement(children: .combine)
    }
}

struct OrganizationAdminStateRow: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)

            Text(message)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }
}

struct OrganizationAdminFailureRow: View {
    let failure: SafeFailurePresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(
                failure.title,
                systemImage: failure.systemImage
            )
            .font(.headline)
            .accessibilityAddTraits(.isHeader)

            Text(failure.message)
        }
        .foregroundStyle(.red)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(failure.accessibilityLabel)
    }
}

private extension OrganizationAdminViewModel.State {
    var hasFailure: Bool {
        if case .failed = self {
            return true
        }
        return false
    }
}

extension OrganizationRole {
    var localizedTitle: String {
        switch self {
        case .owner:
            return "Owner"
        case .editor:
            return "Editor"
        }
    }

    var systemImage: String {
        switch self {
        case .owner:
            return "crown"
        case .editor:
            return "pencil"
        }
    }
}

extension OrganizationClaimStatus {
    var localizedTitle: String {
        switch self {
        case .pending:
            return "Pending review"
        case .approved:
            return "Approved"
        case .rejected:
            return "Rejected"
        }
    }

    var systemImage: String {
        switch self {
        case .pending:
            return "clock"
        case .approved:
            return "checkmark.circle"
        case .rejected:
            return "xmark.circle"
        }
    }
}

func nonBlankOrganizationText(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return trimmed.isEmpty ? nil : trimmed
}
