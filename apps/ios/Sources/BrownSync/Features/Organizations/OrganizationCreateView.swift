import Foundation
import SwiftUI

struct OrganizationCreateView: View {
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
            self == .x ? "X" : rawValue.capitalized
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
    }

    private struct LinkDraft: Identifiable {
        let id = UUID()
        var platform: LinkPlatformChoice = .website
        var url = ""
        var label = ""
    }

    private struct OutcomePresentation: Equatable {
        let title: String
        let message: String
        let systemImage: String
    }

    @ObservedObject private var model: OrganizationAdminViewModel
    private let authState: AuthState

    @State private var name = ""
    @State private var descriptionText = ""
    @State private var aboutText = ""
    @State private var meetingText = ""
    @State private var links: [LinkDraft] = []
    @State private var isSubmitting = false
    @State private var failure: SafeFailurePresentation?
    @State private var outcome: OutcomePresentation?

    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var errorIsFocused: Bool
    @AccessibilityFocusState private var outcomeIsFocused: Bool

    init(
        model: OrganizationAdminViewModel,
        authState: AuthState
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.authState = authState
    }

    var body: some View {
        Group {
            if canRenderProtectedForm {
                createForm
            } else {
                List {
                    OrganizationAdminStateRow(
                        title: "Brown sign-in required",
                        message:
                            "Sign in with an admitted Brown account to create an organization.",
                        systemImage: "lock"
                    )
                }
            }
        }
        .navigationTitle("Create Organization")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: authState) {
            guard scenePhase == .active else { return }
            await model.activate(authState: authState)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else {
                clearProtectedDraft()
                return
            }
            Task {
                await model.activate(authState: authState)
            }
        }
        .onChange(of: authState) { state in
            guard case .admitted = state else {
                clearProtectedDraft()
                return
            }
        }
        .onChange(of: model.state) { state in
            if case .authenticationRequired = state {
                clearProtectedDraft()
            }
        }
        .onDisappear {
            clearProtectedDraft()
        }
    }

    private var createForm: some View {
        Form {
            if let failure {
                Section {
                    OrganizationAdminFailureRow(failure: failure)
                        .accessibilityFocused($errorIsFocused)
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
                        resetForAnotherOrganization()
                    } label: {
                        Label(
                            "Create another organization",
                            systemImage: "plus.circle"
                        )
                    }
                    .accessibilityHint(
                        "Clears this form for a different organization."
                    )
                }
                .privacySensitive()
            }

            Section {
                TextField("Organization name", text: $name)
                    .textInputAutocapitalization(.words)
                    .privacySensitive()
                    .accessibilityLabel("Organization name")
                    .accessibilityHint(
                        "Required. Use 160 characters or fewer."
                    )
            } header: {
                Text("Name")
            } footer: {
                OrganizationCharacterCount(
                    current: name.utf16.count,
                    limit: 160
                )
            }

            Section {
                TextEditor(text: $descriptionText)
                    .frame(minHeight: 88)
                    .privacySensitive()
                    .accessibilityLabel("Organization description")
            } header: {
                Text("Description")
            } footer: {
                OrganizationCharacterCount(
                    current: descriptionText.utf16.count,
                    limit: 10_000
                )
            }

            Section {
                TextEditor(text: $aboutText)
                    .frame(minHeight: 120)
                    .privacySensitive()
                    .accessibilityLabel("Organization about text")
            } header: {
                Text("About")
            } footer: {
                OrganizationCharacterCount(
                    current: aboutText.utf16.count,
                    limit: 20_000
                )
            }

            Section {
                TextEditor(text: $meetingText)
                    .frame(minHeight: 88)
                    .privacySensitive()
                    .accessibilityLabel("Meeting information")
            } header: {
                Text("Meeting information")
            } footer: {
                OrganizationCharacterCount(
                    current: meetingText.utf16.count,
                    limit: 4_000
                )
            }

            Section {
                ForEach($links) { $link in
                    VStack(alignment: .leading, spacing: 10) {
                        Picker(
                            "Platform",
                            selection: $link.platform
                        ) {
                            ForEach(
                                LinkPlatformChoice.allCases,
                                id: \.self
                            ) { platform in
                                Text(platform.title)
                                    .tag(platform)
                            }
                        }

                        TextField(
                            "HTTPS URL",
                            text: $link.url
                        )
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .privacySensitive()
                        .accessibilityHint(
                            "Required for this link and limited to 2,048 characters."
                        )

                        TextField(
                            "Optional label",
                            text: $link.label
                        )
                        .privacySensitive()
                        .accessibilityHint(
                            "Use 80 characters or fewer."
                        )

                        Button(role: .destructive) {
                            links.removeAll {
                                $0.id == link.id
                            }
                        } label: {
                            Label(
                                "Remove link",
                                systemImage: "trash"
                            )
                        }
                        .accessibilityLabel(
                            "Remove \(link.platform.title) link"
                        )
                    }
                    .padding(.vertical, 4)
                }

                Button {
                    links.append(LinkDraft())
                } label: {
                    Label(
                        "Add link",
                        systemImage: "plus.circle"
                    )
                }
                .disabled(links.count >= 20)
                .accessibilityHint(
                    "Adds another HTTPS organization link. Up to 20 links are allowed."
                )
            } header: {
                Text("Links")
            } footer: {
                Text("\(links.count) of 20 links")
            }

            if let validationMessage {
                Section {
                    Label(
                        validationMessage,
                        systemImage: "exclamationmark.triangle"
                    )
                    .foregroundStyle(.red)
                    .accessibilityLabel(
                        "Cannot create organization. \(validationMessage)"
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
                            Text("Creating organization")
                        }
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 44
                        )
                    } else {
                        Label(
                            "Create organization",
                            systemImage: "plus.circle.fill"
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
                    "Submits only the organization fields shown in this form."
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

    private var canSubmit: Bool {
        validationMessage == nil
            && !isSubmitting
            && outcome == nil
            && model.state.allowsOrganizationMutation
    }

    private var validationMessage: String? {
        let trimmedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !trimmedName.isEmpty else {
            return "Enter an organization name."
        }
        guard trimmedName.utf16.count <= 160 else {
            return "Organization name must be 160 characters or fewer."
        }
        guard descriptionText.utf16.count <= 10_000 else {
            return "Description must be 10,000 characters or fewer."
        }
        guard aboutText.utf16.count <= 20_000 else {
            return "About text must be 20,000 characters or fewer."
        }
        guard meetingText.utf16.count <= 4_000 else {
            return "Meeting information must be 4,000 characters or fewer."
        }
        guard links.count <= 20 else {
            return "Use no more than 20 links."
        }

        for link in links {
            let urlText = link.url.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard !urlText.isEmpty else {
                return "Enter an HTTPS URL for every link."
            }
            guard urlText.utf16.count <= 2_048 else {
                return "Each link URL must be 2,048 characters or fewer."
            }
            guard
                let url = URL(string: urlText),
                url.scheme?.lowercased() == "https",
                url.host != nil
            else {
                return "Every organization link must use a valid HTTPS URL."
            }
            guard link.label.utf16.count <= 80 else {
                return "Each link label must be 80 characters or fewer."
            }
        }

        return nil
    }

    private var domainLinks: [OrganizationLink]? {
        guard validationMessage == nil else { return nil }
        return links.compactMap { link in
            let urlText = link.url.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard let url = URL(string: urlText) else {
                return nil
            }
            return OrganizationLink(
                platform: link.platform.domainValue,
                url: url,
                label: nonBlankOrganizationText(link.label)
            )
        }
    }

    private func submit() async {
        guard
            canSubmit,
            let domainLinks
        else {
            return
        }

        let trimmedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let draft = OrganizationCreateDraft(
            name: trimmedName,
            description: optionalProtectedText(descriptionText),
            aboutMarkdown: optionalProtectedText(aboutText),
            meetingInformation: optionalProtectedText(meetingText),
            links: domainLinks
        )

        isSubmitting = true
        failure = nil
        defer { isSubmitting = false }

        do {
            let result = try await model.create(draft)
            try Task.checkCancellation()
            outcome = createOutcomePresentation(result)
            outcomeIsFocused = true
            await model.refresh(authState: authState)
        } catch is CancellationError {
            return
        } catch {
            failure = SafeFailurePresentation.make(for: error)
            errorIsFocused = true
        }
    }

    private func createOutcomePresentation(
        _ result: OrganizationCreateOutcome
    ) -> OutcomePresentation {
        switch result.disposition {
        case .created:
            return OutcomePresentation(
                title: "Organization created",
                message:
                    "The organization was created and your \(result.role.localizedTitle.lowercased()) access was recorded.",
                systemImage: "checkmark.circle"
            )
        case .replayed:
            return OutcomePresentation(
                title: "Organization already created",
                message:
                    "The server recognized the same creation request and returned the existing organization with your \(result.role.localizedTitle.lowercased()) access.",
                systemImage: "arrow.clockwise.circle"
            )
        }
    }

    private func optionalProtectedText(
        _ value: String
    ) -> String? {
        value.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty ? nil : value
    }

    private func resetForAnotherOrganization() {
        clearProtectedDraft()
        outcome = nil
        failure = nil
    }

    private func clearProtectedDraft() {
        name = ""
        descriptionText = ""
        aboutText = ""
        meetingText = ""
        links = []
        failure = nil
        outcome = nil
        isSubmitting = false
    }
}

struct OrganizationCharacterCount: View {
    let current: Int
    let limit: Int

    var body: some View {
        Text("\(current) of \(limit) characters")
            .foregroundStyle(
                current > limit ? Color.red : Color.secondary
            )
            .accessibilityLabel(
                "\(current) of \(limit) characters used"
            )
    }
}

extension OrganizationAdminViewModel.State {
    var allowsOrganizationMutation: Bool {
        switch self {
        case .empty, .loaded, .failed:
            return true
        case .authenticationRequired, .loading:
            return false
        }
    }
}
