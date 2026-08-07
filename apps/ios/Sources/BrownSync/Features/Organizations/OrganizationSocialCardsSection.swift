import Combine
import SwiftUI

@MainActor
final class OrganizationSocialCardsViewModel: ObservableObject {
    @Published private(set) var collection: OrganizationSocialPostCollection?
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var isLoading = false
    @Published private(set) var error: OrganizationAssetError?

    private let organizationID: String
    private let repository: any OrganizationSocialPostRepository

    init(
        organizationID: String,
        repository: any OrganizationSocialPostRepository
    ) {
        self.organizationID = organizationID
        self.repository = repository
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resource = try await repository.posts(
                organizationID: organizationID,
                policy: policy
            )
            collection = resource.value
            source = resource.source
        } catch is CancellationError {
            return
        } catch let error as OrganizationAssetError {
            self.error = error
        } catch {
            self.error = .unavailable
        }
    }
}

struct OrganizationSocialCardsSection: View {
    @StateObject private var model: OrganizationSocialCardsViewModel
    private let embedPolicy: OrganizationSocialEmbedPolicy

    init(
        organizationID: String,
        repository: any OrganizationSocialPostRepository,
        embedPolicy: OrganizationSocialEmbedPolicy
    ) {
        _model = StateObject(
            wrappedValue: OrganizationSocialCardsViewModel(
                organizationID: organizationID,
                repository: repository
            )
        )
        self.embedPolicy = embedPolicy
    }

    var body: some View {
        Section("Instagram") {
            if let source = model.source {
                socialSourceLabel(source)
            }

            if let collection = model.collection {
                if collection.posts.isEmpty {
                    Text(
                        "This organization has not shared Instagram posts yet."
                    )
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(
                        "No Instagram posts are available."
                    )
                } else {
                    ForEach(collection.posts) { post in
                        OrganizationSocialCardRow(
                            post: post,
                            embedPolicy: embedPolicy
                        )
                    }
                }
            } else if model.isLoading {
                HStack {
                    ProgressView()
                    Text("Loading Instagram posts…")
                }
                .accessibilityElement(children: .combine)
            } else if let error = model.error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(message(for: error))
                    Button("Try loading Instagram posts again") {
                        Task { await model.load(policy: .reload) }
                    }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .task {
            guard model.collection == nil else { return }
            await model.load()
        }
    }

    @ViewBuilder
    private func socialSourceLabel(
        _ source: PublicDataSource
    ) -> some View {
        switch source {
        case .network:
            EmptyView()
        case .cache:
            Label(
                "Showing recently saved public Instagram cards.",
                systemImage: "clock"
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        case .offline(let isStale):
            Label(
                isStale
                    ? "Offline — these Instagram cards may be out of date."
                    : "Offline — showing saved Instagram cards.",
                systemImage: "wifi.slash"
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }

    private func message(
        for error: OrganizationAssetError
    ) -> String {
        switch error {
        case .notFound:
            return "Instagram cards are not available."
        case .quotaExceeded:
            return "Instagram cards are temporarily busy. Try again shortly."
        default:
            return "Instagram cards could not be loaded."
        }
    }
}

private struct OrganizationSocialCardRow: View {
    let post: OrganizationSocialPost
    let embedPolicy: OrganizationSocialEmbedPolicy

    @State private var embedFailed = false

    private var presentation: OrganizationSocialCardPresentation {
        var value = OrganizationSocialCardPresentation(
            post: post,
            embedPolicy: embedPolicy
        )
        if embedFailed {
            value.embedFailed()
        }
        return value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                presentation.attributionText,
                systemImage: "camera"
            )
            .font(.headline)

            if case .embed = presentation.content {
                OrganizationSocialEmbedView(
                    post: post,
                    policy: embedPolicy
                ) {
                    embedFailed = true
                }
                .frame(minHeight: 320)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Text(
                    "Preview unavailable. The original Instagram link remains available."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }

            if let canonical = try? InstagramPermalink(
                post.permalink.absoluteString
            ).url,
                canonical == post.permalink
            {
                Link(destination: canonical) {
                    Label(
                        presentation.openActionLabel,
                        systemImage: "arrow.up.right.square"
                    )
                }
                .accessibilityLabel(
                    presentation.openActionLabel
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(presentation.accessibilityLabel)
    }
}
