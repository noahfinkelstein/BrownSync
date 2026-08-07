import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

@testable import BrownSync

final class BearerAuthMiddlewareTests: XCTestCase {
    func testMiddlewareInjectsTheCurrentSupabaseBearerToken() async throws {
        let source = MiddlewareTokenSource(token: "first")
        let middleware = BearerAuthMiddleware(tokenProvider: source)
        let recorder = MiddlewareRequestRecorder()

        _ = try await middleware.intercept(
            HTTPRequest(
                method: .get,
                scheme: "https",
                authority: "api.brownsync.invalid",
                path: "/api/me"
            ),
            body: nil,
            baseURL: URL(string: "https://api.brownsync.invalid")!,
            operationID: "getApiMe"
        ) { request, _, _ in
            await recorder.record(request)
            return (HTTPResponse(status: .ok), nil)
        }
        await source.setToken("refreshed")
        _ = try await middleware.intercept(
            HTTPRequest(
                method: .get,
                scheme: "https",
                authority: "api.brownsync.invalid",
                path: "/api/me"
            ),
            body: nil,
            baseURL: URL(string: "https://api.brownsync.invalid")!,
            operationID: "getApiMe"
        ) { request, _, _ in
            await recorder.record(request)
            return (HTTPResponse(status: .ok), nil)
        }

        let authorizationValues = await recorder.authorizationValues()
        XCTAssertEqual(authorizationValues, ["Bearer first", "Bearer refreshed"])
    }
}

private actor MiddlewareTokenSource: AccessTokenProviding {
    private var token: String
    init(token: String) { self.token = token }
    func setToken(_ token: String) { self.token = token }
    func accessToken() async throws -> String { token }
}

private actor MiddlewareRequestRecorder {
    private var requests: [HTTPRequest] = []
    func record(_ request: HTTPRequest) { requests.append(request) }
    func authorizationValues() -> [String] {
        requests.compactMap { $0.headerFields[.authorization] }
    }
}
