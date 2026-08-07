import Foundation

@MainActor
protocol SupabaseCallbackHandling: AnyObject {
    func establishSession(from url: URL) async throws
}

struct SupabaseAuthCallback: Equatable, Sendable {
    let scheme: String
    let host: String
}

enum DeepLinkDestination: Equatable, Sendable {
    case event(UUID)
    case place(String)
    case organization(String)
}

enum DeepLinkHandlingResult: Equatable, Sendable {
    case handledCallback
    case route(DeepLinkDestination)
    case rejected
}

@MainActor
final class DeepLinkCoordinator {
    private let googleCallbacks: any GoogleCallbackHandling
    private let supabaseCallbacks: any SupabaseCallbackHandling
    private let supabaseCallback: SupabaseAuthCallback?
    private let contentScheme: String

    init(
        googleCallbacks: any GoogleCallbackHandling,
        supabaseCallbacks: any SupabaseCallbackHandling,
        supabaseCallback: SupabaseAuthCallback?,
        contentScheme: String
    ) {
        self.googleCallbacks = googleCallbacks
        self.supabaseCallbacks = supabaseCallbacks
        self.supabaseCallback = supabaseCallback
        self.contentScheme = contentScheme.lowercased()
    }

    func handle(_ url: URL) async -> DeepLinkHandlingResult {
        if googleCallbacks.handle(url) {
            return .handledCallback
        }

        if let callback = supabaseCallback, Self.matches(url, callback) {
            do {
                try await supabaseCallbacks.establishSession(from: url)
                return .handledCallback
            } catch {
                return .rejected
            }
        }

        guard
            url.scheme?.lowercased() == contentScheme,
            url.user == nil,
            url.password == nil,
            url.port == nil,
            url.query == nil,
            url.fragment == nil,
            let host = url.host?.lowercased()
        else {
            return .rejected
        }

        guard let percentEncodedPath = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
        )?.percentEncodedPath else {
            return .rejected
        }
        let encodedComponents = percentEncodedPath
            .split(separator: "/", omittingEmptySubsequences: true)
        guard
            encodedComponents.count == 1,
            let value = encodedComponents.first?
                .removingPercentEncoding,
            !value.isEmpty,
            value != ".",
            value != "..",
            !value.contains("/"),
            !value.contains("\\")
        else {
            return .rejected
        }

        switch host {
        case "event":
            guard let id = UUID(uuidString: value) else {
                return .rejected
            }
            return .route(.event(id))
        case "place":
            return .route(.place(value))
        case "organization":
            return .route(.organization(value))
        default:
            return .rejected
        }
    }

    private static func matches(
        _ url: URL,
        _ callback: SupabaseAuthCallback
    ) -> Bool {
        url.scheme?.lowercased() == callback.scheme.lowercased()
            && url.host?.lowercased() == callback.host.lowercased()
            && url.user == nil
            && url.password == nil
            && url.port == nil
            && (url.path.isEmpty || url.path == "/")
    }
}
