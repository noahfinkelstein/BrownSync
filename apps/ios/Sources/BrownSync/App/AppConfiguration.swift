import Foundation

struct AppConfiguration: Equatable, Sendable {
    enum Environment: String, Sendable {
        case debug
        case release
        case ci
    }

    enum ConfigurationError: Error, Equatable, LocalizedError {
        case missing(String)
        case unresolved(String)
        case invalidOrigin(String)
        case insecureOrigin(String)
        case invalidClientIdentifier(String)

        var errorDescription: String? {
            switch self {
            case let .missing(key):
                return "Required app configuration is missing: \(key)"
            case let .unresolved(key):
                return "App configuration was not resolved: \(key)"
            case let .invalidOrigin(key):
                return "App configuration contains an invalid origin: \(key)"
            case let .insecureOrigin(key):
                return "App configuration requires a secure origin: \(key)"
            case let .invalidClientIdentifier(key):
                return "App configuration contains an invalid client identifier: \(key)"
            }
        }
    }

    let apiBaseURL: URL
    let supabaseURL: URL
    let supabasePublishableKey: String
    let googleIOSClientID: String
    let googleServerClientID: String
    let googleReversedClientID: String
    let contentURLScheme: String

    init(
        info: [String: Any],
        environment: Environment
    ) throws {
        let apiOrigin = try Self.requiredString(
            "BROWNSYNC_API_BASE_URL",
            in: info
        )
        let supabaseOrigin = try Self.requiredString(
            "BROWNSYNC_SUPABASE_URL",
            in: info
        )
        apiBaseURL = try Self.origin(
            apiOrigin,
            key: "BROWNSYNC_API_BASE_URL",
            environment: environment
        )
        supabaseURL = try Self.origin(
            supabaseOrigin,
            key: "BROWNSYNC_SUPABASE_URL",
            environment: environment
        )
        supabasePublishableKey = try Self.requiredString(
            "BROWNSYNC_SUPABASE_PUBLISHABLE_KEY",
            in: info
        )
        googleIOSClientID = try Self.googleClientID(
            key: "BROWNSYNC_GOOGLE_IOS_CLIENT_ID",
            info: info
        )
        googleServerClientID = try Self.googleClientID(
            key: "BROWNSYNC_GOOGLE_SERVER_CLIENT_ID",
            info: info
        )
        googleReversedClientID = try Self.reversedGoogleClientID(
            key: "BROWNSYNC_GOOGLE_REVERSED_CLIENT_ID",
            info: info,
            matching: googleIOSClientID
        )
        contentURLScheme = Self.optionalString(
            "BROWNSYNC_CONTENT_URL_SCHEME",
            in: info
        ) ?? "brownsync"
    }

    init(bundle: Bundle = .main) throws {
        let info = bundle.infoDictionary ?? [:]
        let rawEnvironment = Self.optionalString(
            "BROWNSYNC_BUILD_ENVIRONMENT",
            in: info
        )
        #if DEBUG
        let fallbackEnvironment: Environment = .debug
        #else
        let fallbackEnvironment: Environment = .release
        #endif
        let environment = rawEnvironment.flatMap(Environment.init(rawValue:))
            ?? fallbackEnvironment
        try self.init(info: info, environment: environment)
    }

    private static func requiredString(
        _ key: String,
        in info: [String: Any]
    ) throws -> String {
        guard let value = info[key] as? String else {
            throw ConfigurationError.missing(key)
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw ConfigurationError.missing(key)
        }
        guard !trimmed.contains("$("), !trimmed.contains("${") else {
            throw ConfigurationError.unresolved(key)
        }
        return trimmed
    }

    private static func optionalString(
        _ key: String,
        in info: [String: Any]
    ) -> String? {
        guard let value = info[key] as? String else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func origin(
        _ value: String,
        key: String,
        environment: Environment
    ) throws -> URL {
        guard
            let components = URLComponents(string: value),
            let scheme = components.scheme?.lowercased(),
            let host = components.host?.lowercased(),
            !host.isEmpty,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            components.path.isEmpty || components.path == "/",
            let url = components.url
        else {
            throw ConfigurationError.invalidOrigin(key)
        }

        let isLoopback = host == "localhost"
            || host == "127.0.0.1"
            || host == "::1"
        let permitsLocalHTTP = environment == .debug
            && scheme == "http"
            && isLoopback
        guard scheme == "https" || permitsLocalHTTP else {
            throw ConfigurationError.insecureOrigin(key)
        }
        return url
    }

    private static func googleClientID(
        key: String,
        info: [String: Any]
    ) throws -> String {
        let value = try requiredString(key, in: info)
        let suffix = ".apps.googleusercontent.com"
        guard value.hasSuffix(suffix) else {
            throw ConfigurationError.invalidClientIdentifier(key)
        }
        let prefix = String(value.dropLast(suffix.count))
        let allowed = CharacterSet.alphanumerics.union(
            CharacterSet(charactersIn: "-")
        )
        guard
            !prefix.isEmpty,
            prefix.unicodeScalars.allSatisfy(allowed.contains),
            prefix.contains("-")
        else {
            throw ConfigurationError.invalidClientIdentifier(key)
        }
        return value
    }

    private static func reversedGoogleClientID(
        key: String,
        info: [String: Any],
        matching iosClientID: String
    ) throws -> String {
        let value = try requiredString(key, in: info)
        let suffix = ".apps.googleusercontent.com"
        let expected = "com.googleusercontent.apps."
            + iosClientID.dropLast(suffix.count)
        guard value == expected else {
            throw ConfigurationError.invalidClientIdentifier(key)
        }
        return value
    }
}
