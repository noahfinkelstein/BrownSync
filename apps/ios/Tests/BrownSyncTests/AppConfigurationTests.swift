import Foundation
import XCTest

@testable import BrownSync

final class AppConfigurationTests: XCTestCase {
    func testDebugAcceptsHTTPSOriginsAndLocalhostHTTP() throws {
        let productionLike = try AppConfiguration(
            info: validInfo(),
            environment: .debug
        )
        XCTAssertEqual(
            productionLike.apiBaseURL,
            URL(string: "https://api.brownsync.invalid")
        )
        XCTAssertEqual(
            productionLike.supabaseURL,
            URL(string: "https://project.supabase.co")
        )

        var local = validInfo()
        local["BROWNSYNC_API_BASE_URL"] = "http://localhost:8787"
        local["BROWNSYNC_SUPABASE_URL"] = "http://127.0.0.1:54321"
        let localConfiguration = try AppConfiguration(
            info: local,
            environment: .debug
        )
        XCTAssertEqual(localConfiguration.apiBaseURL.port, 8787)
        XCTAssertEqual(localConfiguration.supabaseURL.port, 54321)
    }

    func testReleaseAcceptsOnlyCompleteValidConfiguration() throws {
        let configuration = try AppConfiguration(
            info: validInfo(),
            environment: .release
        )

        XCTAssertEqual(configuration.supabasePublishableKey, "sb_publishable_test-value")
        XCTAssertEqual(
            configuration.googleIOSClientID,
            "123456789-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com"
        )
        XCTAssertEqual(
            configuration.googleServerClientID,
            "987654321-zyxwvutsrqponmlkjihgfedcba.apps.googleusercontent.com"
        )
        XCTAssertEqual(
            configuration.googleReversedClientID,
            "com.googleusercontent.apps.123456789-abcdefghijklmnopqrstuvwxyz"
        )
    }

    func testReleaseRejectsMissingEmptyAndUnresolvedValues() {
        for invalidValue in [nil, "", "   ", "$(BROWNSYNC_API_BASE_URL)"] {
            var info = validInfo()
            info["BROWNSYNC_API_BASE_URL"] = invalidValue

            XCTAssertThrowsError(
                try AppConfiguration(info: info, environment: .release),
                "Release accepted \(String(describing: invalidValue))"
            )
        }
    }

    func testReleaseRejectsInsecureMalformedAndCredentialBearingOrigins() {
        let invalidOrigins = [
            "http://api.brownsync.invalid",
            "https://user:password@api.brownsync.invalid",
            "https://api.brownsync.invalid/v1",
            "https://api.brownsync.invalid?token=value",
            "not a URL",
        ]

        for origin in invalidOrigins {
            var info = validInfo()
            info["BROWNSYNC_API_BASE_URL"] = origin

            XCTAssertThrowsError(
                try AppConfiguration(info: info, environment: .release),
                "Release accepted \(origin)"
            )
        }
    }

    func testReleaseRejectsMalformedGoogleClientIdentifiers() {
        let mutations = [
            ("BROWNSYNC_GOOGLE_IOS_CLIENT_ID", "ios-client"),
            ("BROWNSYNC_GOOGLE_SERVER_CLIENT_ID", "server-client.example.com"),
            ("BROWNSYNC_GOOGLE_REVERSED_CLIENT_ID", "123.apps.googleusercontent.com"),
        ]

        for (key, value) in mutations {
            var info = validInfo()
            info[key] = value

            XCTAssertThrowsError(
                try AppConfiguration(info: info, environment: .release),
                "Release accepted malformed \(key)"
            )
        }
    }

    func testConfigurationFilesDoNotExposeServerSecrets() throws {
        let iosRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let paths = [
            "Configuration/Base.xcconfig",
            "Configuration/Debug.xcconfig",
            "Configuration/Release.xcconfig",
            "Configuration/CI.xcconfig",
            "Configuration/Local.example.xcconfig",
            "Sources/BrownSync/Info.plist",
        ]
        let forbiddenKeys = [
            "SUPABASE_SERVICE_ROLE",
            "GOOGLE_CLIENT_SECRET",
            "BOARD_AUTHOR_PEPPER",
            "META_TOKEN",
            "DATABASE_URL",
            "HYPERDRIVE",
        ]

        for path in paths {
            let contents = try String(
                contentsOf: iosRoot.appendingPathComponent(path),
                encoding: .utf8
            )
            for forbiddenKey in forbiddenKeys {
                XCTAssertFalse(
                    contents.localizedCaseInsensitiveContains(forbiddenKey),
                    "\(path) exposes forbidden key \(forbiddenKey)"
                )
            }
        }
    }

    private func validInfo() -> [String: Any] {
        [
            "BROWNSYNC_API_BASE_URL": "https://api.brownsync.invalid",
            "BROWNSYNC_SUPABASE_URL": "https://project.supabase.co",
            "BROWNSYNC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test-value",
            "BROWNSYNC_GOOGLE_IOS_CLIENT_ID":
                "123456789-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
            "BROWNSYNC_GOOGLE_SERVER_CLIENT_ID":
                "987654321-zyxwvutsrqponmlkjihgfedcba.apps.googleusercontent.com",
            "BROWNSYNC_GOOGLE_REVERSED_CLIENT_ID":
                "com.googleusercontent.apps.123456789-abcdefghijklmnopqrstuvwxyz",
        ]
    }
}
