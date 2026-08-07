import Combine
import SwiftUI

@MainActor
final class OrganizationMediaPublicViewModel: ObservableObject {
    @Published private(set) var collection: OrganizationMediaCollection?
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var isLoading = false
    @Published private(set) var error: OrganizationAssetError?

    private let organizationID: String
    private let repository: any OrganizationMediaRepository

    init(
        organizationID: String,
        repository: any OrganizationMediaRepository
    ) {
        self.organizationID = organizationID
        self.repository = repository
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resource = try await repository.media(
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

struct OrganizationMediaSection: View {
    @StateObject private var model: OrganizationMediaPublicViewModel
    private let canReorder: Bool
    private let moveEarlier: @MainActor (UUID) -> Void
    private let moveLater: @MainActor (UUID) -> Void

    init(
        organizationID: String,
        repository: any OrganizationMediaRepository,
        canReorder: Bool = false,
        moveEarlier: @escaping @MainActor (UUID) -> Void = { _ in },
        moveLater: @escaping @MainActor (UUID) -> Void = { _ in }
    ) {
        _model = StateObject(
            wrappedValue: OrganizationMediaPublicViewModel(
                organizationID: organizationID,
                repository: repository
            )
        )
        self.canReorder = canReorder
        self.moveEarlier = moveEarlier
        self.moveLater = moveLater
    }

    var body: some View {
        Section("Photos") {
            if let source = model.source {
                mediaSourceLabel(source)
            }

            if let collection = model.collection {
                if collection.avatar == nil,
                    collection.banner == nil,
                    collection.gallery.isEmpty
                {
                    Text("This organization has not added photos yet.")
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(
                            "No organization photos are available."
                        )
                } else {
                    if let avatar = collection.avatar {
                        OrganizationMediaImage(
                            asset: avatar,
                            aspectRatio: 1
                        )
                    }
                    if let banner = collection.banner {
                        OrganizationMediaImage(
                            asset: banner,
                            aspectRatio: 16 / 9
                        )
                    }
                    ForEach(
                        Array(collection.gallery.enumerated()),
                        id: \.element.id
                    ) { index, asset in
                        if canReorder {
                            OrganizationMediaImage(
                                asset: asset,
                                aspectRatio:
                                    CGFloat(asset.width)
                                    / CGFloat(asset.height)
                            )
                            .accessibilityActions {
                                if index > 0 {
                                    Button("Move image earlier") {
                                        moveEarlier(asset.id)
                                    }
                                }
                                if index + 1 < collection.gallery.count {
                                    Button("Move image later") {
                                        moveLater(asset.id)
                                    }
                                }
                            }
                        } else {
                            OrganizationMediaImage(
                                asset: asset,
                                aspectRatio:
                                    CGFloat(asset.width)
                                    / CGFloat(asset.height)
                            )
                        }
                    }
                }
            } else if model.isLoading {
                HStack {
                    ProgressView()
                    Text("Loading organization photos…")
                }
                .accessibilityElement(children: .combine)
            } else if let error = model.error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(message(for: error))
                    Button("Try loading photos again") {
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
    private func mediaSourceLabel(
        _ source: PublicDataSource
    ) -> some View {
        switch source {
        case .network:
            EmptyView()
        case .cache:
            Label(
                "Showing recently saved public photos.",
                systemImage: "clock"
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        case .offline(let isStale):
            Label(
                isStale
                    ? "Offline — these public photos may be out of date."
                    : "Offline — showing saved public photos.",
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
            return "Organization photos are not available."
        case .quotaExceeded:
            return "Photos are temporarily busy. Try again shortly."
        default:
            return "Organization photos could not be loaded."
        }
    }
}

private struct OrganizationMediaImage: View {
    let asset: OrganizationMediaAsset
    let aspectRatio: CGFloat

    var body: some View {
        AsyncImage(url: asset.url) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
            case .empty:
                ZStack {
                    Color.secondary.opacity(0.12)
                    ProgressView()
                }
            case .failure:
                ZStack {
                    Color.secondary.opacity(0.12)
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
            @unknown default:
                Color.secondary.opacity(0.12)
            }
        }
        .aspectRatio(aspectRatio, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel(asset.altText)
    }
}
