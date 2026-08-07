import Foundation
import SwiftUI

struct CreateUserEventView: View {
    private enum OwnerSelection: Hashable {
        case personal
        case organization(String)
    }

    @ObservedObject private var model: UserEventManagementViewModel
    private let authState: AuthState
    private let placesRepository: any PlaceRepository
    private let organizationMemberships: [OrganizationMembership]

    @State private var ownerSelection: OwnerSelection = .personal
    @State private var title = ""
    @State private var descriptionText = ""
    @State private var start = Date()
    @State private var includesEnd = false
    @State private var end = Date().addingTimeInterval(60 * 60)
    @State private var category: UserEventCategory = .social
    @State private var urlText = ""
    @State private var places: [PublicPlace] = []
    @State private var placeSearch = ""
    @State private var selectedPlaceID: String?
    @State private var placeLoadFailure: String?
    @State private var validationMessage: String?
    @State private var flowLease: UserEventProtectedFlowLease?

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var validationIsFocused: Bool
    @AccessibilityFocusState private var outcomeIsFocused: Bool

    init(
        model: UserEventManagementViewModel,
        authState: AuthState,
        places: any PlaceRepository,
        organizationMemberships: [OrganizationMembership] = []
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
        placesRepository = places
        self.organizationMemberships = organizationMemberships
    }

    var body: some View {
        Group {
            if canRenderProtectedForm {
                createForm
            } else {
                List {
                    UserEventStateRow(
                        title: "Event creation hidden",
                        message:
                            "An admitted Brown sign-in is required to create an event.",
                        systemImage: "lock"
                    )
                }
            }
        }
        .navigationTitle("Create Event")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            enterProtectedFlow()
        }
        .task(id: canRenderProtectedForm) {
            guard canRenderProtectedForm else {
                clearDraft()
                return
            }
            guard places.isEmpty else { return }
            await loadPlaces(policy: .useCache)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else {
                clearDraft()
                Task {
                    await model.deactivate(
                        reason: .sceneBackgrounded
                    )
                }
                return
            }
        }
        .onChange(of: authState) { state in
            guard case .admitted = state else {
                clearDraft()
                Task {
                    await model.deactivate(reason: .signedOut)
                }
                return
            }
        }
        .onChange(of: model.state) { state in
            switch state {
            case .created, .replayed:
                outcomeIsFocused = true
            case .failed:
                validationIsFocused = true
            default:
                break
            }
        }
        .onDisappear {
            clearDraft()
            leaveProtectedFlow()
        }
    }

    private var createForm: some View {
        Form {
            if let validationMessage {
                Section {
                    Label(
                        "Check event details",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.headline)
                    Text(validationMessage)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "Check event details. \(validationMessage)"
                )
                .accessibilityFocused($validationIsFocused)
            }

            modelPresentation

            ownerSection

            Section("Event details") {
                TextField("Title", text: $title)
                    .textInputAutocapitalization(.sentences)
                    .accessibilityHint(
                        "Required. Use 200 characters or fewer."
                    )

                TextEditor(text: $descriptionText)
                    .frame(minHeight: 96)
                    .accessibilityLabel("Optional description")

                Text(
                    "\(descriptionText.utf16.count) of 10000 characters"
                )
                .font(.caption)
                .foregroundStyle(
                    descriptionText.utf16.count > 10_000
                        ? Color.red
                        : Color.secondary
                )
            }

            Section("Schedule") {
                DatePicker(
                    "Starts",
                    selection: $start,
                    displayedComponents: [.date, .hourAndMinute]
                )
                Toggle("Include an end time", isOn: $includesEnd)
                    .accessibilityHint(
                        "When off, this event has no end time."
                    )
                if includesEnd {
                    DatePicker(
                        "Ends",
                        selection: $end,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                }
            }

            Section("Category") {
                Picker("Event category", selection: $category) {
                    ForEach(UserEventCategory.allCases, id: \.self) {
                        Text($0.displayName).tag($0)
                    }
                }
                .accessibilityValue(category.displayName)
            }

            canonicalPlaceSection

            Section("Optional link") {
                TextField("HTTPS URL", text: $urlText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityHint(
                        "Optional. Only an HTTPS web address is accepted."
                    )
            }

            Section {
                if model.createRequiresExplicitReset {
                    Button {
                        model.startNewCreateSubmission()
                        clearDraft()
                    } label: {
                        Label(
                            "Create another event",
                            systemImage: "plus.circle"
                        )
                    }
                    .accessibilityHint(
                        "Clears the completed form before a new request identity can be created."
                    )
                } else {
                    Button {
                        Task { await submit() }
                    } label: {
                        Label(
                            "Create event",
                            systemImage: "calendar.badge.plus"
                        )
                    }
                    .disabled(isSubmitting)

                    if model.pendingSubmission != nil,
                        case .failed(let failure) = model.state,
                        failure.retryLabel != nil
                    {
                        Button {
                            Task {
                                await model.retryCreate(
                                    authState: authState
                                )
                            }
                        } label: {
                            Label(
                                "Retry the same submission",
                                systemImage: "arrow.clockwise"
                            )
                        }
                        .accessibilityHint(
                            "Reuses the original request identity instead of creating a duplicate event."
                        )
                    }
                }
            } footer: {
                Text(
                    "BrownSync sends the selected campus place, never coordinates or free-form location data."
                )
            }
        }
        .privacySensitive()
    }

    @ViewBuilder
    private var modelPresentation: some View {
        switch model.state {
        case .submitting:
            Section {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Submitting this event once")
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Submitting this event once")
            }

        case .created(_, let revision):
            Section {
                UserEventStateRow(
                    title: "Event created",
                    message:
                        "The event was created at revision \(revision).",
                    systemImage: "checkmark.circle"
                )
                .accessibilityFocused($outcomeIsFocused)
            }

        case .replayed(_, let revision):
            Section {
                UserEventStateRow(
                    title: "Earlier submission found",
                    message:
                        "The same event already exists at revision \(revision); no duplicate was created.",
                    systemImage: "arrow.clockwise.circle"
                )
                .accessibilityFocused($outcomeIsFocused)
            }

        case .failed(let failure):
            Section {
                UserEventFailureRow(failure: failure)
                    .accessibilityFocused($validationIsFocused)
            }

        default:
            EmptyView()
        }
    }

    private var ownerSection: some View {
        Section {
            Picker("Event owner", selection: $ownerSelection) {
                Text("My personal account")
                    .tag(OwnerSelection.personal)
                ForEach(
                    organizationMemberships,
                    id: \.organizationID
                ) { membership in
                    Text(membership.organizationName)
                        .tag(
                            OwnerSelection.organization(
                                membership.organizationID
                            )
                        )
                }
            }
            .accessibilityHint(
                "The server rechecks account age and current organization authority."
            )
        } header: {
            Text("Owner")
        } footer: {
            Text(
                "Choosing an organization does not grant authority; the server verifies your current role."
            )
        }
    }

    private var canonicalPlaceSection: some View {
        Section {
            TextField("Search campus places", text: $placeSearch)
                .textInputAutocapitalization(.words)
                .accessibilityHint(
                    "Filters the canonical campus place list."
                )

            if let placeLoadFailure {
                Text(placeLoadFailure)
                    .foregroundStyle(.secondary)
                Button("Try loading places again") {
                    Task { await loadPlaces(policy: .reload) }
                }
            } else if places.isEmpty {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Loading campus places")
                }
                .accessibilityElement(children: .combine)
            } else if filteredPlaces.isEmpty {
                Text("No canonical campus places match this search.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(filteredPlaces) { place in
                    Button {
                        selectedPlaceID = place.id
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(place.name)
                                if let address = place.address {
                                    Text(address)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if selectedPlaceID == place.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .accessibilityHidden(true)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(place.name)
                    .accessibilityValue(
                        selectedPlaceID == place.id
                            ? "Selected"
                            : "Not selected"
                    )
                    .accessibilityHint(
                        "Selects this canonical campus place."
                    )
                    .accessibilityAddTraits(
                        selectedPlaceID == place.id
                            ? .isSelected
                            : []
                    )
                }
            }
        } header: {
            Text("Canonical campus place")
        } footer: {
            if let selectedPlace {
                Text("Selected: \(selectedPlace.name)")
            } else {
                Text("Select one campus place.")
            }
        }
    }

    private var filteredPlaces: [PublicPlace] {
        let query = placeSearch.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !query.isEmpty else { return places }
        return places.filter { place in
            place.name.localizedCaseInsensitiveContains(query)
                || place.aliases.contains {
                    $0.localizedCaseInsensitiveContains(query)
                }
        }
    }

    private var selectedPlace: PublicPlace? {
        guard let selectedPlaceID else { return nil }
        return places.first { $0.id == selectedPlaceID }
    }

    private var isSubmitting: Bool {
        if case .submitting = model.state {
            return true
        }
        return false
    }

    private var canRenderProtectedForm: Bool {
        guard scenePhase == .active else { return false }
        if case .admitted = authState {
            return true
        }
        return false
    }

    private func submit() async {
        do {
            let draft = try makeDraft()
            validationMessage = nil
            await model.submitCreate(
                draft: draft,
                authState: authState
            )
        } catch let validation as UserEventFormValidationError {
            validationMessage = validation.message
            validationIsFocused = true
        } catch {
            validationMessage =
                "Review the event details and try again."
            validationIsFocused = true
        }
    }

    private func makeDraft() throws -> UserEventCreateDraft {
        let trimmedTitle = title.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard
            !trimmedTitle.isEmpty,
            trimmedTitle.utf16.count <= 200
        else {
            throw UserEventFormValidationError(
                message:
                    "Enter an event title using 200 characters or fewer."
            )
        }
        guard descriptionText.utf16.count <= 10_000 else {
            throw UserEventFormValidationError(
                message:
                    "Shorten the description to 10,000 characters or fewer."
            )
        }
        guard let selectedPlaceID else {
            throw UserEventFormValidationError(
                message: "Select a canonical campus place."
            )
        }
        if includesEnd, end <= start {
            throw UserEventFormValidationError(
                message: "Choose an end time after the start time."
            )
        }

        let url: URL?
        let trimmedURL = urlText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        if trimmedURL.isEmpty {
            url = nil
        } else {
            guard
                let candidate = UserEventHTTPSURL.parse(trimmedURL)
            else {
                throw UserEventFormValidationError(
                    message:
                        "Enter a valid lowercase https:// event URL with a host."
                )
            }
            url = candidate
        }

        let owner: UserEventOwner
        switch ownerSelection {
        case .personal:
            owner = .personal
        case .organization(let id):
            guard
                let membership = organizationMemberships.first(
                    where: { $0.organizationID == id }
                )
            else {
                throw UserEventFormValidationError(
                    message:
                        "Choose an organization you currently manage."
                )
            }
            owner = .organization(
                id: membership.organizationID,
                name: membership.organizationName
            )
        }

        return UserEventCreateDraft(
            owner: owner,
            title: trimmedTitle,
            description:
                descriptionText.isEmpty ? nil : descriptionText,
            start: start,
            end: includesEnd ? end : nil,
            category: category,
            url: url,
            canonicalPlaceID: selectedPlaceID
        )
    }

    private func loadPlaces(policy: PublicLoadPolicy) async {
        placeLoadFailure = nil
        do {
            let resource = try await placesRepository.places(
                policy: policy
            )
            guard canRenderProtectedForm else { return }
            places = resource.value
            if let selectedPlaceID,
                !places.contains(where: { $0.id == selectedPlaceID })
            {
                self.selectedPlaceID = nil
            }
        } catch is CancellationError {
            return
        } catch {
            placeLoadFailure =
                "Canonical campus places are temporarily unavailable."
        }
    }

    private func clearDraft() {
        let now = Date()
        ownerSelection = .personal
        title = ""
        descriptionText = ""
        start = now
        includesEnd = false
        end = now.addingTimeInterval(60 * 60)
        category = .social
        urlText = ""
        placeSearch = ""
        selectedPlaceID = nil
        validationMessage = nil
        validationIsFocused = false
        outcomeIsFocused = false
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

struct UserEventFormValidationError: Error {
    let message: String
}
