import Foundation
import SwiftUI

struct OrganizationClaimView: View {
    private struct OutcomePresentation: Equatable {
        let title: String
        let message: String
        let systemImage: String
    }

    @ObservedObject private var model: OrganizationAdminViewModel
    private let authState: AuthState
    private let organizations: any OrganizationRepository
    private let preselectedOrganization: PublicOrganization?

    @State private var availableOrganizations: [PublicOrganization] = []
    @State private var publicSource: PublicDataSource?
    @State private var selectedOrganization: PublicOrganization?
    @State private var evidence = ""
    @State private var isLoadingOrganizations = false
    @State private var isSubmitting = false
    @State private var loadFailure: SafeFailurePresentation?
    @State private var mutationFailure: SafeFailurePresentation?
    @State private var outcome: OutcomePresentation?

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var errorIsFocused: Bool
    @AccessibilityFocusState private var outcomeIsFocused: Bool

    init(
        model: OrganizationAdminViewModel,
        authState: AuthState,
        organizations: any OrganizationRepository,
        preselectedOrganization: PublicOrganization?
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
        self.organizations = organizations
        self.preselectedOrganization = preselectedOrganization
        _selectedOrganization = State(
            initialValue: preselectedOrganization
        )
    }

    var body: some View {
        Group {
            if canRenderProtectedForm {
                claimForm
            } else {
                List {
                    OrganizationAdminStateRow(
                        title: "Brown sign-in required",
                        message:
                            "Sign in with an admitted Brown account to claim an organization.",
                        systemImage: "lock"
                    )
                }
            }
        }
        .navigationTitle("Claim Organization")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: authState) {
            guard scenePhase == .active else { return }
            await activateAndLoad()
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else {
                clearProtectedClaimState()
                return
            }
            Task {
                await activateAndLoad()
            }
        }
        .onChange(of: authState) { state in
            guard case .admitted = state else {
                clearProtectedClaimState()
                return
            }
        }
        .onChange(of: model.state) { state in
            if case .authenticationRequired = state {
                clearProtectedClaimState()
            }
        }
        .onDisappear {
            clearProtectedClaimState()
        }
    }

    private var claimForm: some View {
        Form {
            if let failure = mutationFailure ?? loadFailure {
                Section {
                    OrganizationAdminFailureRow(failure: failure)
                        .accessibilityFocused($errorIsFocused)

                    if
                        loadFailure != nil,
                        let retryLabel = failure.retryLabel
                    {
                        Button {
                            Task {
                                await loadOrganizations(
                                    policy: .reload
                                )
                            }
                        } label: {
                            Label(
                                retryLabel,
                                systemImage: "arrow.clockwise"
                            )
                        }
                        .accessibilityHint(
                            "Reloads the safe public organization list."
                        )
                    }
                }
            }

            if let outcome {
                Section {
                    Label(
                        outcome.title,
                        systemImage: outcome.systemImage
                    )
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($outcomeIsFocused)

                    Text(outcome.message)

                    Button {
                        resetForAnotherClaim()
                    } label: {
                        Label(
                            "Claim another organization",
                            systemImage: "hand.raised"
                        )
                    }
                    .accessibilityHint(
                        "Clears the outcome and returns to the public organization picker."
                    )
                }
                .privacySensitive()
            }

            Section {
                if isLoadingOrganizations {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Loading organizations")
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        "Loading public organizations"
                    )
                } else if availableOrganizations.isEmpty {
                    OrganizationAdminStateRow(
                        title: "No organizations available",
                        message:
                            "The public organization list is currently empty.",
                        systemImage: "building.2"
                    )
                } else {
                    if let publicSource {
                        PublicSourceLabel(source: publicSource)
                    }

                    Picker(
                        "Organization",
                        selection: $selectedOrganization
                    ) {
                        Text("Select an organization")
                            .tag(
                                Optional<PublicOrganization>.none
                            )

                        ForEach(availableOrganizations) {
                            organization in
                            Text(organization.name)
                                .tag(Optional(organization))
                        }
                    }
                    .accessibilityLabel("Public organization")
                    .accessibilityHint(
                        "Choose by public name. BrownSync never asks you to enter an internal organization identifier."
                    )

                    if let selectedOrganization {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(
                                selectedOrganization.name,
                                systemImage: "building.2"
                            )
                            .font(.headline)

                            Text(
                                selectedOrganization.category
                                    ?? selectedOrganization.kind
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            } header: {
                Text("Public organization")
            }

            Section {
                TextEditor(text: $evidence)
                    .frame(minHeight: 120)
                    .disabled(isSubmitting)
                    .privacySensitive()
                    .accessibilityLabel("Optional claim evidence")
                    .accessibilityHint(
                        "Protected evidence sent only with this claim. Whitespace-only evidence is not submitted."
                    )
            } header: {
                Text("Optional evidence")
            } footer: {
                OrganizationCharacterCount(
                    current: normalizedEvidence.utf16.count,
                    limit: 2_000
                )
            }

            if let validationMessage {
                Section {
                    Label(
                        validationMessage,
                        systemImage: "exclamationmark.triangle"
                    )
                    .foregroundStyle(.red)
                    .accessibilityLabel(
                        "Cannot submit claim. \(validationMessage)"
                    )
                }
            }

            Section {
                Button {
                    Task {
                        await submit()
                    }
                } label: {
                    if isSubmitting {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Submitting claim")
                        }
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 44
                        )
                    } else {
                        Label(
                            "Submit claim",
                            systemImage: "hand.raised.fill"
                        )
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 44
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSubmit)
                .accessibilityHint(
                    "Submits a claim for the selected public organization."
                )
            }
        }
    }

    private var canRenderProtectedForm: Bool {
        guard case .admitted = authState else { return false }
        guard scenePhase == .active else { return false }
        if case .authenticationRequired = model.state {
            return false
        }
        return true
    }

    private var normalizedEvidence: String {
        evidence.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
    }

    private var validationMessage: String? {
        guard selectedOrganization != nil else {
            return "Choose a public organization."
        }
        guard normalizedEvidence.utf16.count <= 2_000 else {
            return "Evidence must be 2,000 characters or fewer."
        }
        return nil
    }

    private var canSubmit: Bool {
        validationMessage == nil
            && !isSubmitting
            && outcome == nil
            && model.state.allowsOrganizationMutation
    }

    private func loadOrganizations(
        policy: PublicLoadPolicy
    ) async {
        isLoadingOrganizations = true
        loadFailure = nil
        defer { isLoadingOrganizations = false }

        do {
            let resource = try await organizations.organizations(
                policy: policy
            )
            try Task.checkCancellation()

            availableOrganizations = resource.value
            publicSource = resource.source

            let selectedID =
                selectedOrganization?.id
                    ?? preselectedOrganization?.id
            selectedOrganization = selectedID.flatMap { id in
                resource.value.first {
                    $0.id == id
                }
            }
        } catch is CancellationError {
            return
        } catch {
            loadFailure = SafeFailurePresentation.make(for: error)
            errorIsFocused = true
        }
    }

    private func activateAndLoad() async {
        await model.activate(authState: authState)
        guard case .admitted = authState else { return }
        if availableOrganizations.isEmpty,
            !isLoadingOrganizations
        {
            await loadOrganizations(policy: .useCache)
        }
    }

    private func submit() async {
        guard
            canSubmit,
            let selectedOrganization
        else {
            return
        }

        isSubmitting = true
        mutationFailure = nil
        defer { isSubmitting = false }

        do {
            let result = try await model.claim(
                organizationID: selectedOrganization.id,
                evidence:
                    normalizedEvidence.isEmpty
                        ? nil
                        : normalizedEvidence
            )
            try Task.checkCancellation()

            outcome = claimOutcomePresentation(result)
            evidence = ""
            outcomeIsFocused = true
            await model.refresh(authState: authState)
        } catch is CancellationError {
            return
        } catch {
            mutationFailure = SafeFailurePresentation.make(
                for: error
            )
            errorIsFocused = true
        }
    }

    private func claimOutcomePresentation(
        _ result: OrganizationClaimOutcome
    ) -> OutcomePresentation {
        switch result {
        case let .autoApproved(role, _):
            return OutcomePresentation(
                title: "Claim approved automatically",
                message:
                    "Your \(role.localizedTitle.lowercased()) access was recorded.",
                systemImage: "checkmark.circle"
            )
        case .pending:
            return OutcomePresentation(
                title: "Claim submitted for review",
                message:
                    "The claim is pending review. No organization access has been granted yet.",
                systemImage: "clock"
            )
        case let .alreadyAdmin(role):
            return OutcomePresentation(
                title: "Already an organization admin",
                message:
                    "You already have \(role.localizedTitle.lowercased()) access to this organization.",
                systemImage: "person.badge.shield.checkmark"
            )
        case .replayedPending:
            return OutcomePresentation(
                title: "Claim already pending",
                message:
                    "The same pending claim was already recorded. It was not submitted twice.",
                systemImage: "arrow.clockwise.circle"
            )
        }
    }

    private func resetForAnotherClaim() {
        selectedOrganization = nil
        evidence = ""
        mutationFailure = nil
        outcome = nil
    }

    private func clearProtectedClaimState() {
        evidence = ""
        mutationFailure = nil
        outcome = nil
        isSubmitting = false
    }
}
