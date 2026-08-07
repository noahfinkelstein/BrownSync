import Foundation

enum AppRoute: Hashable, Sendable {
    case event(UUID)
    case place(String)
    case organization(String)
    case organizationAdmin
    case board

    init(_ destination: DeepLinkDestination) {
        switch destination {
        case let .event(id):
            self = .event(id)
        case let .place(id):
            self = .place(id)
        case let .organization(id):
            self = .organization(id)
        }
    }

    var requiresAuthentication: Bool {
        switch self {
        case .organizationAdmin, .board:
            return true
        case .event, .place, .organization:
            return false
        }
    }
}

enum AppTab: String, CaseIterable, Hashable, Sendable {
    case map
    case feed
    case search
    case friends
    case me

    var requiresAuthentication: Bool {
        self == .friends || self == .me
    }
}

enum AppAccess: Equatable, Sendable {
    case signedOut
    case admitted
}

enum AppRoutingResult: Equatable, Sendable {
    case routed
    case authenticationRequired(AppTab)
    case ignored
}
