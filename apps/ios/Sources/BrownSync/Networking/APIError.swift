import Foundation

enum APIError: Error, Equatable, Sendable {
    case unauthorized
    case brownMembershipRequired
    case recentAuthenticationRequired
    case forbidden(code: String)
    case rateLimited
    case unavailable
    case invalidResponse
    case server(status: Int, code: String?)

    static func normalized(status: Int, code: String?) -> APIError {
        switch (status, code) {
        case (401, _):
            return .unauthorized
        case (403, "brown_membership_required"):
            return .brownMembershipRequired
        case (403, "recent_authentication_required"):
            return .recentAuthenticationRequired
        case (403, let code?):
            return .forbidden(code: code)
        case (429, _):
            return .rateLimited
        case (503, _):
            return .unavailable
        default:
            return .server(status: status, code: code)
        }
    }
}
