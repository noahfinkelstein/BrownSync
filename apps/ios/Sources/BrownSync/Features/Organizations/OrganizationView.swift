import Combine
import SwiftUI

struct OrganizationAssetDependencies: Sendable {
    let mediaRepository: any OrganizationMediaRepository
    let socialRepository: any OrganizationSocialPostRepository
    let uploadCoordinator: OrganizationMediaUploadCoordinator
    let embedPolicy: OrganizationSocialEmbedPolicy
    let sceneLifecycle: OrganizationMediaSceneLifecycle
}

protocol OrganizationAssetDependenciesProviding:
    OrganizationRepository
{
    var organizationAssetDependencies: OrganizationAssetDependencies {
        get
    }
}

struct OrganizationRepositoryWithAssetDependencies:
    OrganizationAssetDependenciesProviding
{
    private let base: any OrganizationRepository
    let organizationAssetDependencies: OrganizationAssetDependencies

    init(
        base: any OrganizationRepository,
        dependencies: OrganizationAssetDependencies
    ) {
        self.base = base
        organizationAssetDependencies = dependencies
    }

    func organizations(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicOrganization]> {
        try await base.organizations(policy: policy)
    }

    func profile(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicOrganizationProfile> {
        try await base.profile(id: id, at: at, policy: policy)
    }
}

@MainActor
private final class OrganizationViewModel: ObservableObject {
    @Published private(set) var profile: PublicOrganizationProfile?
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var errorMessage: String?

    private let id: String
    private let repository: any OrganizationRepository

    init(id: String, repository: any OrganizationRepository) {
        self.id = id
        self.repository = repository
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        errorMessage = nil
        do {
            let loaded = try await repository.profile(
                id: id,
                at: nil,
                policy: policy
            )
            profile = loaded.value
            source = loaded.source
        } catch is CancellationError {
            return
        } catch {
            errorMessage = "This organization is temporarily unavailable."
        }
    }
}

struct OrganizationView: View {
    @StateObject private var model: OrganizationViewModel
    private let id: String
    private let assetDependencies: OrganizationAssetDependencies?

    init(id: String, organizations: any OrganizationRepository) {
        self.id = id
        assetDependencies =
            (organizations
            as? any OrganizationAssetDependenciesProviding)?.organizationAssetDependencies
        _model = StateObject(
            wrappedValue: OrganizationViewModel(
                id: id,
                repository: organizations
            )
        )
    }

    var body: some View {
        Group {
            if let profile = model.profile {
                List {
                    if let source = model.source {
                        PublicSourceLabel(source: source)
                    }
                    if Phase5LaunchGates
                        .organizationMediaAndSocialPresentationEnabled,
                        let assetDependencies
                    {
                        OrganizationMediaSection(
                            organizationID: id,
                            repository:
                                assetDependencies.mediaRepository
                        )
                        OrganizationSocialCardsSection(
                            organizationID: id,
                            repository:
                                assetDependencies.socialRepository,
                            embedPolicy: assetDependencies.embedPolicy
                        )
                    }
                    Section {
                        Text(profile.name)
                            .font(.title2.weight(.semibold))
                        if let summary = profile.summary {
                            Text(summary)
                        }
                        if let about = profile.about {
                            Text(about)
                        }
                    }
                    if profile.advisor != nil
                        || profile.fundingCategory != nil
                        || profile.meetingInformation != nil
                    {
                        Section("Information") {
                            if let advisor = profile.advisor {
                                LabeledContent("Advisor", value: advisor)
                            }
                            if let funding = profile.fundingCategory {
                                LabeledContent(
                                    "Funding category",
                                    value: funding
                                )
                            }
                            if let meeting = profile.meetingInformation {
                                LabeledContent(
                                    "Meeting information",
                                    value: meeting
                                )
                            }
                        }
                    }
                    if !profile.links.isEmpty {
                        Section("Links") {
                            ForEach(
                                Array(profile.links.enumerated()),
                                id: \.offset
                            ) { _, link in
                                if let url = URL(string: link.url) {
                                    Link(destination: url) {
                                        Label(
                                            link.label
                                                ?? link.platform.capitalized,
                                            systemImage:
                                                "arrow.up.right.square"
                                        )
                                    }
                                }
                            }
                        }
                    }
                    if !profile.upcoming.isEmpty {
                        Section("Upcoming Events") {
                            ForEach(profile.upcoming) { event in
                                NavigationLink(
                                    value: AppRoute.event(event.id)
                                ) {
                                    PublicEventRow(event: event)
                                }
                            }
                        }
                    }
                    if !profile.past.isEmpty {
                        Section("Past Events") {
                            ForEach(profile.past) { event in
                                NavigationLink(
                                    value: AppRoute.event(event.id)
                                ) {
                                    PublicEventRow(event: event)
                                }
                            }
                        }
                    }
                }
                .refreshable {
                    await model.load(policy: .reload)
                }
            } else if let error = model.errorMessage {
                PublicErrorView(message: error) {
                    Task { await model.load(policy: .reload) }
                }
            } else {
                PublicLoadingView(title: "Loading organization")
            }
        }
        .navigationTitle(model.profile?.name ?? "Organization")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model.profile == nil else { return }
            await model.load()
        }
    }
}
