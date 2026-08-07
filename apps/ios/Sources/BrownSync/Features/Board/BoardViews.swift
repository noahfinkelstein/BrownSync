import SwiftUI

struct BoardView: View {
    @ObservedObject var model: BoardViewModel
    let authState: AuthState

    @Environment(\.scenePhase) private var scenePhase
    @State private var title = ""
    @State private var bodyText = ""

    var body: some View {
        let request = model.makeLoadRequest(authState: authState)
        Group {
            switch model.state {
            case .authenticationRequired:
                BoardStateView(
                    BoardStatePresentation.make(
                        for: .authenticationRequired
                    )
                )
            case .loading:
                ProgressView("Loading Board")
                    .accessibilityLabel("Loading Board")
            case .disabled(let presentation),
                .quotaLimited(let presentation),
                .conflict(let presentation):
                BoardStateView(presentation)
            case .failed(_, let presentation):
                BoardStateView(presentation)
            case .loaded(let value):
                loaded(value)
            }
        }
        .navigationTitle("Board")
        .privacySensitive()
        .task(id: request) {
            await model.load(request: request)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .background else {
                return
            }
            title = ""
            bodyText = ""
            Task {
                await model.handleLifecycle(.sceneBackgrounded)
            }
        }
    }

    @ViewBuilder
    private func loaded(_ value: BoardLoadedState) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                BoardDisclosureView(status: value.status)
                BoardStateView(value.availability)

                if value.permissions.canCreate {
                    composer
                }

                if value.feed.posts.isEmpty {
                    VStack(spacing: 8) {
                        Label(
                            "No posts yet",
                            systemImage: "bubble.left.and.bubble.right"
                        )
                        .font(.headline)
                        Text(
                            "Create the first pseudonymous Board post."
                        )
                        .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .accessibilityElement(children: .combine)
                } else {
                    ForEach(value.feed.posts) { post in
                        BoardPostRow(post: post)
                    }
                }

                if value.feed.next != nil {
                    Button("Load more") {
                        Task {
                            await model.loadNextFeedPage()
                        }
                    }
                    .frame(minHeight: 44)
                    .buttonStyle(.bordered)
                    .accessibilityHint(
                        "Loads the next page of Board posts."
                    )
                }
            }
            .padding()
        }
    }

    private var composer: some View {
        GroupBox("Create a post") {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Optional title", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Post title, optional")
                TextEditor(text: $bodyText)
                    .frame(minHeight: 120)
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(
                                Color.secondary.opacity(0.35)
                            )
                    }
                    .accessibilityLabel("Post body")
                Button {
                    let submittedTitle =
                        title.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                    let submittedBody =
                        bodyText.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                    title = ""
                    bodyText = ""
                    Task {
                        await model.createPost(
                            title: submittedTitle.isEmpty
                                ? nil
                                : submittedTitle,
                            body: submittedBody
                        )
                    }
                } label: {
                    Label("Post", systemImage: "paperplane")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    bodyText.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty
                )
                .accessibilityHint(
                    "Publishes one pseudonymous Board post."
                )
            }
        }
    }
}

struct BoardModerationView: View {
    @ObservedObject var model: BoardModerationViewModel
    let authState: AuthState

    var body: some View {
        let request = model.makeLoadRequest(authState: authState)
        Group {
            switch model.state {
            case .authenticationRequired:
                BoardStateView(
                    BoardStatePresentation.make(
                        for: .authenticationRequired
                    )
                )
            case .loading:
                ProgressView("Loading moderation queue")
            case .authorityRequired:
                BoardStateView(
                    BoardStatePresentation.make(
                        for: .authorityRequired
                    )
                )
            case .failed(_, let presentation):
                BoardStateView(presentation)
            case .loaded(let page):
                List(page.items) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Label(
                            item.queueKind == .report
                                ? "Report"
                                : "Appeal",
                            systemImage: item.queueKind == .report
                                ? "flag"
                                : "arrow.uturn.backward.circle"
                        )
                        .font(.headline)
                        if let title = item.title {
                            Text(title)
                                .font(.subheadline.weight(.semibold))
                        }
                        if let body = item.body {
                            Text(body)
                        }
                        Text(
                            "\(item.openReportCount) open reports"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .navigationTitle("Board Moderation")
        .privacySensitive()
        .task(id: request) {
            await model.load(request: request)
        }
    }
}

struct BoardOwnerView: View {
    @ObservedObject var model: BoardOwnerViewModel
    let authState: AuthState

    var body: some View {
        let request = model.makeLoadRequest(authState: authState)
        Group {
            switch model.state {
            case .authenticationRequired:
                BoardStateView(
                    BoardStatePresentation.make(
                        for: .authenticationRequired
                    )
                )
            case .loading:
                ProgressView("Loading Board controls")
            case .authorityRequired:
                BoardStateView(
                    BoardStatePresentation.make(
                        for: .authorityRequired
                    )
                )
            case .failed(_, let presentation):
                BoardStateView(presentation)
            case .loaded(let config, let moderators):
                List {
                    Section("Configuration") {
                        Label(
                            config.enabled
                                ? "Board enabled"
                                : "Board disabled",
                            systemImage: config.enabled
                                ? "checkmark.circle"
                                : "pause.circle"
                        )
                        Text(
                            "Automatic hide threshold: \(config.autoHideThreshold)"
                        )
                    }
                    Section("Moderators") {
                        if let moderators,
                            !moderators.moderators.isEmpty
                        {
                            ForEach(moderators.moderators) { membership in
                                Label(
                                    membership.role == .owner
                                        ? "Owner"
                                        : "Moderator",
                                    systemImage: membership.role == .owner
                                        ? "crown"
                                        : "checkmark.shield"
                                )
                                .accessibilityValue(
                                    membership.role.rawValue
                                )
                            }
                        } else {
                            Text("No moderator memberships returned.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Board Controls")
        .privacySensitive()
        .task(id: request) {
            await model.load(request: request)
        }
    }
}

private struct BoardDisclosureView: View {
    let status: BoardStatus

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Label(
                    "Board privacy",
                    systemImage: "person.crop.circle.badge.questionmark"
                )
                .font(.headline)
                Text(status.privacyNotice)
                Text(status.edgeMetadataNotice)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                "Board privacy. \(status.privacyNotice) \(status.edgeMetadataNotice)"
            )
        }
    }
}

private struct BoardStateView: View {
    let value: BoardStatePresentation

    init(_ value: BoardStatePresentation) {
        self.value = value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(value.title, systemImage: value.systemImage)
                .font(.headline)
            Text(value.message)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(value.accessibilityLabel)
        .accessibilityValue(value.accessibilityValue ?? "")
        .accessibilityHint(value.accessibilityHint ?? "")
    }
}

private struct BoardPostRow: View {
    let post: BoardPost

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(post.authorAlias)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text(post.createdAt, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let title = post.title {
                    Text(title)
                        .font(.headline)
                }
                Text(post.body)
                HStack(spacing: 16) {
                    Label(
                        "\(post.score)",
                        systemImage: post.myVote == .none
                            ? "arrow.up.arrow.down"
                            : "checkmark.circle.fill"
                    )
                    .accessibilityLabel(
                        post.myVote == .none
                            ? "Score \(post.score), no vote selected"
                            : "Score \(post.score), vote selected"
                    )
                    if let count = post.commentCount {
                        Label(
                            "\(count)",
                            systemImage: "bubble.left"
                        )
                        .accessibilityLabel("\(count) comments")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
