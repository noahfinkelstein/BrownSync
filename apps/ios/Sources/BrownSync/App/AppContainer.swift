import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Supabase

@MainActor
final class AppContainer {
    let configuration: AppConfiguration
    let authCoordinator: AuthCoordinator
    let recentAuthenticationCoordinator: RecentAuthenticationCoordinator
    let deepLinkCoordinator: DeepLinkCoordinator
    let publicWorkerClient: BrownSyncAPI.Client
    let protectedWorkerClient: BrownSyncAPI.Client
    let publicShellDependencies: PublicShellDependencies
    let socialDependencies: SocialDependencies?
    let organizationAssetDependencies: OrganizationAssetDependencies?
    let organizationAdminModel: OrganizationAdminViewModel
    let boardDependencies: BoardDependencies
    let navigator: AppNavigator

    private let retainedSupabaseClient: SupabaseClient?

    convenience init(
        configuration: AppConfiguration,
        session: any SessionProviding,
        googleIdentity: any GoogleIdentityProviding,
        account: any AccountRepository,
        recentAuthenticationContextCreator:
            any RecentAuthenticationContextCreating,
        invalidator: any ProtectedSessionInvalidating,
        supabaseCallbacks: any SupabaseCallbackHandling,
        publicShellDependencies: PublicShellDependencies
    ) {
        let clients = WorkerAPIClients(
            baseURL: configuration.apiBaseURL,
            tokenProvider: BearerTokenProvider(session: session),
            transport: UnavailableWorkerTransport()
        )
        let ownershipSessionController =
            OrganizationOwnershipSessionController()
        let boardDependencies = BoardDependencies(
            networkSession: URLSession(
                configuration: BoardNetworkPolicy.makeConfiguration()
            ),
            protectedClient: clients.protectedClient
        )
        self.init(
            configuration: configuration,
            session: session,
            googleIdentity: googleIdentity,
            account: account,
            recentAuthenticationContextCreator:
                recentAuthenticationContextCreator,
            invalidator: AppProtectedSessionInvalidator(
                base: invalidator,
                ownership: ownershipSessionController,
                board: boardDependencies.lifecycle,
                media: nil
            ),
            supabaseCallbacks: supabaseCallbacks,
            clients: clients,
            publicShellDependencies: publicShellDependencies,
            socialDependencies: nil,
            organizationAssetDependencies: nil,
            boardDependencies: boardDependencies,
            navigator: AppNavigator(),
            ownershipSessionController: ownershipSessionController,
            retainedSupabaseClient: nil
        )
    }

    static func production(bundle: Bundle = .main) throws -> AppContainer {
        let configuration = try AppConfiguration(bundle: bundle)
        let supabase = SupabaseClient(
            supabaseURL: configuration.supabaseURL,
            supabaseKey: configuration.supabasePublishableKey
        )
        let session = SupabaseSessionStore(client: supabase)
        let tokenProvider = BearerTokenProvider(session: session)
        let clients = WorkerAPIClients(
            baseURL: configuration.apiBaseURL,
            tokenProvider: tokenProvider
        )
        let boardDependencies = BoardDependencies.production(
            baseURL: configuration.apiBaseURL,
            tokenProvider: tokenProvider
        )
        let account = WorkerAccountRepository(
            client: clients.protectedClient,
            retrier: WorkerRequestRetrier(session: session)
        )
        let recentAuthenticationContextCreator =
            SupabaseRecentAuthenticationContextFactory(
                supabaseURL: configuration.supabaseURL,
                supabasePublishableKey:
                    configuration.supabasePublishableKey,
                apiBaseURL: configuration.apiBaseURL
            )
        let google = GoogleIdentityProvider(
            clientID: configuration.googleIOSClientID,
            serverClientID: configuration.googleServerClientID,
            presentationProvider: WindowPresentationControllerProvider()
        )
        let navigator = AppNavigator()
        let socialRepository = SupabaseSocialRepository(
            transport: SupabaseSocialDatabaseTransport(client: supabase)
        )
        let sensitiveCache = SensitiveCache(currentUserID: nil)
        let presenceTimeSource = SystemPresenceTimeSource()
        let presenceWrites = PresenceWriteCoordinator(
            repository: socialRepository,
            cache: sensitiveCache,
            timeSource: presenceTimeSource,
            initiallyActive: false
        )
        let presenceRealtime = PresenceRealtimeCoordinator(
            repository: socialRepository,
            cache: sensitiveCache,
            channel: SupabasePresenceRealtimeChannel(client: supabase),
            reconciliationTicker: PresenceReconciliationTicker(),
            timeSource: presenceTimeSource
        )
        guard
            let campusBuildingsURL = bundle.url(
                forResource: "campus-buildings",
                withExtension: "geojson"
            )
        else {
            throw AppContainerError.campusBuildingsUnavailable
        }
        let campusBuildings = try CampusBuildings.decode(
            Data(contentsOf: campusBuildingsURL)
        )
        let socialDependencies = SocialDependencies(
            repository: socialRepository,
            cache: sensitiveCache,
            writeCoordinator: presenceWrites,
            realtimeCoordinator: presenceRealtime,
            timeSource: presenceTimeSource,
            locationProvider: CoreLocationProvider(),
            placeSnapper: CampusPlaceSnapper(buildings: campusBuildings)
        )
        let ownershipSessionController =
            OrganizationOwnershipSessionController()
        guard
            let cachesDirectory = FileManager.default.urls(
                for: .cachesDirectory,
                in: .userDomainMask
            ).first
        else {
            throw AppContainerError.cachesDirectoryUnavailable
        }
        let basePublicShellDependencies =
            PublicShellDependencies.production(
                client: clients.publicClient,
                cacheDirectory: cachesDirectory.appendingPathComponent(
                    "PublicResponses",
                    isDirectory: true
                )
            )
        let protectedMediaStore =
            FileBackedOrganizationMediaProtectedStore()
        let embedPolicy = OrganizationSocialEmbedPolicy(
            isolatedOrigin: configuration.apiBaseURL
        )
        let organizationMediaRepository =
            WorkerOrganizationMediaRepository(
                publicClient: clients.publicClient,
                protectedClient: clients.protectedClient,
                cache: basePublicShellDependencies.cache,
                protectedStore: protectedMediaStore
            )
        let organizationSocialRepository =
            WorkerOrganizationSocialPostRepository(
                publicClient: clients.publicClient,
                protectedClient: clients.protectedClient,
                cache: basePublicShellDependencies.cache,
                embedPolicy: embedPolicy
            )
        let organizationMediaUploadCoordinator =
            OrganizationMediaUploadCoordinator(
                repository: organizationMediaRepository,
                preparer: ImageIOOrganizationImagePreparer(),
                protectedStore: protectedMediaStore,
                uuids: SystemUUIDProvider(),
                initiallyActive: false
            )
        let organizationMediaPurger =
            OrganizationMediaSensitiveCachePurger(
                store: protectedMediaStore
            )
        let organizationMediaSceneLifecycle =
            OrganizationMediaSceneLifecycle(
                tasks: organizationMediaUploadCoordinator,
                purger: organizationMediaPurger
            )
        let organizationAssetDependencies =
            OrganizationAssetDependencies(
                mediaRepository: organizationMediaRepository,
                socialRepository: organizationSocialRepository,
                uploadCoordinator:
                    organizationMediaUploadCoordinator,
                embedPolicy: embedPolicy,
                sceneLifecycle: organizationMediaSceneLifecycle
            )
        let publicShellDependencies = PublicShellDependencies(
            cache: basePublicShellDependencies.cache,
            events: basePublicShellDependencies.events,
            places: basePublicShellDependencies.places,
            organizations:
                OrganizationRepositoryWithAssetDependencies(
                    base: basePublicShellDependencies.organizations,
                    dependencies: organizationAssetDependencies
                )
        )
        let invalidator = AppProtectedSessionInvalidator(
            base: ProtectedSessionInvalidator(
                tasks: CompositeProtectedTaskCanceller(
                    tasks: [presenceWrites]
                ),
                realtime: presenceRealtime,
                navigation: AppNavigatorProtectedNavigation(
                    navigator: navigator
                ),
                caches: CompositeSensitiveCachePurger(
                    caches: [sensitiveCache]
                )
            ),
            ownership: ownershipSessionController,
            board: boardDependencies.lifecycle,
            media: organizationMediaSceneLifecycle
        )
        return AppContainer(
            configuration: configuration,
            session: session,
            googleIdentity: google,
            account: account,
            recentAuthenticationContextCreator:
                recentAuthenticationContextCreator,
            invalidator: invalidator,
            supabaseCallbacks: SupabaseAuthCallbackHandler(client: supabase),
            clients: clients,
            publicShellDependencies: publicShellDependencies,
            socialDependencies: socialDependencies,
            organizationAssetDependencies:
                organizationAssetDependencies,
            boardDependencies: boardDependencies,
            navigator: navigator,
            ownershipSessionController: ownershipSessionController,
            retainedSupabaseClient: supabase
        )
    }

    private init(
        configuration: AppConfiguration,
        session: any SessionProviding,
        googleIdentity: any GoogleIdentityProviding,
        account: any AccountRepository,
        recentAuthenticationContextCreator:
            any RecentAuthenticationContextCreating,
        invalidator: any ProtectedSessionInvalidating,
        supabaseCallbacks: any SupabaseCallbackHandling,
        clients: WorkerAPIClients,
        publicShellDependencies: PublicShellDependencies,
        socialDependencies: SocialDependencies?,
        organizationAssetDependencies: OrganizationAssetDependencies?,
        boardDependencies: BoardDependencies,
        navigator: AppNavigator,
        ownershipSessionController:
            OrganizationOwnershipSessionController,
        retainedSupabaseClient: SupabaseClient?
    ) {
        self.configuration = configuration
        self.retainedSupabaseClient = retainedSupabaseClient
        publicWorkerClient = clients.publicClient
        protectedWorkerClient = clients.protectedClient
        self.publicShellDependencies = publicShellDependencies
        self.socialDependencies = socialDependencies
        self.organizationAssetDependencies =
            organizationAssetDependencies
        self.boardDependencies = boardDependencies
        self.navigator = navigator
        let authCoordinator = AuthCoordinator(
            googleIdentity: googleIdentity,
            session: session,
            account: account,
            invalidator: invalidator
        )
        self.authCoordinator = authCoordinator
        recentAuthenticationCoordinator = RecentAuthenticationCoordinator(
            googleIdentity: googleIdentity,
            canonicalSession: session,
            contextCreator: recentAuthenticationContextCreator,
            invalidator: invalidator
        )
        deepLinkCoordinator = DeepLinkCoordinator(
            googleCallbacks: googleIdentity,
            supabaseCallbacks: supabaseCallbacks,
            supabaseCallback: nil,
            contentScheme: configuration.contentURLScheme
        )
        let organizationOwnershipCache = OrganizationOwnershipCache()
        let organizationOwnershipRepository =
            WorkerOrganizationOwnershipRepository(
                client: clients.protectedClient,
                publicOrganizations:
                    publicShellDependencies.organizations,
                logger: NoopOrganizationOwnershipLogSink()
            )
        organizationAdminModel = OrganizationAdminViewModel(
            repository: organizationOwnershipRepository,
            cache: organizationOwnershipCache,
            terminalAuthorizationHandler: {
                [weak authCoordinator] error in
                await authCoordinator?
                    .handleTerminalAuthorizationFailure(error)
            }
        )
        ownershipSessionController.attach(
            model: organizationAdminModel
        )
    }
}

private enum AppContainerError: Error {
    case cachesDirectoryUnavailable
    case campusBuildingsUnavailable
}

private struct UnavailableWorkerTransport: ClientTransport {
    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        throw APIError.unavailable
    }
}

private actor AppNavigatorProtectedNavigation:
    ProtectedNavigationClearing
{
    private let navigator: AppNavigator

    init(navigator: AppNavigator) {
        self.navigator = navigator
    }

    func clearProtectedNavigation() async {
        await navigator.clearProtectedPaths()
    }
}

private struct AppProtectedSessionInvalidator:
    ProtectedSessionInvalidating
{
    let base: any ProtectedSessionInvalidating
    let ownership: OrganizationOwnershipSessionController
    let board: BoardSessionLifecycle
    let media: OrganizationMediaSceneLifecycle?

    func activate(userID: UUID) async {
        await board.activate(userID: userID)
        await media?.activate(userID: userID)
        await base.activate(userID: userID)
    }

    func invalidate(reason: SensitiveCachePurgeReason) async {
        await media?.invalidate(reason: reason)
        await ownership.purge(reason: reason)
        await board.purge(reason: reason)
        await base.invalidate(reason: reason)
    }
}

private struct NoopOrganizationOwnershipLogSink:
    OrganizationOwnershipLogSink
{
    func record(_ event: OrganizationOwnershipLogEvent) async {}
}
