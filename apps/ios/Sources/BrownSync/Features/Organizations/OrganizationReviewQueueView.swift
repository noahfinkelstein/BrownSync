import Foundation
import SwiftUI

struct OrganizationReviewQueueView: View {
    @ObservedObject private var model: OrganizationAdminViewModel
    private let authState: AuthState

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var errorIsFocused: Bool

    init(
        model: OrganizationAdminViewModel,
        authState: AuthState
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
    }

    var body: some View {
        queueContent
            .navigationTitle("Review Claims")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: authState) {
                guard scenePhase == .active else {
                    model.deactivateReviewQueue()
                    return
                }
                await model.activateReviewQueue(
                    authState: authState
                )
            }
            .onChange(of: scenePhase) { phase in
                switch phase {
                case .active:
                    Task {
                        await model.activateReviewQueue(
                            authState: authState
                        )
                    }
                case .inactive, .background:
                    model.deactivateReviewQueue()
                @unknown default:
                    model.deactivateReviewQueue()
                }
            }
            .onChange(of: model.reviewState) { state in
                errorIsFocused = state.hasVisibleFailure
            }
    }

    @ViewBuilder
    private var queueContent: some View {
        if scenePhase != .active {
            List {
                ReviewQueueStateRow(
                    title: "Review queue hidden",
                    message:
                        "Protected claim information returns only while BrownSync is active.",
                    systemImage: "eye.slash"
                )
            }
        } else if !hasAdmittedAuthState {
            List {
                ReviewQueueStateRow(
                    title: "Brown sign-in required",
                    message:
                        "Sign in with an admitted Brown account to review organization claims.",
                    systemImage: "lock"
                )
            }
        } else {
            switch model.reviewState {
        case .inactive:
            List {
                ReviewQueueStateRow(
                    title: "Review queue is inactive",
                    message:
                        "Load the protected queue to review organization claims.",
                    systemImage: "checklist"
                )
                Button {
                    Task {
                        await model.activateReviewQueue(
                            authState: authState
                        )
                    }
                } label: {
                    Label(
                        "Load review queue",
                        systemImage: "arrow.clockwise"
                    )
                }
                .accessibilityHint(
                    "Loads organization claims available to this Brown account."
                )
            }

        case .authenticationRequired:
            List {
                ReviewQueueStateRow(
                    title: "Brown sign-in required",
                    message:
                        "Sign in with an admitted Brown account to review organization claims.",
                    systemImage: "lock"
                )
            }

        case .loading:
            List {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Loading review queue")
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Loading organization review queue")
            }

        case .empty:
            List {
                ReviewQueueStateRow(
                    title: "No claims to review",
                    message:
                        "There are currently no pending organization claims.",
                    systemImage: "checkmark.circle"
                )
            }

        case let .failed(failure):
            List {
                Section {
                    ReviewFailureSummary(failure: failure)
                        .accessibilityFocused($errorIsFocused)

                    if let retryLabel = failure.retryLabel {
                        Button {
                            Task {
                                await model.activateReviewQueue(
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
                            "Attempts to load the protected review queue again."
                        )
                    }
                }
            }

        case let .loaded(content):
            loadedQueue(content)
            }
        }
    }

    private var hasAdmittedAuthState: Bool {
        if case .admitted = authState {
            return true
        }
        return false
    }

    private func loadedQueue(
        _ content: OrganizationReviewContent
    ) -> some View {
        List {
            if let failure = content.actionFailure {
                Section {
                    ReviewFailureSummary(failure: failure)
                        .accessibilityFocused($errorIsFocused)
                }
            }

            Section("Pending claims") {
                ForEach(content.claims, id: \.claimID) { claim in
                    NavigationLink {
                        OrganizationReviewClaimDetailView(
                            model: model,
                            claimID: claim.claimID
                        )
                    } label: {
                        OrganizationReviewClaimRow(
                            claim: claim,
                            isSubmitting:
                                content.decidingClaimID
                                    == claim.claimID
                        )
                    }
                    .accessibilityHint(
                        "Opens protected claim evidence and review controls."
                    )
                }
            }

            Section {
                reviewPagination(content)
            }
        }
    }

    @ViewBuilder
    private func reviewPagination(
        _ content: OrganizationReviewContent
    ) -> some View {
        switch content.loadMoreState {
        case .idle:
            if content.next != nil {
                Button {
                    Task {
                        await model.loadNextReviewPage()
                    }
                } label: {
                    Label(
                        "Load more claims",
                        systemImage: "arrow.down.circle"
                    )
                }
                .accessibilityHint(
                    "Appends the next page in server review order."
                )
            } else {
                Label(
                    "All claims loaded",
                    systemImage: "checkmark.circle"
                )
                .foregroundStyle(.secondary)
            }

        case .loading:
            HStack(spacing: 12) {
                ProgressView()
                Text("Loading more claims")
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Loading more organization claims")

        case let .failed(failure):
            VStack(alignment: .leading, spacing: 12) {
                ReviewFailureSummary(failure: failure)
                    .accessibilityFocused($errorIsFocused)

                if let retryLabel = failure.retryLabel {
                    Button {
                        Task {
                            await model.loadNextReviewPage()
                        }
                    } label: {
                        Label(
                            retryLabel,
                            systemImage: "arrow.clockwise"
                        )
                    }
                    .accessibilityHint(
                        "Retries only the next review page and keeps the claims already shown."
                    )
                }
            }

        case .complete:
            Label(
                "All claims loaded",
                systemImage: "checkmark.circle"
            )
            .foregroundStyle(.secondary)
        }
    }
}

private struct OrganizationReviewClaimRow: View {
    let claim: OrganizationReviewableClaim
    let isSubmitting: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(
                    claim.organizationName,
                    systemImage: "building.2"
                )
                .font(.headline)

                Spacer(minLength: 8)

                if isSubmitting {
                    ProgressView()
                        .accessibilityLabel("Recording claim decision")
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(claim.claimantPrimaryText)
                    .font(.subheadline)

                if let handle = claim.claimantSecondaryHandle {
                    Text(handle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .privacySensitive()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Claimant")
            .accessibilityValue(claim.claimantAccessibilityValue)

            Label(
                claim.createdAt.formatted(
                    date: .abbreviated,
                    time: .shortened
                ),
                systemImage: "calendar"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityLabel(
                "Submitted \(claim.createdAt.formatted(date: .long, time: .shortened))"
            )
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}

private struct OrganizationReviewClaimDetailView: View {
    private enum PendingDecision: Equatable {
        case approve
        case reject

        var title: String {
            switch self {
            case .approve:
                return "Approve this claim?"
            case .reject:
                return "Reject this claim?"
            }
        }

        var confirmationLabel: String {
            switch self {
            case .approve:
                return "Confirm approval"
            case .reject:
                return "Confirm rejection"
            }
        }

        var confirmationMessage: String {
            switch self {
            case .approve:
                return
                    "This records an approval decision for this claim."
            case .reject:
                return
                    "This records a rejection decision for this claim."
            }
        }

        var buttonRole: ButtonRole? {
            switch self {
            case .approve:
                return nil
            case .reject:
                return .destructive
            }
        }

        var approvesClaim: Bool {
            self == .approve
        }
    }

    private enum DecisionNotice: Equatable {
        case recorded(
            status: OrganizationClaimStatus,
            changed: Bool
        )
        case failed(SafeFailurePresentation)

        var isRecorded: Bool {
            if case .recorded = self {
                return true
            }
            return false
        }
    }

    @ObservedObject private var model: OrganizationAdminViewModel
    let claimID: UUID

    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var pendingDecision: PendingDecision?
    @State private var decisionNotice: DecisionNotice?
    @AccessibilityFocusState private var noticeIsFocused: Bool

    init(
        model: OrganizationAdminViewModel,
        claimID: UUID
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.claimID = claimID
    }

    var body: some View {
        Form {
            if let decisionNotice {
                decisionNoticeSection(decisionNotice)
            }

            if let currentClaim {
                protectedClaimSections(currentClaim)
            } else if decisionNotice?.isRecorded != true {
                Section {
                    ReviewQueueStateRow(
                        title: "Claim no longer available",
                        message:
                            "This protected claim is no longer present in the active review queue.",
                        systemImage: "lock"
                    )
                }
            }
        }
        .navigationTitle("Review Claim")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            pendingDecision?.title ?? "Confirm claim decision",
            isPresented: Binding(
                get: { pendingDecision != nil },
                set: {
                    if !$0 {
                        pendingDecision = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            if let pendingDecision {
                Button(
                    pendingDecision.confirmationLabel,
                    role: pendingDecision.buttonRole
                ) {
                    submit(pendingDecision)
                }
            }

            Button("Cancel", role: .cancel) {
                pendingDecision = nil
            }
        } message: {
            if let pendingDecision {
                Text(pendingDecision.confirmationMessage)
            }
        }
        .onChange(of: model.reviewState) { _ in
            guard currentClaim != nil else {
                pendingDecision = nil
                if decisionNotice?.isRecorded != true {
                    note = ""
                }
                return
            }
        }
        .onDisappear {
            note = ""
            pendingDecision = nil
            decisionNotice = nil
        }
    }

    @ViewBuilder
    private func protectedClaimSections(
        _ claim: OrganizationReviewableClaim
    ) -> some View {
        Section("Organization") {
            Label(
                claim.organizationName,
                systemImage: "building.2"
            )
            .font(.headline)
        }

        Section("Claimant") {
            VStack(alignment: .leading, spacing: 4) {
                Text(claim.claimantPrimaryText)

                if let handle = claim.claimantSecondaryHandle {
                    Text(handle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .privacySensitive()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Claimant")
            .accessibilityValue(claim.claimantAccessibilityValue)
            .accessibilityHint(
                "Protected identity shown only in the active review queue."
            )

            LabeledContent("Submitted") {
                Text(
                    claim.createdAt.formatted(
                        date: .abbreviated,
                        time: .shortened
                    )
                )
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                "Submitted \(claim.createdAt.formatted(date: .long, time: .shortened))"
            )
        }

        Section("Evidence") {
            if let evidence = claim.nonBlankEvidence {
                Text(evidence)
                    .privacySensitive()
                    .accessibilityLabel("Claim evidence")
                    .accessibilityValue(evidence)
                    .accessibilityHint(
                        "Protected evidence submitted with this claim."
                    )
            } else {
                Label(
                    "No evidence submitted",
                    systemImage: "doc.text"
                )
                .foregroundStyle(.secondary)
                .accessibilityLabel("Claim evidence. None submitted.")
            }
        }

        Section {
            TextEditor(text: $note)
                .frame(minHeight: 96)
                .disabled(isAnyClaimSubmitting)
                .privacySensitive()
                .accessibilityLabel("Optional review note")
                .accessibilityHint(
                    "Adds a protected note to the confirmed decision. Blank notes are not submitted."
                )
        } header: {
            Text("Optional review note")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text("Whitespace-only notes are not submitted.")
                OrganizationCharacterCount(
                    current: normalizedReviewNote.utf16.count,
                    limit: 2_000
                )
            }
        }

        Section("Decision") {
            if isThisClaimSubmitting {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Recording decision")
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Recording claim decision")
            }

            Button {
                pendingDecision = .approve
            } label: {
                Label(
                    "Approve claim",
                    systemImage: "checkmark.circle"
                )
                .frame(
                    maxWidth: .infinity,
                    minHeight: 44,
                    alignment: .leading
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canSubmitDecision)
            .accessibilityLabel("Approve claim")
            .accessibilityHint(
                "Opens a confirmation before recording an approval."
            )

            Button(role: .destructive) {
                pendingDecision = .reject
            } label: {
                Label(
                    "Reject claim",
                    systemImage: "xmark.circle"
                )
                .frame(
                    maxWidth: .infinity,
                    minHeight: 44,
                    alignment: .leading
                )
            }
            .buttonStyle(.bordered)
            .disabled(!canSubmitDecision)
            .accessibilityLabel("Reject claim")
            .accessibilityHint(
                "Opens a confirmation before recording a rejection."
            )
        }
    }

    @ViewBuilder
    private func decisionNoticeSection(
        _ notice: DecisionNotice
    ) -> some View {
        Section {
            switch notice {
            case let .recorded(status, changed):
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        decisionTitle(
                            status: status,
                            changed: changed
                        ),
                        systemImage: decisionSystemImage(
                            status: status,
                            changed: changed
                        )
                    )
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($noticeIsFocused)

                    Text(
                        decisionMessage(
                            status: status,
                            changed: changed
                        )
                    )

                    Button {
                        dismiss()
                    } label: {
                        Label(
                            "Return to review queue",
                            systemImage: "chevron.backward"
                        )
                    }
                    .accessibilityHint(
                        "Returns to the queue where this claim is no longer listed."
                    )
                }
            case let .failed(failure):
                ReviewFailureSummary(failure: failure)
                    .accessibilityFocused($noticeIsFocused)
            }
        }
    }

    private var currentClaim: OrganizationReviewableClaim? {
        guard case let .loaded(content) = model.reviewState else {
            return nil
        }
        return content.claims.first {
            $0.claimID == claimID
        }
    }

    private var isAnyClaimSubmitting: Bool {
        guard case let .loaded(content) = model.reviewState else {
            return false
        }
        return content.decidingClaimID != nil
    }

    private var isThisClaimSubmitting: Bool {
        guard case let .loaded(content) = model.reviewState else {
            return false
        }
        return content.decidingClaimID == claimID
    }

    private var normalizedReviewNote: String {
        note.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmitDecision: Bool {
        currentClaim != nil
            && !isAnyClaimSubmitting
            && normalizedReviewNote.utf16.count <= 2_000
    }

    private func submit(_ decision: PendingDecision) {
        guard canSubmitDecision else { return }
        pendingDecision = nil
        decisionNotice = nil

        let normalizedNote =
            normalizedReviewNote.isEmpty ? nil : normalizedReviewNote

        Task {
            do {
                let outcome = try await model.decideClaim(
                    claimID: claimID,
                    approve: decision.approvesClaim,
                    note: normalizedNote
                )
                note = ""
                decisionNotice = .recorded(
                    status: outcome.status,
                    changed: outcome.changed
                )
                noticeIsFocused = true
            } catch is CancellationError {
                return
            } catch {
                decisionNotice = .failed(
                    SafeFailurePresentation.make(for: error)
                )
                noticeIsFocused = true
            }
        }
    }

    private func decisionTitle(
        status: OrganizationClaimStatus,
        changed: Bool
    ) -> String {
        guard changed else {
            return "Decision already recorded"
        }

        switch status {
        case .approved:
            return "Claim approved"
        case .rejected:
            return "Claim rejected"
        case .pending:
            return "Decision recorded"
        }
    }

    private func decisionMessage(
        status: OrganizationClaimStatus,
        changed: Bool
    ) -> String {
        guard changed else {
            return
                "The server had already recorded this decision. The claim was removed from this review queue."
        }

        switch status {
        case .approved:
            return
                "The approval was recorded and the claim was removed from this review queue."
        case .rejected:
            return
                "The rejection was recorded and the claim was removed from this review queue."
        case .pending:
            return
                "The review result was recorded and the claim was removed from this review queue."
        }
    }

    private func decisionSystemImage(
        status: OrganizationClaimStatus,
        changed: Bool
    ) -> String {
        guard changed else {
            return "checkmark.circle"
        }

        switch status {
        case .approved:
            return "checkmark.circle"
        case .rejected:
            return "xmark.circle"
        case .pending:
            return "info.circle"
        }
    }
}

private struct ReviewQueueStateRow: View {
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

private struct ReviewFailureSummary: View {
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

private extension OrganizationAdminViewModel.ReviewState {
    var hasVisibleFailure: Bool {
        switch self {
        case .failed:
            return true
        case let .loaded(content):
            if content.actionFailure != nil {
                return true
            }
            if case .failed = content.loadMoreState {
                return true
            }
            return false
        case .inactive, .authenticationRequired, .loading, .empty:
            return false
        }
    }
}

private extension OrganizationReviewableClaim {
    var claimantPrimaryText: String {
        nonBlank(claimantDisplayName)
            ?? normalizedClaimantHandle
            ?? "Brown community member"
    }

    var claimantSecondaryHandle: String? {
        guard nonBlank(claimantDisplayName) != nil else {
            return nil
        }
        return normalizedClaimantHandle
    }

    var claimantAccessibilityValue: String {
        let primary = claimantPrimaryText
        guard
            let handle = normalizedClaimantHandle,
            handle != primary
        else {
            return primary
        }
        return "\(primary), \(handle)"
    }

    var nonBlankEvidence: String? {
        nonBlank(evidence)
    }

    private var normalizedClaimantHandle: String? {
        guard let handle = nonBlank(claimantHandle) else {
            return nil
        }
        if handle.hasPrefix("@") {
            return handle
        }
        return "@\(handle)"
    }
}

private func nonBlank(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return trimmed.isEmpty ? nil : trimmed
}
