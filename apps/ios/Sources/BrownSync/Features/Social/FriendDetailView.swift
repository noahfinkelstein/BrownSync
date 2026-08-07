import SwiftUI

struct FriendDetailView: View {
    private enum PendingAction: Equatable {
        case remove
        case block
    }

    let profile: SocialProfile
    @ObservedObject var model: FriendsViewModel

    @State private var pendingAction: PendingAction?
    @AccessibilityFocusState private var errorIsFocused: Bool

    var body: some View {
        List {
            if
                model.isPrivacyActionUnconfirmed(for: profile.id),
                let failed = model.failedPrivacyAction
            {
                Section {
                    Label(
                        model.errorMessage
                            ?? "This privacy change is not confirmed.",
                        systemImage: "exclamationmark.triangle"
                    )
                    .foregroundStyle(.red)
                    .accessibilityLabel(
                        "Friend privacy error. \(model.errorMessage ?? "This privacy change is not confirmed.")"
                    )
                    .accessibilityFocused($errorIsFocused)
                    Button(failed.label) {
                        Task {
                            await model.retryFailedPrivacyAction()
                        }
                    }
                    .accessibilityHint(
                        "Repeats only the exact unconfirmed privacy action."
                    )
                }
            }

            Section {
                HStack(spacing: 16) {
                    FriendAvatar(profile: profile)
                        .frame(width: 64, height: 64)
                    VStack(alignment: .leading) {
                        Text(profile.displayName)
                            .font(.title2.weight(.semibold))
                        Text("@\(profile.handle)")
                            .foregroundStyle(.secondary)
                    }
                }
                if let classYear = profile.classYear {
                    LabeledContent(
                        "Class year",
                        value: String(classYear)
                    )
                }
                if let concentration = profile.concentration {
                    LabeledContent("Concentration", value: concentration)
                }
                if let bio = profile.bio, !bio.isEmpty {
                    Text(bio)
                }
            }

            Section("Presence") {
                if
                    let presence = model.presence(for: profile.id),
                    let placeID = presence.placeID
                {
                    Label(
                        model.placeName(for: placeID),
                        systemImage: "location.fill"
                    )
                    if let status = presence.status {
                        LabeledContent(
                            "Status",
                            value: status.accessibleName
                        )
                    }
                    if let note = presence.note {
                        Text(note)
                    }
                    Text("Expires \(presence.expiresAt, style: .relative)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Updated \(presence.updatedAt, style: .relative)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("No shared presence is visible.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Sharing") {
                if model.isSharing(with: profile.id) {
                    Button("Stop sharing with \(profile.displayName)") {
                        Task { await model.revokeShare(with: profile) }
                    }
                    .foregroundStyle(.red)
                    .disabled(
                        model.isPrivacyActionUnconfirmed(
                            for: profile.id
                        )
                    )
                    .accessibilityHint(
                        "Hides this share locally immediately and asks the server to revoke it."
                    )
                } else {
                    Picker(
                        "Share duration",
                        selection: $model.shareDuration
                    ) {
                        ForEach(PresenceShareDurationOption.allCases) {
                            Text($0.localizedLabel)
                                .tag($0)
                                .accessibilityLabel(
                                    $0.localizedAccessibilityLabel
                                )
                        }
                    }
                    Button(
                        "Share for \(model.shareDuration.localizedLabel)"
                    ) {
                        Task { await model.setShare(with: profile) }
                    }
                    .disabled(
                        model.isPrivacyActionUnconfirmed(
                            for: profile.id
                        )
                    )
                    .accessibilityHint(
                        "Allows only this accepted friend to view current presence for the selected duration."
                    )
                }
            }

            Section("Friend controls") {
                Button("Remove friend", role: .destructive) {
                    pendingAction = .remove
                }
                .disabled(
                    model.isPrivacyActionUnconfirmed(for: profile.id)
                )
                Button("Block user", role: .destructive) {
                    pendingAction = .block
                }
                .disabled(
                    model.isPrivacyActionUnconfirmed(for: profile.id)
                )
            }
        }
        .navigationTitle(profile.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: model.errorMessage) {
            errorIsFocused = FriendDetailAccessibilityPolicy
                .shouldFocusError(
                    message: $0,
                    isPrivacyActionUnconfirmed:
                        model.isPrivacyActionUnconfirmed(
                            for: profile.id
                        )
                )
        }
        .confirmationDialog(
            confirmationTitle,
            isPresented: Binding(
                get: { pendingAction != nil },
                set: { if !$0 { pendingAction = nil } }
            ),
            titleVisibility: .visible
        ) {
            if pendingAction == .remove {
                Button("Remove friend", role: .destructive) {
                    pendingAction = nil
                    Task { await model.remove(profile) }
                }
            }
            if pendingAction == .block {
                Button("Block user", role: .destructive) {
                    pendingAction = nil
                    Task { await model.block(profile) }
                }
            }
            Button("Cancel", role: .cancel) {
                pendingAction = nil
            }
        }
    }

    private var confirmationTitle: String {
        switch pendingAction {
        case .remove:
            return "Remove \(profile.displayName)?"
        case .block:
            return "Block \(profile.displayName)? Existing shares will be revoked."
        case nil:
            return "Confirm friend action"
        }
    }
}

enum FriendDetailAccessibilityPolicy {
    static func shouldFocusError(
        message: String?,
        isPrivacyActionUnconfirmed: Bool
    ) -> Bool {
        message != nil && isPrivacyActionUnconfirmed
    }
}

extension PresenceStatus {
    var accessibleName: String {
        switch self {
        case .studying:
            return "Studying"
        case .eating:
            return "Eating"
        case .inClass:
            return "In class"
        case .free:
            return "Free"
        }
    }
}
