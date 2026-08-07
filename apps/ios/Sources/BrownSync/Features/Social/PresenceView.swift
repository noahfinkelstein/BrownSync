import SwiftUI

struct PresenceView: View {
    private enum FailedPrivacyAction {
        case clear
        case setGhost(Bool)
        case anotherSurface

        var retryLabel: String? {
            switch self {
            case .clear:
                return "Retry clearing presence"
            case let .setGhost(enabled):
                return enabled
                    ? "Retry turning ghost mode on"
                    : "Retry turning ghost mode off"
            case .anotherSurface:
                return nil
            }
        }
    }

    let currentUserID: UUID
    let dependencies: SocialDependencies
    let places: any PlaceRepository

    @State private var suggestion:
        CampusPlaceSuggestion?
    @State private var selectedPlace: ConfirmedCampusPlace?
    @State private var selectedPlaceName: String?
    @State private var allPlaces: [PublicPlace] = []
    @State private var placeSearch = ""
    @State private var status: PresenceStatus = .free
    @State private var note = ""
    @State private var ttlSeconds = 3_600
    @State private var ghostEnabled = false
    @State private var isWorking = false
    @State private var message: String?
    @State private var errorMessage: String?
    @State private var failedPrivacyAction: FailedPrivacyAction?
    @AccessibilityFocusState private var errorIsFocused: Bool

    var body: some View {
        Form {
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .accessibilityLabel("Presence error. \(errorMessage)")
                        .accessibilityFocused($errorIsFocused)
                    if
                        let failedPrivacyAction,
                        let retryLabel = failedPrivacyAction.retryLabel
                    {
                        Button(retryLabel) {
                            Task { await retryPrivacyAction() }
                        }
                        .disabled(isWorking)
                        .accessibilityHint(
                            "Repeats only the exact unconfirmed privacy action."
                        )
                    }
                }
            }
            if let message {
                Section {
                    Label(message, systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Privacy") {
                Button {
                    Task { await toggleGhost() }
                } label: {
                    HStack {
                        Label("Ghost mode", systemImage: "eye.slash")
                        Spacer()
                        Text(ghostEnabled ? "On" : "Off")
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(isWorking || failedPrivacyAction != nil)
                .accessibilityValue(ghostEnabled ? "On" : "Off")
                .accessibilityHint(
                    "When on, presence is hidden and queued place updates are discarded."
                )

                Button("Clear my presence", role: .destructive) {
                    Task { await clearPresence() }
                }
                .disabled(isWorking || failedPrivacyAction != nil)
                .accessibilityHint(
                    "Hides your local presence immediately, then asks the server to clear it."
                )
            }

            Section("Choose a campus place") {
                Button {
                    Task { await suggestFromCurrentLocation() }
                } label: {
                    Label("Use my current location", systemImage: "location")
                }
                .disabled(
                    isWorking
                        || ghostEnabled
                        || failedPrivacyAction != nil
                )
                .accessibilityHint(
                    "Processes location on this device and suggests a campus place for confirmation."
                )

                suggestionControls

                TextField("Search places", text: $placeSearch)
                    .textInputAutocapitalization(.words)
                ForEach(manualMatches.prefix(8)) { place in
                    Button {
                        selectedPlace = ConfirmedCampusPlace(
                            placeID: place.id
                        )
                        selectedPlaceName = place.name
                        suggestion = nil
                    } label: {
                        VStack(alignment: .leading) {
                            Text(place.name)
                            if let address = place.address {
                                Text(address)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityLabel("Use \(place.name)")
                }
            }

            if let selectedPlace, let selectedPlaceName {
                Section("Confirmed place") {
                    Label(selectedPlaceName, systemImage: "checkmark.circle.fill")
                    Text(
                        "Only this place ID—not your coordinates—will be sent."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    Picker("Status", selection: $status) {
                        ForEach(PresenceStatus.allCases, id: \.self) {
                            Text($0.accessibleName).tag($0)
                        }
                    }
                    TextField("Optional note", text: $note, axis: .vertical)
                        .onChange(of: note) {
                            if $0.count > 80 {
                                note = String($0.prefix(80))
                            }
                        }
                    Picker("Share for", selection: $ttlSeconds) {
                        Text("1 hour").tag(3_600)
                        Text("4 hours").tag(14_400)
                        Text("24 hours").tag(86_400)
                    }

                    Button("Share this place") {
                        Task { await publish(selectedPlace) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        isWorking
                            || ghostEnabled
                            || failedPrivacyAction != nil
                    )
                    .accessibilityHint(
                        "Publishes the confirmed place, status, optional note, and expiry."
                    )
                }
            }
        }
        .navigationTitle("My Presence")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadInitialState() }
        .onChange(of: errorMessage) {
            errorIsFocused = $0 != nil
        }
    }

    @ViewBuilder
    private var suggestionControls: some View {
        if let suggestion {
            switch suggestion {
            case let .single(candidate):
                candidateButton(candidate)
            case let .multiple(candidates):
                Text("Choose the matching campus place.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(candidates, id: \.placeID) {
                    candidateButton($0)
                }
            case let .recognizedUnmapped(building):
                Text(
                    "\(building.label ?? "This building") is recognized, but it is not mapped to one place. Search manually."
                )
                .foregroundStyle(.secondary)
            case let .manualSearch(reason):
                Text(manualSearchMessage(for: reason))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var manualMatches: [PublicPlace] {
        let normalized = placeSearch.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).lowercased()
        guard !normalized.isEmpty else { return [] }
        return allPlaces.filter {
            $0.name.lowercased().contains(normalized)
                || $0.aliases.contains {
                    $0.lowercased().contains(normalized)
                }
        }
    }

    private func candidateButton(
        _ candidate: BuildingPlaceCandidate
    ) -> some View {
        let displayName = CampusPlaceCandidateNaming.displayName(
            for: candidate,
            availablePlaces: allPlaces
        )
        return Button {
            do {
                selectedPlace = try dependencies.placeSnapper.confirm(
                    placeID: candidate.placeID,
                    from: suggestion ?? .manualSearch(.outsidePolygons)
                )
                selectedPlaceName = displayName
            } catch {
                errorMessage = "Choose one of the suggested places."
            }
        } label: {
            Label(
                "Confirm \(displayName)",
                systemImage: "checkmark.circle"
            )
        }
        .accessibilityLabel("Confirm \(displayName)")
    }

    private func loadInitialState() async {
        let time = await dependencies.timeSource.now()
        let cached =
            await dependencies.cache.snapshot(
                at: time,
                ownedBy: currentUserID
            )
            ?? .empty
        if let own = cached.presence.first(where: {
            $0.userID == currentUserID
        }) {
            ghostEnabled = own.ghost
            status = own.status ?? .free
            note = own.note ?? ""
            if let placeID = own.placeID {
                selectedPlace = ConfirmedCampusPlace(placeID: placeID)
                selectedPlaceName = placeID.replacingOccurrences(
                    of: "-",
                    with: " "
                )
            }
        }
        switch await dependencies.writeCoordinator
            .currentUnconfirmedPrivacyAction()
        {
        case .clearPresence:
            failedPrivacyAction = .clear
            selectedPlace = nil
            selectedPlaceName = nil
            errorMessage =
                "The server did not confirm clearing presence. Use Retry to repeat this exact action."
        case let .setGhost(target):
            failedPrivacyAction = .setGhost(target)
            ghostEnabled = true
            selectedPlace = nil
            selectedPlaceName = nil
            errorMessage = target
                ? "The server did not confirm ghost mode. Use Retry to repeat this exact action."
                : "The server did not confirm turning ghost mode off. Use Retry to repeat this exact action."
        case .revokePresenceShare, .blockUser, .removeFriend:
            failedPrivacyAction = .anotherSurface
            errorMessage =
                "Another privacy change is still unconfirmed. Return to Friends to retry that exact action."
        case nil:
            break
        }
        do {
            allPlaces = try await places.places(policy: .useCache).value
            if let placeID = selectedPlace?.placeID {
                selectedPlaceName =
                    allPlaces.first { $0.id == placeID }?.name
                    ?? selectedPlaceName
            }
        } catch {
            errorMessage =
                PresenceInitialLoadErrorPolicy.messageAfterPlaceLoadFailure(
                    existingMessage: errorMessage
                )
        }
    }

    private func suggestFromCurrentLocation() async {
        isWorking = true
        errorMessage = nil
        message = nil
        defer { isWorking = false }
        do {
            let reading = try await dependencies.locationProvider
                .requestCurrentLocation()
            suggestion = dependencies.placeSnapper.suggestion(for: reading)
            selectedPlace = nil
            selectedPlaceName = nil
        } catch is CancellationError {
            return
        } catch let error as CoreLocationProviderError {
            switch error {
            case .denied:
                errorMessage =
                    "Location access is off. Search for a campus place manually."
            case .restricted:
                errorMessage =
                    "Location is restricted on this device. Search manually."
            case .anotherRequestInProgress:
                errorMessage = "A location request is already in progress."
            case .locationUnavailable:
                errorMessage =
                    "Location is unavailable. Search for a place manually."
            }
        } catch {
            errorMessage =
                "Location is unavailable. Search for a place manually."
        }
    }

    private func publish(_ place: ConfirmedCampusPlace) async {
        isWorking = true
        errorMessage = nil
        message = nil
        defer { isWorking = false }
        do {
            let disposition = try await dependencies.writeCoordinator.submit(
                ConfirmedPresence(
                    placeID: place.placeID,
                    status: status,
                    note: note.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).nilIfEmpty,
                    ttlSeconds: ttlSeconds
                )
            )
            message = disposition == .sent
                ? "Presence confirmed by the server."
                : "Your newest confirmed place is queued for the next allowed update."
        } catch {
            errorMessage =
                "The server did not confirm your presence. Nothing will retry automatically."
        }
    }

    private func clearPresence() async {
        isWorking = true
        errorMessage = nil
        message = nil
        selectedPlace = nil
        selectedPlaceName = nil
        defer { isWorking = false }
        do {
            try await dependencies.writeCoordinator.clearPresence()
            failedPrivacyAction = nil
            message = "Presence cleared."
        } catch {
            let unresolved = await dependencies.writeCoordinator
                .currentUnconfirmedPrivacyAction()
            if unresolved == .clearPresence {
                failedPrivacyAction = .clear
                errorMessage =
                    "Hidden locally, but the server did not confirm the clear. Use Retry to repeat this exact action."
            } else {
                failedPrivacyAction = unresolved == nil
                    ? nil
                    : .anotherSurface
                errorMessage =
                    "The clear could not be completed. Resolve the existing privacy action first."
            }
        }
    }

    private func toggleGhost() async {
        guard !isWorking, failedPrivacyAction == nil else { return }
        let target = !ghostEnabled
        if target {
            ghostEnabled = true
            selectedPlace = nil
            selectedPlaceName = nil
        }
        await performGhost(target)
    }

    private func performGhost(_ target: Bool) async {
        isWorking = true
        errorMessage = nil
        message = nil
        defer { isWorking = false }
        do {
            try await dependencies.writeCoordinator.setGhost(target)
            failedPrivacyAction = nil
            ghostEnabled = target
            message = target
                ? "Ghost mode is on."
                : "Ghost mode turned off."
        } catch {
            let unresolved = await dependencies.writeCoordinator
                .currentUnconfirmedPrivacyAction()
            if unresolved == .setGhost(target) {
                failedPrivacyAction = .setGhost(target)
            } else {
                failedPrivacyAction = unresolved == nil
                    ? nil
                    : .anotherSurface
            }
            // Both an unconfirmed enable and an unconfirmed disable remain
            // locally hidden until the exact action is explicitly retried.
            ghostEnabled = true
            if unresolved == .setGhost(target) {
                errorMessage = target
                    ? "Hidden locally, but the server did not confirm ghost mode. Use Retry to repeat this exact action."
                    : "Still hidden locally; the server did not confirm turning ghost mode off. Use Retry to repeat this exact action."
            } else {
                errorMessage =
                    "Ghost mode could not be changed. Resolve the existing privacy action first."
            }
        }
    }

    private func retryPrivacyAction() async {
        guard let failedPrivacyAction, !isWorking else { return }
        switch failedPrivacyAction {
        case .clear:
            await clearPresence()
        case let .setGhost(target):
            await performGhost(target)
        case .anotherSurface:
            return
        }
    }

    private func manualSearchMessage(
        for reason: CampusPlaceManualSearchReason
    ) -> String {
        switch reason {
        case .reducedAccuracy:
            return "Precise Location is off. Your coordinates stayed on device; search for the place manually."
        case .poorHorizontalAccuracy:
            return "Location accuracy is too broad to identify a building. Search manually."
        case .outsidePolygons:
            return "No campus building contains this location. No nearest building was guessed."
        case .conflictingCandidates:
            return "More than one building matches. Search manually."
        }
    }
}

enum PresenceInitialLoadErrorPolicy {
    static func messageAfterPlaceLoadFailure(
        existingMessage: String?
    ) -> String {
        existingMessage
            ?? "Place search is offline. Location suggestions may still work."
    }
}

enum CampusPlaceCandidateNaming {
    static func displayName(
        for candidate: BuildingPlaceCandidate,
        availablePlaces: [PublicPlace]
    ) -> String {
        if
            let canonical = availablePlaces.first(where: {
                $0.id == candidate.placeID
            })?.name.trimmingCharacters(in: .whitespacesAndNewlines),
            !canonical.isEmpty
        {
            return canonical
        }

        let humanizedID = candidate.placeID
            .split(separator: "-")
            .map { $0.capitalized }
            .joined(separator: " ")
        guard
            let buildingLabel = candidate.label?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !buildingLabel.isEmpty
        else {
            return humanizedID
        }
        if buildingLabel.localizedCaseInsensitiveContains(humanizedID) {
            return buildingLabel
        }
        return "\(buildingLabel) — \(humanizedID)"
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
