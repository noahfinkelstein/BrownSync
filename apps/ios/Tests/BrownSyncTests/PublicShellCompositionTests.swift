import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

@testable import BrownSync

final class PublicShellCompositionTests: XCTestCase {
    func testProductionFactoryExposesSharedCacheAndAllThreeGeneratedRepositories()
        async throws
    {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = CompositionTransport()
        let dependencies = PublicShellDependencies.production(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.brownsync.invalid")!,
                transport: transport
            ),
            cacheDirectory: directory,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        _ = try await dependencies.events.events(
            query: EventQuery(),
            policy: .reload
        )
        _ = try await dependencies.places.places(policy: .reload)
        _ = try await dependencies.organizations.organizations(
            policy: .reload
        )
        let cache: PublicResponseCache = dependencies.cache
        _ = cache

        let operations = await transport.operations()
        XCTAssertEqual(
            operations,
            ["get/api/events", "get/api/places", "get/api/orgs"]
        )
    }

    func testProductionDependenciesNeverSubstituteFixturesForAnEmptyOfflineCache()
        async
    {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let dependencies = PublicShellDependencies.production(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.brownsync.invalid")!,
                transport: OfflineCompositionTransport()
            ),
            cacheDirectory: directory,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        do {
            _ = try await dependencies.events.events(
                query: EventQuery(),
                policy: .reload
            )
            XCTFail("An empty offline cache returned synthetic content")
        } catch {
            XCTAssertEqual(
                (error as? URLError)?.code,
                .notConnectedToInternet
            )
        }
    }

    private func uniqueTemporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "brownsync-public-composition-tests-\(UUID().uuidString)",
                isDirectory: true
            )
    }
}

private actor CompositionTransport: ClientTransport {
    private var captured: [String] = []

    func operations() -> [String] {
        captured
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        captured.append(operationID)
        let json: String
        switch operationID {
        case "get/api/events":
            json = #"{"events":[]}"#
        case "get/api/places":
            json = #"{"places":[]}"#
        case "get/api/orgs":
            json = #"{"orgs":[]}"#
        default:
            throw CompositionTransportError.unexpectedOperation(
                operationID
            )
        }
        var fields = HTTPFields()
        fields[.contentType] = "application/json"
        return (
            HTTPResponse(status: .ok, headerFields: fields),
            HTTPBody(json)
        )
    }
}

private struct OfflineCompositionTransport: ClientTransport {
    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        throw URLError(.notConnectedToInternet)
    }
}

private enum CompositionTransportError: Error {
    case unexpectedOperation(String)
}
