import Combine
import Foundation

@MainActor
final class AppNavigator: ObservableObject {
    @Published var selectedTab: AppTab = .map
    @Published var mapPath: [AppRoute] = []
    @Published var feedPath: [AppRoute] = []
    @Published var searchPath: [AppRoute] = []
    @Published var friendsPath: [AppRoute] = []
    @Published var mePath: [AppRoute] = []

    func push(_ route: AppRoute, in tab: AppTab) {
        switch tab {
        case .map:
            mapPath.append(route)
        case .feed:
            feedPath.append(route)
        case .search:
            searchPath.append(route)
        case .friends:
            friendsPath.append(route)
        case .me:
            mePath.append(route)
        }
    }

    @discardableResult
    func route(
        _ route: AppRoute,
        in tab: AppTab,
        access: AppAccess
    ) -> AppRoutingResult {
        if route.requiresAuthentication {
            guard access == .admitted else {
                return .authenticationRequired(.me)
            }
            guard tab == .me else {
                return .ignored
            }
        }
        push(route, in: tab)
        return .routed
    }

    @discardableResult
    func select(
        _ tab: AppTab,
        access: AppAccess
    ) -> AppRoutingResult {
        guard !tab.requiresAuthentication || access == .admitted else {
            return .authenticationRequired(tab)
        }
        selectedTab = tab
        return .routed
    }

    @discardableResult
    func handle(
        _ result: DeepLinkHandlingResult,
        access: AppAccess
    ) -> AppRoutingResult {
        switch result {
        case let .route(destination):
            return route(
                AppRoute(destination),
                in: selectedTab,
                access: access
            )
        case .handledCallback, .rejected:
            return .ignored
        }
    }

    func clearProtectedPaths() {
        mapPath.removeAll(where: \.requiresAuthentication)
        feedPath.removeAll(where: \.requiresAuthentication)
        searchPath.removeAll(where: \.requiresAuthentication)
        friendsPath.removeAll()
        mePath.removeAll()
        if selectedTab.requiresAuthentication {
            selectedTab = .map
        }
    }
}
