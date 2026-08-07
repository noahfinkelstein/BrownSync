import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class DeepLinkCoordinatorTests: XCTestCase {
    func testGoogleGetsFirstCallbackOwnershipAndStopsRouting() async {
        let google = GoogleCallbackFake(
            handledSchemes: ["com.googleusercontent.apps.123"]
        )
        let supabase = SupabaseCallbackFake()
        let coordinator = DeepLinkCoordinator(
            googleCallbacks: google,
            supabaseCallbacks: supabase,
            supabaseCallback: .init(
                scheme: "brownsync-auth",
                host: "callback"
            ),
            contentScheme: "brownsync"
        )
        let url = URL(
            string: "com.googleusercontent.apps.123:/oauth?code=value"
        )!

        let result = await coordinator.handle(url)

        XCTAssertEqual(result, .handledCallback)
        XCTAssertEqual(supabase.handledURLs, [])
    }

    func testSupabaseCallbackRequiresExactSchemeAndHost() async {
        let google = GoogleCallbackFake(handledSchemes: [])
        let supabase = SupabaseCallbackFake()
        let coordinator = DeepLinkCoordinator(
            googleCallbacks: google,
            supabaseCallbacks: supabase,
            supabaseCallback: .init(
                scheme: "brownsync-auth",
                host: "callback"
            ),
            contentScheme: "brownsync"
        )
        let exact = URL(string: "brownsync-auth://callback?code=value")!
        let hostile = URL(
            string: "brownsync-auth://evil.example/callback?code=value"
        )!

        let exactResult = await coordinator.handle(exact)
        let hostileResult = await coordinator.handle(hostile)
        XCTAssertEqual(exactResult, .handledCallback)
        XCTAssertEqual(hostileResult, .rejected)
        XCTAssertEqual(supabase.handledURLs, [exact])
    }

    func testContentLinksProduceTypedRoutes() async {
        let coordinator = DeepLinkCoordinator(
            googleCallbacks: GoogleCallbackFake(handledSchemes: []),
            supabaseCallbacks: SupabaseCallbackFake(),
            supabaseCallback: nil,
            contentScheme: "brownsync"
        )
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!

        let eventResult = await coordinator.handle(
            URL(string: "brownsync://event/\(eventID.uuidString)")!
        )
        let placeResult = await coordinator.handle(
            URL(string: "brownsync://place/campus-center")!
        )
        let organizationResult = await coordinator.handle(
            URL(string: "brownsync://organization/student-group")!
        )
        XCTAssertEqual(eventResult, .route(.event(eventID)))
        XCTAssertEqual(placeResult, .route(.place("campus-center")))
        XCTAssertEqual(
            organizationResult,
            .route(.organization("student-group"))
        )
    }

    func testUnknownTraversalMalformedAndAuthLookingURLsAreRejected() async {
        let coordinator = DeepLinkCoordinator(
            googleCallbacks: GoogleCallbackFake(handledSchemes: []),
            supabaseCallbacks: SupabaseCallbackFake(),
            supabaseCallback: .init(
                scheme: "brownsync-auth",
                host: "callback"
            ),
            contentScheme: "brownsync"
        )
        let hostileURLs = [
            "https://brownsync.invalid/event/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "brownsync://event/not-a-uuid",
            "brownsync://place/../secret",
            "brownsync://unknown/value",
            "brownsync-auth://callback.evil.example?code=value",
            "brownsync://auth/callback?access_token=value",
        ]

        for value in hostileURLs {
            let result = await coordinator.handle(URL(string: value)!)
            XCTAssertEqual(
                result,
                .rejected,
                value
            )
        }
    }
}

@MainActor
private final class GoogleCallbackFake: GoogleCallbackHandling {
    private let handledSchemes: Set<String>

    init(handledSchemes: Set<String>) {
        self.handledSchemes = handledSchemes
    }

    func handle(_ url: URL) -> Bool {
        guard let scheme = url.scheme else { return false }
        return handledSchemes.contains(scheme)
    }
}

@MainActor
private final class SupabaseCallbackFake: SupabaseCallbackHandling {
    private(set) var handledURLs: [URL] = []

    func establishSession(from url: URL) async throws {
        handledURLs.append(url)
    }
}
