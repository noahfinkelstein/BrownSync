import BrownSyncAPI
import SwiftUI

struct PublicShellDependencies: Sendable {
    let cache: PublicResponseCache
    let events: any EventRepository
    let places: any PlaceRepository
    let organizations: any OrganizationRepository

    static func production(
        client: BrownSyncAPI.Client,
        cacheDirectory: URL,
        now: @escaping @Sendable () -> Date = Date.init
    ) -> PublicShellDependencies {
        let cache = PublicResponseCache(
            directory: cacheDirectory,
            schemaVersion: 1
        )
        return PublicShellDependencies(
            cache: cache,
            events: WorkerEventRepository(
                client: client,
                cache: cache,
                now: now
            ),
            places: WorkerPlaceRepository(
                client: client,
                cache: cache,
                now: now
            ),
            organizations: WorkerOrganizationRepository(
                client: client,
                cache: cache,
                now: now
            )
        )
    }
}

enum MapLoadStatus: Equatable {
    case loading
    case ready
    case failed(String)

    var message: String {
        switch self {
        case .loading:
            return "Loading map"
        case .ready:
            return "Map ready"
        case .failed:
            return "Map unavailable"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .loading:
            return "map-status-loading"
        case .ready:
            return "map-status-ready"
        case .failed:
            return "map-status-failed"
        }
    }

    func acceptingFullyRendered() -> MapLoadStatus {
        switch self {
        case .failed:
            return self
        case .loading, .ready:
            return .ready
        }
    }
}

struct RootView: View {
    let dependencies: PublicShellDependencies
    let socialDependencies: SocialDependencies
    let organizationAdminModel: OrganizationAdminViewModel
    let boardDependencies: BoardDependencies

    @ObservedObject private var authCoordinator: AuthCoordinator
    private let deepLinkCoordinator: DeepLinkCoordinator
    private let organizationMediaSceneLifecycle: OrganizationMediaSceneLifecycle?
    @StateObject private var navigator: AppNavigator
    @Environment(\.scenePhase) private var scenePhase
    @State private var presentsAuthentication = false
    @State private var pendingProtectedTab: AppTab?
    @StateObject private var sceneLifecycleSequencer =
        SceneLifecycleTaskSequencer()

    init(
        dependencies: PublicShellDependencies,
        socialDependencies: SocialDependencies,
        organizationAdminModel: OrganizationAdminViewModel,
        boardDependencies: BoardDependencies,
        authCoordinator: AuthCoordinator,
        deepLinkCoordinator: DeepLinkCoordinator,
        navigator: AppNavigator
    ) {
        self.dependencies = dependencies
        self.socialDependencies = socialDependencies
        self.organizationAdminModel = organizationAdminModel
        self.boardDependencies = boardDependencies
        self.deepLinkCoordinator = deepLinkCoordinator
        organizationMediaSceneLifecycle =
            (dependencies.organizations
            as? any OrganizationAssetDependenciesProviding)?.organizationAssetDependencies
            .sceneLifecycle
        _authCoordinator = ObservedObject(wrappedValue: authCoordinator)
        _navigator = StateObject(wrappedValue: navigator)
    }

    var body: some View {
        TabView(selection: selectedTab) {
            NavigationStack(path: $navigator.mapPath) {
                MapScreen(events: dependencies.events) { route in
                    navigator.push(route, in: .map)
                }
                .navigationDestination(for: AppRoute.self) {
                    destination($0)
                }
            }
            .tabItem {
                Label("Map", systemImage: "map")
            }
            .tag(AppTab.map)

            NavigationStack(path: $navigator.feedPath) {
                FeedView(events: dependencies.events)
                    .navigationDestination(for: AppRoute.self) {
                        destination($0)
                    }
            }
            .tabItem {
                Label("Feed", systemImage: "rectangle.stack")
            }
            .tag(AppTab.feed)

            NavigationStack(path: $navigator.searchPath) {
                SearchView(
                    events: dependencies.events,
                    places: dependencies.places,
                    organizations: dependencies.organizations
                )
                .navigationDestination(for: AppRoute.self) {
                    destination($0)
                }
            }
            .tabItem {
                Label("Search", systemImage: "magnifyingglass")
            }
            .tag(AppTab.search)

            NavigationStack(path: $navigator.friendsPath) {
                friendsSurface
                    .navigationDestination(for: AppRoute.self) {
                        destination($0)
                    }
            }
            .tabItem {
                Label("Friends", systemImage: "person.2")
            }
            .tag(AppTab.friends)

            NavigationStack(path: $navigator.mePath) {
                MeProtectedView(
                    authCoordinator: authCoordinator
                )
                .navigationDestination(for: AppRoute.self) {
                    destination($0)
                }
            }
            .tabItem {
                Label("Me", systemImage: "person.crop.circle")
            }
            .tag(AppTab.me)
        }
        .sheet(isPresented: $presentsAuthentication) {
            SignInGateView(authCoordinator: authCoordinator) {
                if let tab = pendingProtectedTab {
                    _ = navigator.select(tab, access: .admitted)
                }
                pendingProtectedTab = nil
                presentsAuthentication = false
            }
        }
        .onChange(of: authCoordinator.state) { state in
            switch state {
            case .signedOut:
                _ = organizationAdminModel.deactivate(
                    reason: .signedOut
                )
                navigator.clearProtectedPaths()
            case .admitted(let identity):
                if navigator.selectedTab == .me,
                    navigator.mePath.contains(.organizationAdmin)
                {
                    Task {
                        await organizationAdminModel.activate(
                            authState: state
                        )
                    }
                }
                guard
                    AuthForegroundActivationPolicy.shouldResume(
                        state: state,
                        scenePhase: scenePhase
                    )
                else {
                    return
                }
                Task { @MainActor in
                    guard
                        scenePhase == .active,
                        case .admitted(let currentIdentity) =
                            authCoordinator.state,
                        currentIdentity.id == identity.id
                    else {
                        return
                    }
                    await boardDependencies.lifecycle
                        .activateForeground(userID: identity.id)
                }
                sceneLifecycleSequencer.submit { isCurrent in
                    guard
                        isCurrent(),
                        scenePhase == .active,
                        case .admitted = authCoordinator.state
                    else {
                        return
                    }
                    await socialDependencies.writeCoordinator
                        .resumePublishingForForeground()
                }
            case .authenticating:
                _ = organizationAdminModel.deactivate(
                    reason: .authExpired
                )
                navigator.clearProtectedPaths()
            }
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .inactive:
                _ = organizationAdminModel.deactivateReviewQueue()
            case .background:
                _ = organizationAdminModel.deactivate(
                    reason: .sceneBackgrounded
                )
                boardDependencies.lifecycle.enqueueSceneBackground()
                organizationMediaSceneLifecycle?
                    .enqueueSceneBackground()
            case .active:
                if case .admitted(let identity) =
                    authCoordinator.state
                {
                    Task { @MainActor in
                        guard
                            scenePhase == .active,
                            case .admitted(let currentIdentity) =
                                authCoordinator.state,
                            currentIdentity.id == identity.id
                        else {
                            return
                        }
                        await boardDependencies.lifecycle
                            .activateForeground(userID: identity.id)
                    }
                    organizationMediaSceneLifecycle?
                        .enqueueSceneActive(userID: identity.id)
                }
                if navigator.selectedTab == .me,
                    navigator.mePath.contains(.organizationAdmin)
                {
                    Task {
                        await organizationAdminModel.activate(
                            authState: authCoordinator.state
                        )
                    }
                }
            @unknown default:
                break
            }
            sceneLifecycleSequencer.submit { isCurrent in
                switch phase {
                case .background:
                    guard isCurrent() else { return }
                    await socialDependencies.writeCoordinator
                        .suspendPublishingForBackground()
                    guard isCurrent() else { return }
                    await socialDependencies.realtimeCoordinator
                        .friendsSurfaceBecameInactive()
                    guard isCurrent() else { return }
                    await socialDependencies.cache.purge(
                        reason: .sceneBackgrounded
                    )
                case .active:
                    guard
                        isCurrent(),
                        case .admitted = authCoordinator.state
                    else {
                        return
                    }
                    await socialDependencies.writeCoordinator
                        .resumePublishingForForeground()
                case .inactive:
                    break
                @unknown default:
                    break
                }
            }
        }
        .onChange(of: navigator.selectedTab) { tab in
            if tab == .me {
                if navigator.mePath.contains(.organizationAdmin) {
                    Task {
                        await organizationAdminModel.activate(
                            authState: authCoordinator.state
                        )
                    }
                }
            } else {
                _ = organizationAdminModel.deactivate(
                    reason: .sceneBackgrounded
                )
            }
        }
        .onChange(of: navigator.mePath) { path in
            if path.contains(.organizationAdmin) {
                guard navigator.selectedTab == .me else { return }
                Task {
                    await organizationAdminModel.activate(
                        authState: authCoordinator.state
                    )
                }
            } else {
                _ = organizationAdminModel.deactivate(
                    reason: .sceneBackgrounded
                )
            }
        }
        .onOpenURL { url in
            Task {
                let result = await deepLinkCoordinator.handle(url)
                _ = navigator.handle(result, access: access)
            }
        }
    }

    @ViewBuilder
    private var friendsSurface: some View {
        if case .admitted(let identity) = authCoordinator.state {
            FriendsView(
                currentUserID: identity.id,
                dependencies: socialDependencies,
                places: dependencies.places,
                isSurfaceActive: FriendsSurfaceActivityPolicy.isActive(
                    selectedTab: navigator.selectedTab,
                    scenePhase: scenePhase
                )
            )
            .id(identity.id)
        } else {
            ProgressView("Brown sign-in required")
                .navigationTitle("Friends")
        }
    }

    private var access: AppAccess {
        if case .admitted = authCoordinator.state {
            return .admitted
        }
        return .signedOut
    }

    private var selectedTab: Binding<AppTab> {
        Binding(
            get: { navigator.selectedTab },
            set: { tab in
                switch navigator.select(tab, access: access) {
                case .routed:
                    break
                case .authenticationRequired(let protectedTab):
                    pendingProtectedTab = protectedTab
                    presentsAuthentication = true
                case .ignored:
                    break
                }
            }
        )
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        switch route {
        case .event(let id):
            EventDetailView(id: id, events: dependencies.events)
        case .place(let id):
            PlaceView(id: id, places: dependencies.places)
        case .organization(let id):
            OrganizationView(
                id: id,
                organizations: dependencies.organizations
            )
        case .organizationAdmin:
            MyOrganizationsView(
                model: organizationAdminModel,
                authState: authCoordinator.state,
                organizations: dependencies.organizations
            )
        case .board:
            BoardHostedGateView()
        }
    }
}

enum FriendsSurfaceActivityPolicy {
    static func isActive(
        selectedTab: AppTab,
        scenePhase: ScenePhase
    ) -> Bool {
        selectedTab == .friends && scenePhase == .active
    }
}

enum AuthForegroundActivationPolicy {
    static func shouldResume(
        state: AuthState,
        scenePhase: ScenePhase
    ) -> Bool {
        guard case .admitted = state else { return false }
        return scenePhase == .active
    }
}

@MainActor
final class SceneLifecycleTaskSequencer: ObservableObject {
    typealias IsCurrent = @MainActor () -> Bool
    typealias Operation =
        @MainActor (@escaping IsCurrent) async -> Void

    private var generation: UInt64 = 0
    private var tail: Task<Void, Never>?

    func submit(_ operation: @escaping Operation) {
        generation &+= 1
        let expectedGeneration = generation
        let previous = tail
        tail = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            guard generation == expectedGeneration else { return }
            await operation { [weak self] in
                self?.generation == expectedGeneration
            }
        }
    }

    func waitForIdle() async {
        await tail?.value
    }
}

private struct MeProtectedView: View {
    @ObservedObject var authCoordinator: AuthCoordinator

    var body: some View {
        List {
            if case .admitted(let identity) = authCoordinator.state {
                Section("Brown Account") {
                    LabeledContent("Email", value: identity.email)
                    NavigationLink(value: AppRoute.organizationAdmin) {
                        Label(
                            "Manage Organizations",
                            systemImage: "person.3"
                        )
                    }
                    Button("Sign Out", role: .destructive) {
                        Task {
                            await authCoordinator.signOut()
                        }
                    }
                }
            }
        }
        .navigationTitle("Me")
    }
}

private struct BoardHostedGateView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.title)
            Text("Board is not available")
                .font(.headline)
            Text(
                "The native Board remains off until its protected hosted service is deliberately enabled."
            )
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding()
        .navigationTitle("Board")
        .accessibilityElement(children: .combine)
    }
}

private struct SignInGateView: View {
    @ObservedObject var authCoordinator: AuthCoordinator
    let onSignedIn: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Image(systemName: "lock")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("Brown sign-in required")
                    .font(.title2.weight(.semibold))
                Text(
                    "Friends and account features are available to admitted Brown accounts."
                )
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
                Button {
                    Task {
                        do {
                            try await authCoordinator.signInInteractively()
                            onSignedIn()
                        } catch {
                            errorMessage =
                                "Sign-in did not complete. Please try again."
                        }
                    }
                } label: {
                    if authCoordinator.state == .authenticating {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Continue with Brown Google")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(authCoordinator.state == .authenticating)
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
