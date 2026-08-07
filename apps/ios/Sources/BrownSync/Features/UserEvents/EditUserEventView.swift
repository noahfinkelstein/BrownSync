import Foundation
import SwiftUI

struct UserEventEditProtectedFormState: Equatable, Sendable {
    private(set) var ownerID: UUID?
    var baseline: ManagedUserEvent?
    var titleText: String
    var descriptionText: String
    var start: Date
    var end: Date
    var category: UserEventCategory
    var urlText: String
    var selectedPlaceID: String
    var places: [PublicPlace]
    var placeSearch: String
    var placeLoadFailure: String?
    var validationMessage: String?
    var successMessage: String?

    init(event: ManagedUserEvent, ownerID: UUID?) {
        self.ownerID = ownerID
        baseline = event
        titleText = event.title
        descriptionText = event.description ?? ""
        start = event.start
        end =
            event.end
            ?? event.start.addingTimeInterval(60 * 60)
        category = event.category
        urlText = event.url?.absoluteString ?? ""
        selectedPlaceID = event.canonicalPlaceID
        places = []
        placeSearch = ""
        placeLoadFailure = nil
        validationMessage = nil
        successMessage = nil
        if ownerID == nil {
            purge()
        }
    }

    func canRender(for ownerID: UUID) -> Bool {
        self.ownerID == ownerID && baseline != nil
    }

    mutating func applyAcceptedBaseline(_ event: ManagedUserEvent) {
        baseline = event
        titleText = event.title
        descriptionText = event.description ?? ""
        start = event.start
        end =
            event.end
            ?? event.start.addingTimeInterval(60 * 60)
        category = event.category
        urlText = event.url?.absoluteString ?? ""
        selectedPlaceID = event.canonicalPlaceID
        placeSearch = ""
    }

    mutating func rebase(
        to event: ManagedUserEvent,
        preserving patch: UserEventEditPatchIntent
    ) {
        baseline = event
        if case .unchanged = patch.title {
            titleText = event.title
        }
        if case .unchanged = patch.description {
            descriptionText = event.description ?? ""
        }
        if case .unchanged = patch.start {
            start = event.start
        }
        if case .unchanged = patch.end {
            end =
                event.end
                ?? event.start.addingTimeInterval(60 * 60)
        }
        if case .unchanged = patch.category {
            category = event.category
        }
        if case .unchanged = patch.url {
            urlText = event.url?.absoluteString ?? ""
        }
        if case .unchanged = patch.canonicalPlaceID {
            selectedPlaceID = event.canonicalPlaceID
        }
        placeSearch = ""
    }

    mutating func purge() {
        ownerID = nil
        baseline = nil
        titleText = ""
        descriptionText = ""
        start = .distantPast
        end = .distantPast
        category = .academic
        urlText = ""
        selectedPlaceID = ""
        places = []
        placeSearch = ""
        placeLoadFailure = nil
        validationMessage = nil
        successMessage = nil
    }
}

struct EditUserEventView: View {
    private enum SetAction: String, CaseIterable, Hashable {
        case keep
        case set

        var title: String {
            switch self {
            case .keep:
                return "Keep current"
            case .set:
                return "Replace"
            }
        }
    }

    private enum NullableAction: String, CaseIterable, Hashable {
        case keep
        case set
        case clear

        var title: String {
            switch self {
            case .keep:
                return "Keep current"
            case .set:
                return "Replace"
            case .clear:
                return "Clear"
            }
        }
    }

    @ObservedObject private var model: UserEventManagementViewModel
    private let authState: AuthState
    private let placesRepository: any PlaceRepository

    @State private var protectedForm: UserEventEditProtectedFormState
    @State private var titleAction: SetAction = .keep
    @State private var descriptionAction: NullableAction = .keep
    @State private var startAction: SetAction = .keep
    @State private var endAction: NullableAction = .keep
    @State private var categoryAction: SetAction = .keep
    @State private var urlAction: NullableAction = .keep
    @State private var placeAction: SetAction = .keep
    @State private var showsCancelConfirmation = false
    @State private var showsConflictResubmission = false
    @State private var flowLease: UserEventProtectedFlowLease?

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @AccessibilityFocusState private var errorIsFocused: Bool
    @AccessibilityFocusState private var outcomeIsFocused: Bool
    @AccessibilityFocusState private var conflictIsFocused: Bool

    init(
        model: UserEventManagementViewModel,
        authState: AuthState,
        event: ManagedUserEvent,
        places: any PlaceRepository
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
        placesRepository = places
        _protectedForm = State(
            initialValue: UserEventEditProtectedFormState(
                event: event,
                ownerID: authState.userEventAdmittedOwnerID
            )
        )
    }

    var body: some View {
        Group {
            if let baseline = renderableBaseline {
                editForm(baseline)
            } else {
                List {
                    UserEventStateRow(
                        title: "Event editing hidden",
                        message:
                            "Protected event drafts and conflict details require an active admitted Brown session.",
                        systemImage: "eye.slash"
                    )
                }
            }
        }
        .navigationTitle(isEventEditable ? "Edit Event" : "Event Details")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            guard
                let baseline = protectedForm.baseline,
                let ownerID = authState.userEventAdmittedOwnerID,
                protectedForm.canRender(for: ownerID)
            else {
                clearProtectedEditState()
                dismiss()
                return
            }
            enterProtectedFlow()
            model.beginEditing(baseline)
        }
        .task(id: canRenderProtectedForm) {
            guard canRenderProtectedForm else { return }
            guard protectedForm.places.isEmpty else { return }
            await loadPlaces(policy: .useCache)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .background else { return }
            invalidateProtectedEditState()
            Task {
                await model.deactivate(
                    reason: .sceneBackgrounded
                )
            }
        }
        .onChange(of: authState) { state in
            if let ownerID = state.userEventAdmittedOwnerID,
                protectedForm.canRender(for: ownerID)
            {
                return
            }
            invalidateProtectedEditState()
            Task {
                await model.deactivate(
                    reason: state == .signedOut
                        ? .signedOut
                        : .authExpired
                )
            }
        }
        .onChange(of: model.state) { state in
            switch state {
            case .authenticationRequired:
                invalidateProtectedEditState()
            case .conflict:
                conflictIsFocused = true
            case .failed:
                errorIsFocused = true
            case .canceled:
                outcomeIsFocused = true
            default:
                break
            }
        }
        .confirmationDialog(
            "Cancel this event?",
            isPresented: $showsCancelConfirmation,
            titleVisibility: .visible
        ) {
            Button("Cancel event", role: .destructive) {
                guard let eventID = renderableBaseline?.id else {
                    invalidateProtectedEditState()
                    return
                }
                Task {
                    await model.cancel(
                        eventID: eventID,
                        authState: authState
                    )
                }
            }
            Button("Keep event", role: .cancel) {}
        } message: {
            Text(
                "Canceling removes the event from public visibility. The action is idempotent, so repeating it is safe."
            )
        }
        .confirmationDialog(
            "Resubmit against the latest revision?",
            isPresented: $showsConflictResubmission,
            titleVisibility: .visible
        ) {
            Button("Resubmit selected changes") {
                Task {
                    await submit()
                }
            }
            Button("Keep reviewing", role: .cancel) {}
        } message: {
            Text(
                "BrownSync will send your selected fields once against the latest revision. It will not merge or overwrite automatically."
            )
        }
        .onDisappear {
            clearProtectedEditState()
            leaveProtectedFlow()
        }
    }

    private func editForm(_ baseline: ManagedUserEvent) -> some View {
        Form {
            statusSection(baseline)
            presentationSections
            if isEventEditable {
                titleSection
                descriptionSection
                scheduleSection
                categorySection
                placeSection
                urlSection
                actionSection
            } else {
                readOnlySection(baseline)
            }
        }
        .privacySensitive()
    }

    private func statusSection(
        _ baseline: ManagedUserEvent
    ) -> some View {
        let presentation = baseline.managementStatePresentation

        return Section("Event") {
            Text(baseline.title)
                .font(.headline)
            LabeledContent(
                "Owner",
                value: baseline.owner.displayName
            )
            LabeledContent(
                "Current revision",
                value: String(baseline.revision)
            )
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
            if let deletedAt = presentation.deletedAt {
                LabeledContent(
                    "Deleted",
                    value: deletedAt.formatted(
                        date: .long,
                        time: .shortened
                    )
                )
            }
            Text(
                "Hidden, canceled, and moderation states are shown explicitly and are never communicated by color alone."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var presentationSections: some View {
        if let validationMessage = protectedForm.validationMessage {
            Section {
                UserEventStateRow(
                    title: "Check event changes",
                    message: validationMessage,
                    systemImage: "exclamationmark.triangle"
                )
                .accessibilityFocused($errorIsFocused)
            }
        }

        if let successMessage = protectedForm.successMessage {
            Section {
                UserEventStateRow(
                    title: "Event updated",
                    message: successMessage,
                    systemImage: "checkmark.circle"
                )
                .accessibilityFocused($outcomeIsFocused)
            }
        }

        switch model.state {
        case .submitting:
            Section {
                ProgressView("Submitting selected changes once")
                    .accessibilityLabel(
                        "Submitting selected event changes once"
                    )
            }
        case .canceling:
            Section {
                ProgressView("Canceling event")
                    .accessibilityLabel(
                        "Canceling event and removing public visibility"
                    )
            }
        case .canceled(let outcome):
            Section {
                UserEventStateRow(
                    title: outcome.changed
                        ? "Event canceled"
                        : "Event already canceled",
                    message:
                        "This event is no longer publicly visible.",
                    systemImage: "checkmark.circle"
                )
                .accessibilityFocused($outcomeIsFocused)
            }
        case .failed(let failure):
            Section {
                UserEventFailureRow(failure: failure)
                    .accessibilityFocused($errorIsFocused)
            }
        case .conflict(let review):
            conflictSection(review)
        default:
            EmptyView()
        }
    }

    private var titleSection: some View {
        Section {
            Picker("Title action", selection: $titleAction) {
                ForEach(SetAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            .accessibilityValue(titleAction.title)
            if titleAction == .set {
                TextField(
                    "Replacement title",
                    text: $protectedForm.titleText
                )
                .accessibilityHint(
                    "Use 200 characters or fewer."
                )
            }
        } header: {
            Text("Title")
        } footer: {
            Text(
                "\(protectedForm.titleText.utf16.count) of 200 characters"
            )
        }
    }

    private var descriptionSection: some View {
        Section {
            Picker(
                "Description action",
                selection: $descriptionAction
            ) {
                ForEach(NullableAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            .accessibilityValue(descriptionAction.title)
            .accessibilityHint(
                descriptionAction == .clear
                    ? "Clear removes the event description."
                    : "Choose whether to keep, replace, or clear the description."
            )
            if descriptionAction == .set {
                TextEditor(text: $protectedForm.descriptionText)
                    .frame(minHeight: 96)
                    .accessibilityLabel("Replacement description")
            }
        } header: {
            Text("Description")
        } footer: {
            Text(
                "\(protectedForm.descriptionText.utf16.count) of 10000 characters"
            )
        }
    }

    private var scheduleSection: some View {
        Section("Schedule") {
            Picker("Start action", selection: $startAction) {
                ForEach(SetAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            if startAction == .set {
                DatePicker(
                    "Replacement start",
                    selection: $protectedForm.start,
                    displayedComponents: [.date, .hourAndMinute]
                )
            }

            Picker("End action", selection: $endAction) {
                ForEach(NullableAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            .accessibilityValue(endAction.title)
            .accessibilityHint(
                endAction == .clear
                    ? "Clear removes the event end time."
                    : "Choose whether to keep, replace, or clear the end time."
            )
            if endAction == .set {
                DatePicker(
                    "Replacement end",
                    selection: $protectedForm.end,
                    displayedComponents: [.date, .hourAndMinute]
                )
            }
        }
    }

    private var categorySection: some View {
        Section("Category") {
            Picker("Category action", selection: $categoryAction) {
                ForEach(SetAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            if categoryAction == .set {
                Picker(
                    "Replacement category",
                    selection: $protectedForm.category
                ) {
                    ForEach(
                        UserEventCategory.allCases,
                        id: \.self
                    ) {
                        Text($0.displayName).tag($0)
                    }
                }
                .accessibilityValue(
                    protectedForm.category.displayName
                )
            }
        }
    }

    private var placeSection: some View {
        Section {
            Picker("Place action", selection: $placeAction) {
                ForEach(SetAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            if placeAction == .set {
                TextField(
                    "Search canonical campus places",
                    text: $protectedForm.placeSearch
                )
                if let placeLoadFailure =
                    protectedForm.placeLoadFailure
                {
                    Text(placeLoadFailure)
                        .foregroundStyle(.secondary)
                    Button("Try loading places again") {
                        Task {
                            await loadPlaces(policy: .reload)
                        }
                    }
                } else {
                    ForEach(filteredPlaces) { place in
                        Button {
                            protectedForm.selectedPlaceID = place.id
                        } label: {
                            HStack {
                                Text(place.name)
                                Spacer()
                                if protectedForm.selectedPlaceID
                                    == place.id
                                {
                                    Image(
                                        systemName:
                                            "checkmark.circle.fill"
                                    )
                                    .accessibilityHidden(true)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(place.name)
                        .accessibilityValue(
                            protectedForm.selectedPlaceID == place.id
                                ? "Selected"
                                : "Not selected"
                        )
                        .accessibilityAddTraits(
                            protectedForm.selectedPlaceID == place.id
                                ? .isSelected
                                : []
                        )
                    }
                }
            }
        } header: {
            Text("Canonical campus place")
        } footer: {
            Text(
                "Only the selected campus place identifier is sent. Coordinates and free-form locations are never sent."
            )
        }
    }

    private var urlSection: some View {
        Section {
            Picker("Link action", selection: $urlAction) {
                ForEach(NullableAction.allCases, id: \.self) {
                    Text($0.title).tag($0)
                }
            }
            .accessibilityValue(urlAction.title)
            .accessibilityHint(
                urlAction == .clear
                    ? "Clear removes the event link."
                    : "Choose whether to keep, replace, or clear the event link."
            )
            if urlAction == .set {
                TextField(
                    "Replacement HTTPS URL",
                    text: $protectedForm.urlText
                )
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }
        } header: {
            Text("Optional event link")
        }
    }

    private var actionSection: some View {
        Section {
            Button {
                Task {
                    await submit()
                }
            } label: {
                Label("Save selected changes", systemImage: "checkmark")
            }
            .disabled(isBusy)

            Button(role: .destructive) {
                showsCancelConfirmation = true
            } label: {
                Label(
                    "Cancel event",
                    systemImage: "calendar.badge.minus"
                )
            }
            .disabled(isBusy)
            .accessibilityHint(
                "Opens a confirmation explaining that cancellation removes public visibility and is idempotent."
            )
        }
    }

    private func readOnlySection(
        _ baseline: ManagedUserEvent
    ) -> some View {
        let presentation = baseline.managementStatePresentation
        let details = baseline.readOnlyDetails

        return Section {
            UserEventStateRow(
                title: presentation.readOnlyTitle,
                message: presentation.readOnlyMessage,
                systemImage: "lock"
            )
            if let description = details.description {
                LabeledContent("Description") {
                    Text(description)
                        .multilineTextAlignment(.trailing)
                }
            }
            LabeledContent(
                "Scheduled start",
                value: details.start.formatted(
                    date: .long,
                    time: .shortened
                )
            )
            if let end = details.end {
                LabeledContent(
                    "Scheduled end",
                    value: end.formatted(
                        date: .long,
                        time: .shortened
                    )
                )
            }
            LabeledContent("Place", value: details.placeName)
            LabeledContent(
                "Category",
                value: details.categoryTitle
            )
            if let eventURL = details.eventURL {
                LabeledContent("Event link") {
                    Link(
                        eventURL.absoluteString,
                        destination: eventURL
                    )
                }
            }
        }
    }

    private func conflictSection(
        _ review: UserEventEditConflictReview
    ) -> some View {
        Section {
            Label(
                "Review conflicting changes",
                systemImage: "arrow.triangle.2.circlepath"
            )
            .font(.headline)
            .accessibilityAddTraits(.isHeader)
            .accessibilityFocused($conflictIsFocused)

            Text(
                "The event changed from revision \(review.expectedRevision) to \(review.latestRevision). BrownSync did not retry the edit."
            )

            ForEach(
                Array(review.fields.enumerated()),
                id: \.offset
            ) { _, field in
                VStack(alignment: .leading, spacing: 6) {
                    Text(field.field.displayName)
                        .font(.headline)
                    LabeledContent(
                        "Baseline",
                        value: field.baseline.displayText
                    )
                    LabeledContent(
                        "Your submission",
                        value: field.submitted.displayText
                    )
                    LabeledContent(
                        "Latest",
                        value: field.latest.displayText
                    )
                }
                .accessibilityElement(children: .combine)
            }

            if isEventEditable {
                Button("Review and resubmit selected changes") {
                    showsConflictResubmission = true
                }
                .accessibilityHint(
                    "Requests confirmation before one submission against the latest revision."
                )
            } else {
                Text(
                    "The latest protected state is read-only, so these changes cannot be resubmitted."
                )
                .foregroundStyle(.secondary)
            }
        }
    }

    private var filteredPlaces: [PublicPlace] {
        let query = protectedForm.placeSearch.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !query.isEmpty else { return protectedForm.places }
        return protectedForm.places.filter { place in
            place.name.localizedCaseInsensitiveContains(query)
                || place.aliases.contains {
                    $0.localizedCaseInsensitiveContains(query)
                }
        }
    }

    private var isBusy: Bool {
        switch model.state {
        case .submitting, .canceling:
            return true
        default:
            return false
        }
    }

    private var isEventEditable: Bool {
        guard
            let baseline = renderableBaseline,
            baseline.isEditable
        else {
            return false
        }
        if case .canceled = model.state {
            return false
        }
        return true
    }

    private var canRenderProtectedForm: Bool {
        guard scenePhase == .active else { return false }
        guard
            let ownerID = authState.userEventAdmittedOwnerID,
            protectedForm.canRender(for: ownerID),
            let baseline = protectedForm.baseline,
            model.editBaseline?.id == baseline.id
        else {
            return false
        }
        return true
    }

    private var renderableBaseline: ManagedUserEvent? {
        guard canRenderProtectedForm else { return nil }
        return protectedForm.baseline
    }

    private func submit() async {
        do {
            guard let baseline = renderableBaseline else {
                invalidateProtectedEditState()
                return
            }
            let patch = try makePatch(against: baseline)
            protectedForm.validationMessage = nil
            protectedForm.successMessage = nil
            let latest = await model.update(
                patch: patch,
                authState: authState
            )
            if let latest {
                applyAcceptedBaseline(latest)
                protectedForm.successMessage =
                    "The selected changes were accepted at revision \(latest.revision)."
                outcomeIsFocused = true
            } else if let latest = model.editBaseline {
                protectedForm.rebase(
                    to: latest,
                    preserving: patch
                )
            }
        } catch let validation as UserEventFormValidationError {
            protectedForm.validationMessage = validation.message
            errorIsFocused = true
        } catch {
            protectedForm.validationMessage =
                "Review the selected event changes and try again."
            errorIsFocused = true
        }
    }

    private func makePatch(
        against baseline: ManagedUserEvent
    ) throws -> UserEventEditPatchIntent {
        let titleIntent: UserEventSetIntent<String>
        switch titleAction {
        case .keep:
            titleIntent = .unchanged
        case .set:
            let trimmed = protectedForm.titleText.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard
                !trimmed.isEmpty,
                trimmed.utf16.count <= 200
            else {
                throw UserEventFormValidationError(
                    message:
                        "Enter a replacement title using 200 characters or fewer."
                )
            }
            titleIntent = .set(trimmed)
        }

        let descriptionIntent: UserEventNullableEditIntent<String>
        switch descriptionAction {
        case .keep:
            descriptionIntent = .unchanged
        case .set:
            guard
                protectedForm.descriptionText.utf16.count <= 10_000
            else {
                throw UserEventFormValidationError(
                    message:
                        "Shorten the replacement description to 10,000 characters or fewer."
                )
            }
            descriptionIntent = .set(
                protectedForm.descriptionText
            )
        case .clear:
            descriptionIntent = .clear
        }

        let startIntent: UserEventSetIntent<Date> =
            startAction == .set
            ? .set(protectedForm.start)
            : .unchanged

        let endIntent: UserEventNullableEditIntent<Date>
        switch endAction {
        case .keep:
            endIntent = .unchanged
        case .set:
            endIntent = .set(protectedForm.end)
        case .clear:
            endIntent = .clear
        }

        let categoryIntent: UserEventSetIntent<UserEventCategory> =
            categoryAction == .set
            ? .set(protectedForm.category)
            : .unchanged

        let urlIntent: UserEventNullableEditIntent<URL>
        switch urlAction {
        case .keep:
            urlIntent = .unchanged
        case .set:
            let trimmed = protectedForm.urlText.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard let url = UserEventHTTPSURL.parse(trimmed) else {
                throw UserEventFormValidationError(
                    message:
                        "Enter a valid lowercase https:// replacement URL with a host."
                )
            }
            urlIntent = .set(url)
        case .clear:
            urlIntent = .clear
        }

        let placeIntent: UserEventSetIntent<String>
        if placeAction == .set {
            guard
                protectedForm.places.contains(
                    where: {
                        $0.id == protectedForm.selectedPlaceID
                    }
                )
            else {
                throw UserEventFormValidationError(
                    message:
                        "Select a canonical campus place from the list."
                )
            }
            placeIntent = .set(protectedForm.selectedPlaceID)
        } else {
            placeIntent = .unchanged
        }

        let patch = UserEventEditPatchIntent(
            title: titleIntent,
            description: descriptionIntent,
            start: startIntent,
            end: endIntent,
            category: categoryIntent,
            url: urlIntent,
            canonicalPlaceID: placeIntent
        )
        guard patch.hasValidEffectiveSchedule(against: baseline) else {
            throw UserEventFormValidationError(
                message:
                    "Choose an effective end time after the effective start time."
            )
        }
        return patch
    }

    private func loadPlaces(policy: PublicLoadPolicy) async {
        protectedForm.placeLoadFailure = nil
        do {
            let resource = try await placesRepository.places(
                policy: policy
            )
            guard canRenderProtectedForm else { return }
            protectedForm.places = resource.value
        } catch is CancellationError {
            return
        } catch {
            protectedForm.placeLoadFailure =
                "Canonical campus places are temporarily unavailable."
        }
    }

    private func applyAcceptedBaseline(_ event: ManagedUserEvent) {
        protectedForm.applyAcceptedBaseline(event)
        titleAction = .keep
        descriptionAction = .keep
        startAction = .keep
        endAction = .keep
        categoryAction = .keep
        urlAction = .keep
        placeAction = .keep
    }

    private func clearProtectedEditState() {
        protectedForm.purge()
        titleAction = .keep
        descriptionAction = .keep
        startAction = .keep
        endAction = .keep
        categoryAction = .keep
        urlAction = .keep
        placeAction = .keep
        showsCancelConfirmation = false
        showsConflictResubmission = false
        errorIsFocused = false
        outcomeIsFocused = false
        conflictIsFocused = false
        model.endEditing()
    }

    private func invalidateProtectedEditState() {
        clearProtectedEditState()
        dismiss()
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

extension UserEventEditField {
    fileprivate var displayName: String {
        switch self {
        case .title:
            return "Title"
        case .description:
            return "Description"
        case .start:
            return "Start"
        case .end:
            return "End"
        case .category:
            return "Category"
        case .url:
            return "Event link"
        case .canonicalPlaceID:
            return "Canonical campus place"
        }
    }
}

extension UserEventEditComparisonValue {
    fileprivate var displayText: String {
        switch self {
        case .none:
            return "None"
        case .text(let value):
            return value
        case .date(let value):
            return value.formatted(
                date: .abbreviated,
                time: .shortened
            )
        case .category(let value):
            return value.displayName
        }
    }
}

extension AuthState {
    fileprivate var userEventAdmittedOwnerID: UUID? {
        guard case .admitted(let identity) = self else {
            return nil
        }
        return identity.id
    }
}
