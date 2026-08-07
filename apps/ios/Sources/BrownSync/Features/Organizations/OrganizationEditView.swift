import Foundation
import SwiftUI

struct OrganizationEditView: View {
    private enum FieldAction: String, CaseIterable, Hashable {
        case keep
        case replace
        case useSource

        var title: String {
            switch self {
            case .keep:
                return "Keep current"
            case .replace:
                return "Replace"
            case .useSource:
                return "Use source value"
            }
        }
    }

    private enum EditableField: Hashable {
        case description
        case about
        case meeting
        case links

        var title: String {
            switch self {
            case .description:
                return "Description"
            case .about:
                return "About"
            case .meeting:
                return "Meeting information"
            case .links:
                return "Links"
            }
        }
    }

    private enum LinkPlatformChoice: String, CaseIterable, Hashable {
        case instagram
        case discord
        case facebook
        case linkedin
        case youtube
        case x
        case tiktok
        case website
        case other

        var title: String {
            switch self {
            case .x:
                return "X"
            default:
                return rawValue.capitalized
            }
        }

        var domainValue: OrganizationLinkPlatform {
            switch self {
            case .instagram:
                return .instagram
            case .discord:
                return .discord
            case .facebook:
                return .facebook
            case .linkedin:
                return .linkedin
            case .youtube:
                return .youtube
            case .x:
                return .x
            case .tiktok:
                return .tiktok
            case .website:
                return .website
            case .other:
                return .other
            }
        }

        init(publicValue: String) {
            self = LinkPlatformChoice(rawValue: publicValue) ?? .other
        }
    }

    private struct LinkDraft: Identifiable {
        let id: UUID
        var platform: LinkPlatformChoice
        var url: String
        var label: String

        init(
            id: UUID = UUID(),
            platform: LinkPlatformChoice = .website,
            url: String = "",
            label: String = ""
        ) {
            self.id = id
            self.platform = platform
            self.url = url
            self.label = label
        }
    }

    private struct OutcomePresentation: Equatable {
        let title: String
        let message: String
        let systemImage: String
    }

    @ObservedObject private var viewModel: OrganizationAdminViewModel

    private let organizationID: String
    private let organizationName: String
    private let organizations: any OrganizationRepository

    @State private var baseline: PublicOrganizationProfile?
    @State private var expectedRevision: Int?
    @State private var isLoadingBaseline = false
    @State private var isSaving = false
    @State private var loadFailure: SafeFailurePresentation?
    @State private var mutationFailure: SafeFailurePresentation?
    @State private var outcome: OutcomePresentation?
    @State private var conflictReview: OrganizationEditConflictReview?
    @State private var requiresConfirmedResubmission = false
    @State private var showResubmissionConfirmation = false
    @State private var pendingUseSourceField: EditableField?

    @State private var descriptionAction: FieldAction = .keep
    @State private var descriptionReplacement = ""
    @State private var aboutAction: FieldAction = .keep
    @State private var aboutReplacement = ""
    @State private var meetingAction: FieldAction = .keep
    @State private var meetingReplacement = ""
    @State private var linksAction: FieldAction = .keep
    @State private var linkDrafts: [LinkDraft] = []
    @State private var lifecycleGeneration: UInt64 = 0

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var errorIsFocused: Bool
    @AccessibilityFocusState private var outcomeIsFocused: Bool
    @AccessibilityFocusState private var conflictIsFocused: Bool

    init(
        viewModel: OrganizationAdminViewModel,
        organizationID: String,
        organizationName: String,
        organizations: any OrganizationRepository
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.organizationID = organizationID
        self.organizationName = organizationName
        self.organizations = organizations
    }

    var body: some View {
        Group {
            if canRenderProtectedContent {
                editForm
            } else {
                List {
                    OrganizationAdminStateRow(
                        title: "Organization editing hidden",
                        message:
                            "Protected drafts and conflict details are available only while BrownSync is active with organization access.",
                        systemImage: "eye.slash"
                    )
                }
            }
        }
        .navigationTitle("Edit \(organizationName)")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: canRenderProtectedContent) {
            guard canRenderProtectedContent else {
                clearProtectedEditState()
                return
            }
            guard baseline == nil, !isLoadingBaseline else { return }
            await loadBaseline(preservingIntent: false)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else {
                clearProtectedEditState()
                return
            }
        }
        .onChange(of: viewModel.state) { _ in
            guard canRenderProtectedContent else {
                clearProtectedEditState()
                return
            }
        }
        .onDisappear {
            clearProtectedEditState()
        }
        .confirmationDialog(
            useSourceConfirmationTitle,
            isPresented: pendingUseSourceBinding,
            titleVisibility: .visible
        ) {
            Button("Use source value", role: .destructive) {
                guard let field = pendingUseSourceField else { return }
                setAction(.useSource, for: field)
                pendingUseSourceField = nil
            }
            Button("Cancel", role: .cancel) {
                pendingUseSourceField = nil
            }
        } message: {
            Text(
                "This removes BrownSync’s override for this field. The current source value will be shown instead."
            )
        }
        .confirmationDialog(
            resubmissionConfirmationTitle,
            isPresented: $showResubmissionConfirmation,
            titleVisibility: .visible
        ) {
            Button("Resubmit changes") {
                Task { await submit() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "This sends your preserved choices once against the latest revision. BrownSync will not merge or overwrite automatically."
            )
        }
    }

    private var editForm: some View {
        Form {
            if isLoadingBaseline, baseline == nil {
                Section {
                    HStack {
                        Spacer()
                        ProgressView("Loading latest organization")
                        Spacer()
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            if let failure = activeFailure {
                failureSection(failure)
            }

            if let outcome {
                Section {
                    Label(outcome.title, systemImage: outcome.systemImage)
                        .font(.headline)
                        .accessibilityFocused($outcomeIsFocused)
                    Text(outcome.message)
                        .foregroundStyle(.secondary)
                }
            }

            if let conflictReview {
                conflictSections(conflictReview)
            }

            if let baseline {
                Section("Editing") {
                    LabeledContent(
                        "Organization",
                        value: baseline.name
                    )
                    LabeledContent(
                        "Baseline revision",
                        value: String(expectedRevision ?? baseline.revision)
                    )
                    Text(
                        "Each field is unchanged until you explicitly replace it or choose its source value."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                descriptionSection(baseline)
                aboutSection(baseline)
                meetingSection(baseline)
                linksSection(baseline)
                saveSection
            }
        }
        .privacySensitive()
    }

    @ViewBuilder
    private func failureSection(
        _ failure: SafeFailurePresentation
    ) -> some View {
        Section {
            Label(failure.title, systemImage: failure.systemImage)
                .font(.headline)
                .foregroundStyle(.red)
                .accessibilityLabel(failure.accessibilityLabel)
                .accessibilityFocused($errorIsFocused)
            Text(failure.message)
                .foregroundStyle(.secondary)

            if baseline == nil, loadFailure != nil {
                Button("Try loading again") {
                    Task {
                        await loadBaseline(preservingIntent: false)
                    }
                }
                .disabled(isLoadingBaseline)
            }
        }
    }

    @ViewBuilder
    private func descriptionSection(
        _ profile: PublicOrganizationProfile
    ) -> some View {
        Section("Description") {
            currentValue(profile.summary)
            actionPicker(for: .description)
            if descriptionAction == .replace {
                TextField(
                    "Replacement description",
                    text: $descriptionReplacement,
                    axis: .vertical
                )
                .lineLimit(3 ... 8)
                .accessibilityHint(
                    "An empty field is saved as a blank override, not as use source value."
                )
                characterCount(
                    descriptionReplacement.utf16.count,
                    limit: 10_000
                )
            }
        }
    }

    @ViewBuilder
    private func aboutSection(
        _ profile: PublicOrganizationProfile
    ) -> some View {
        Section("About") {
            currentValue(profile.about)
            actionPicker(for: .about)
            if aboutAction == .replace {
                TextField(
                    "Replacement about text",
                    text: $aboutReplacement,
                    axis: .vertical
                )
                .lineLimit(4 ... 10)
                .accessibilityHint(
                    "An empty field is saved as a blank override, not as use source value."
                )
                characterCount(
                    aboutReplacement.utf16.count,
                    limit: 20_000
                )
            }
        }
    }

    @ViewBuilder
    private func meetingSection(
        _ profile: PublicOrganizationProfile
    ) -> some View {
        Section("Meeting information") {
            currentValue(profile.meetingInformation)
            actionPicker(for: .meeting)
            if meetingAction == .replace {
                TextField(
                    "Replacement meeting information",
                    text: $meetingReplacement,
                    axis: .vertical
                )
                .lineLimit(2 ... 6)
                .accessibilityHint(
                    "An empty field is saved as a blank override, not as use source value."
                )
                characterCount(
                    meetingReplacement.utf16.count,
                    limit: 4_000
                )
            }
        }
    }

    @ViewBuilder
    private func linksSection(
        _ profile: PublicOrganizationProfile
    ) -> some View {
        Section {
            if profile.links.isEmpty {
                Text("Current: No links")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Current")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(
                        Array(profile.links.enumerated()),
                        id: \.offset
                    ) { _, link in
                        Text(link.label ?? link.url)
                            .font(.callout)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            actionPicker(for: .links)

            if linksAction == .replace {
                if linkDrafts.isEmpty {
                    Text("No links override")
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(
                            "Replacement is an empty list. No links override."
                        )
                }

                ForEach($linkDrafts) { $draft in
                    VStack(alignment: .leading, spacing: 10) {
                        Picker(
                            "Platform",
                            selection: $draft.platform
                        ) {
                            ForEach(
                                LinkPlatformChoice.allCases,
                                id: \.self
                            ) { platform in
                                Text(platform.title).tag(platform)
                            }
                        }

                        TextField("HTTPS URL", text: $draft.url)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        TextField(
                            "Optional label",
                            text: $draft.label
                        )

                        Button("Remove link", role: .destructive) {
                            linkDrafts.removeAll {
                                $0.id == draft.id
                            }
                        }
                        .accessibilityHint(
                            "Removes this link from the replacement list."
                        )
                    }
                    .padding(.vertical, 4)
                }

                Button {
                    linkDrafts.append(LinkDraft())
                } label: {
                    Label("Add link", systemImage: "plus")
                }
                .disabled(linkDrafts.count >= 20)
                .accessibilityHint(
                    "Adds another link to the replacement list."
                )
            }
        } header: {
            Text("Links")
        } footer: {
            if linksAction == .replace {
                Text(
                    "Replacement links require unique HTTPS URLs. An empty replacement list remains a No links override."
                )
            }
        }
    }

    @ViewBuilder
    private var saveSection: some View {
        Section {
            if let validationMessage {
                Label(
                    validationMessage,
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.red)
                .accessibilityLabel("Cannot save. \(validationMessage)")
            } else if patchIsEmpty {
                Text("Choose at least one field to change.")
                    .foregroundStyle(.secondary)
            }

            Button {
                if requiresConfirmedResubmission {
                    showResubmissionConfirmation = true
                } else {
                    Task { await submit() }
                }
            } label: {
                if isSaving {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text(
                        requiresConfirmedResubmission
                            ? "Review resubmission"
                            : "Save changes"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canSave)
            .accessibilityHint(saveAccessibilityHint)
        }
    }

    @ViewBuilder
    private func conflictSections(
        _ review: OrganizationEditConflictReview
    ) -> some View {
        Section {
            Label(
                "Changes weren’t saved",
                systemImage: "arrow.triangle.2.circlepath"
            )
            .font(.headline)
            .accessibilityFocused($conflictIsFocused)

            Text(
                "The organization changed after revision \(review.expectedRevision). Nothing was merged or resubmitted."
            )
            .foregroundStyle(.secondary)
        }

        Section("Compare submitted fields") {
            ForEach(
                Array(review.fields.enumerated()),
                id: \.offset
            ) { _, comparison in
                VStack(alignment: .leading, spacing: 8) {
                    Text(comparison.field.title)
                        .font(.headline)
                    comparisonRow(
                        label: "Baseline",
                        value: conflictValue(
                            comparison.baselineText,
                            field: comparison.field,
                            submitted: false
                        )
                    )
                    comparisonRow(
                        label: "Your proposed",
                        value: conflictValue(
                            comparison.submittedText,
                            field: comparison.field,
                            submitted: true
                        )
                    )
                    comparisonRow(
                        label: "Latest",
                        value: conflictValue(
                            comparison.latestText,
                            field: comparison.field,
                            submitted: false
                        )
                    )
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
        }

        Section {
            Button {
                Task { await reviseAgainstLatest(review) }
            } label: {
                Label(
                    "Revise against latest",
                    systemImage: "arrow.clockwise"
                )
            }
            .disabled(isLoadingBaseline || isSaving)
            .accessibilityHint(
                "Loads the latest profile and revision while preserving your selected edit intent. It does not resubmit."
            )
        }
    }

    private func currentValue(_ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Current")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(displayedCurrentValue(value))
        }
        .accessibilityElement(children: .combine)
    }

    private func actionPicker(
        for field: EditableField
    ) -> some View {
        Picker(
            "\(field.title) action",
            selection: actionBinding(for: field)
        ) {
            ForEach(FieldAction.allCases, id: \.self) { action in
                Text(action.title).tag(action)
            }
        }
        .disabled(
            isSaving
                || isLoadingBaseline
                || conflictReview != nil
        )
        .accessibilityHint(actionAccessibilityHint(for: field))
    }

    private func characterCount(
        _ count: Int,
        limit: Int
    ) -> some View {
        Text("\(count) of \(limit) characters")
            .font(.caption)
            .foregroundStyle(
                count > limit ? Color.red : Color.secondary
            )
            .accessibilityLabel(
                "\(count) of \(limit) characters used"
            )
    }

    private func comparisonRow(
        label: String,
        value: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
        }
    }

    private var canRenderProtectedContent: Bool {
        guard scenePhase == .active else { return false }
        if case .loaded = viewModel.state {
            return true
        }
        return false
    }

    private var activeFailure: SafeFailurePresentation? {
        mutationFailure ?? loadFailure
    }

    private var pendingUseSourceBinding: Binding<Bool> {
        Binding(
            get: { pendingUseSourceField != nil },
            set: { isPresented in
                if !isPresented {
                    pendingUseSourceField = nil
                }
            }
        )
    }

    private var useSourceConfirmationTitle: String {
        guard let field = pendingUseSourceField else {
            return "Use source value?"
        }
        return "Use source value for \(field.title)?"
    }

    private var resubmissionConfirmationTitle: String {
        guard let expectedRevision else {
            return "Resubmit changes?"
        }
        return "Resubmit against revision \(expectedRevision)?"
    }

    private var saveAccessibilityHint: String {
        if requiresConfirmedResubmission {
            return
                "Opens a confirmation before resubmitting once against the latest revision."
        }
        return
            "Sends only the fields explicitly selected for replacement or source value."
    }

    private var patchIsEmpty: Bool {
        descriptionAction == .keep
            && aboutAction == .keep
            && meetingAction == .keep
            && linksAction == .keep
    }

    private var canSave: Bool {
        canRenderProtectedContent
            && baseline != nil
            && expectedRevision != nil
            && conflictReview == nil
            && !patchIsEmpty
            && validationMessage == nil
            && !isLoadingBaseline
            && !isSaving
    }

    private func requireCurrentLifecycle(
        _ expectedGeneration: UInt64
    ) throws {
        guard
            expectedGeneration == lifecycleGeneration,
            canRenderProtectedContent
        else {
            throw CancellationError()
        }
    }

    private func clearProtectedEditState() {
        lifecycleGeneration &+= 1
        baseline = nil
        expectedRevision = nil
        isLoadingBaseline = false
        isSaving = false
        loadFailure = nil
        mutationFailure = nil
        outcome = nil
        conflictReview = nil
        requiresConfirmedResubmission = false
        showResubmissionConfirmation = false
        pendingUseSourceField = nil
        descriptionAction = .keep
        descriptionReplacement = ""
        aboutAction = .keep
        aboutReplacement = ""
        meetingAction = .keep
        meetingReplacement = ""
        linksAction = .keep
        linkDrafts = []
        errorIsFocused = false
        outcomeIsFocused = false
        conflictIsFocused = false
    }

    private var validationMessage: String? {
        if
            descriptionAction == .replace,
            descriptionReplacement.utf16.count > 10_000
        {
            return "Description must be 10,000 characters or fewer."
        }
        if
            aboutAction == .replace,
            aboutReplacement.utf16.count > 20_000
        {
            return "About text must be 20,000 characters or fewer."
        }
        if
            meetingAction == .replace,
            meetingReplacement.utf16.count > 4_000
        {
            return
                "Meeting information must be 4,000 characters or fewer."
        }
        if linksAction == .replace {
            return linkValidationMessage
        }
        return nil
    }

    private var linkValidationMessage: String? {
        guard linkDrafts.count <= 20 else {
            return "Use no more than 20 links."
        }

        var seenURLs: Set<String> = []
        for draft in linkDrafts {
            guard draft.url.utf16.count <= 2_048 else {
                return "Each link URL must be 2,048 characters or fewer."
            }
            guard
                draft.url
                    == draft.url.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ),
                let url = URL(string: draft.url),
                url.scheme?.lowercased() == "https",
                url.host?.isEmpty == false
            else {
                return "Every replacement link needs a valid HTTPS URL."
            }
            guard seenURLs.insert(url.absoluteString).inserted else {
                return "Replacement links must use unique URLs."
            }
            let label = draft.label.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard label.utf16.count <= 80 else {
                return "Each link label must be 80 characters or fewer."
            }
        }
        return nil
    }

    private func actionBinding(
        for field: EditableField
    ) -> Binding<FieldAction> {
        Binding(
            get: { action(for: field) },
            set: { newAction in
                if
                    newAction == .useSource,
                    action(for: field) != .useSource
                {
                    pendingUseSourceField = field
                } else {
                    setAction(newAction, for: field)
                }
            }
        )
    }

    private func action(
        for field: EditableField
    ) -> FieldAction {
        switch field {
        case .description:
            return descriptionAction
        case .about:
            return aboutAction
        case .meeting:
            return meetingAction
        case .links:
            return linksAction
        }
    }

    private func setAction(
        _ action: FieldAction,
        for field: EditableField
    ) {
        switch field {
        case .description:
            descriptionAction = action
        case .about:
            aboutAction = action
        case .meeting:
            meetingAction = action
        case .links:
            linksAction = action
        }
        mutationFailure = nil
        outcome = nil
    }

    private func actionAccessibilityHint(
        for field: EditableField
    ) -> String {
        "Keep \(field.title.lowercased()) unchanged, replace it, or confirm using its source value."
    }

    private func displayedCurrentValue(
        _ value: String?
    ) -> String {
        guard let value else { return "Not provided" }
        return value.isEmpty ? "Blank override" : value
    }

    private func makePatch() -> OrganizationEditPatchIntent? {
        let links: OrganizationEditValue<[OrganizationLink]>
        switch linksAction {
        case .keep:
            links = .unchanged
        case .replace:
            guard let replacementLinks else { return nil }
            links = .set(replacementLinks)
        case .useSource:
            links = .clear
        }

        return OrganizationEditPatchIntent(
            description: stringIntent(
                action: descriptionAction,
                replacement: descriptionReplacement
            ),
            aboutMarkdown: stringIntent(
                action: aboutAction,
                replacement: aboutReplacement
            ),
            meetingInformation: stringIntent(
                action: meetingAction,
                replacement: meetingReplacement
            ),
            links: links
        )
    }

    private func stringIntent(
        action: FieldAction,
        replacement: String
    ) -> OrganizationEditValue<String> {
        switch action {
        case .keep:
            return .unchanged
        case .replace:
            return .set(replacement)
        case .useSource:
            return .clear
        }
    }

    private var replacementLinks: [OrganizationLink]? {
        guard linkValidationMessage == nil else { return nil }
        return linkDrafts.compactMap { draft in
            guard let url = URL(string: draft.url) else { return nil }
            let trimmedLabel = draft.label.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            return OrganizationLink(
                platform: draft.platform.domainValue,
                url: url,
                label: trimmedLabel.isEmpty ? nil : trimmedLabel
            )
        }
    }

    private func loadBaseline(
        preservingIntent: Bool
    ) async {
        guard canRenderProtectedContent else { return }
        let expectedLifecycleGeneration = lifecycleGeneration
        isLoadingBaseline = true
        loadFailure = nil
        defer {
            if expectedLifecycleGeneration == lifecycleGeneration {
                isLoadingBaseline = false
            }
        }

        do {
            let resource = try await organizations.profile(
                id: organizationID,
                at: nil,
                policy: .reload
            )
            try Task.checkCancellation()
            try requireCurrentLifecycle(
                expectedLifecycleGeneration
            )
            guard resource.value.id == organizationID else {
                throw APIError.invalidResponse
            }
            baseline = resource.value
            expectedRevision = resource.value.revision
            if !preservingIntent {
                resetIntent(using: resource.value)
            }
        } catch is CancellationError {
            return
        } catch {
            guard
                expectedLifecycleGeneration == lifecycleGeneration,
                canRenderProtectedContent
            else {
                return
            }
            loadFailure = SafeFailurePresentation.make(for: error)
            errorIsFocused = true
        }
    }

    private func submit() async {
        guard
            let baseline,
            let expectedRevision,
            let patch = makePatch(),
            canSave
        else {
            return
        }
        let expectedLifecycleGeneration = lifecycleGeneration

        isSaving = true
        mutationFailure = nil
        outcome = nil
        defer {
            if expectedLifecycleGeneration == lifecycleGeneration {
                isSaving = false
            }
        }

        do {
            let result = try await viewModel.update(
                organizationID: organizationID,
                baseline: baseline,
                expectedRevision: expectedRevision,
                patch: patch
            )
            try Task.checkCancellation()
            try requireCurrentLifecycle(
                expectedLifecycleGeneration
            )

            switch result {
            case let .updated(_, revision, changed):
                conflictReview = nil
                requiresConfirmedResubmission = false
                outcome = OutcomePresentation(
                    title: changed
                        ? "Changes saved"
                        : "Already current",
                    message: changed
                        ? "The organization was updated at revision \(revision)."
                        : "The server already had these values at revision \(revision).",
                    systemImage: changed
                        ? "checkmark.circle"
                        : "equal.circle"
                )
                await reloadAfterSuccessfulUpdate(
                    expectedLifecycleGeneration:
                        expectedLifecycleGeneration
                )
                try requireCurrentLifecycle(
                    expectedLifecycleGeneration
                )
                if loadFailure == nil {
                    outcomeIsFocused = true
                } else {
                    errorIsFocused = true
                }
            case let .conflict(review):
                conflictReview = review
                requiresConfirmedResubmission = false
                conflictIsFocused = true
            }
        } catch is CancellationError {
            return
        } catch {
            guard
                expectedLifecycleGeneration == lifecycleGeneration,
                canRenderProtectedContent
            else {
                return
            }
            mutationFailure = SafeFailurePresentation.make(for: error)
            errorIsFocused = true
        }
    }

    private func reviseAgainstLatest(
        _ review: OrganizationEditConflictReview
    ) async {
        guard canRenderProtectedContent else { return }
        let expectedLifecycleGeneration = lifecycleGeneration
        isLoadingBaseline = true
        loadFailure = nil
        mutationFailure = nil
        defer {
            if expectedLifecycleGeneration == lifecycleGeneration {
                isLoadingBaseline = false
            }
        }

        do {
            let resource = try await organizations.profile(
                id: organizationID,
                at: nil,
                policy: .reload
            )
            try Task.checkCancellation()
            try requireCurrentLifecycle(
                expectedLifecycleGeneration
            )
            guard
                resource.value.id == organizationID,
                resource.value.revision >= review.latestRevision
            else {
                throw APIError.invalidResponse
            }

            baseline = resource.value
            expectedRevision = resource.value.revision
            conflictReview = nil
            requiresConfirmedResubmission = true
            outcome = OutcomePresentation(
                title: "Review revised changes",
                message:
                    "Your choices are preserved against revision \(resource.value.revision). Nothing has been resubmitted.",
                systemImage: "pencil.and.list.clipboard"
            )
            outcomeIsFocused = true
        } catch is CancellationError {
            return
        } catch {
            guard
                expectedLifecycleGeneration == lifecycleGeneration,
                canRenderProtectedContent
            else {
                return
            }
            loadFailure = SafeFailurePresentation.make(for: error)
            errorIsFocused = true
        }
    }

    private func reloadAfterSuccessfulUpdate(
        expectedLifecycleGeneration: UInt64
    ) async {
        do {
            let resource = try await organizations.profile(
                id: organizationID,
                at: nil,
                policy: .reload
            )
            try Task.checkCancellation()
            try requireCurrentLifecycle(
                expectedLifecycleGeneration
            )
            guard resource.value.id == organizationID else {
                throw APIError.invalidResponse
            }
            baseline = resource.value
            expectedRevision = resource.value.revision
            resetIntent(using: resource.value)
        } catch is CancellationError {
            return
        } catch {
            guard
                expectedLifecycleGeneration == lifecycleGeneration,
                canRenderProtectedContent
            else {
                return
            }
            baseline = nil
            expectedRevision = nil
            loadFailure = SafeFailurePresentation.make(for: error)
            errorIsFocused = true
        }
    }

    private func resetIntent(
        using profile: PublicOrganizationProfile
    ) {
        descriptionAction = .keep
        descriptionReplacement = profile.summary ?? ""
        aboutAction = .keep
        aboutReplacement = profile.about ?? ""
        meetingAction = .keep
        meetingReplacement = profile.meetingInformation ?? ""
        linksAction = .keep
        linkDrafts = profile.links.map {
            LinkDraft(
                platform: LinkPlatformChoice(
                    publicValue: $0.platform
                ),
                url: $0.url,
                label: $0.label ?? ""
            )
        }
    }

    private func conflictValue(
        _ value: String?,
        field: OrganizationEditField,
        submitted: Bool
    ) -> String {
        if submitted, value == nil {
            return "Use source value"
        }
        guard let value else {
            return "Not set"
        }
        guard value.isEmpty else {
            return value
        }
        return field == .links
            ? (submitted ? "No links override" : "No links")
            : (submitted ? "Blank override" : "Blank")
    }
}

private extension OrganizationEditField {
    var title: String {
        switch self {
        case .description:
            return "Description"
        case .aboutMarkdown:
            return "About"
        case .meetingInformation:
            return "Meeting information"
        case .links:
            return "Links"
        }
    }
}
