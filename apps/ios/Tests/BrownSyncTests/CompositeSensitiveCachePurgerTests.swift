import XCTest

@testable import BrownSync

final class CompositeSensitiveCachePurgerTests: XCTestCase {
    func testPurgeAwaitsEveryCacheInDeclaredOrder() async {
        let log = CompositeCachePurgeLog()
        let purger = CompositeSensitiveCachePurger(
            caches: [
                CompositeCachePurgeFake(name: "social", log: log),
                CompositeCachePurgeFake(name: "organizations", log: log),
            ]
        )

        await purger.purge(reason: .authExpired)

        let entries = await log.entries()
        XCTAssertEqual(
            entries,
            [
                "social.authExpired",
                "organizations.authExpired",
            ]
        )
    }
}

private actor CompositeCachePurgeLog {
    private var values: [String] = []

    func append(_ value: String) {
        values.append(value)
    }

    func entries() -> [String] {
        values
    }
}

private actor CompositeCachePurgeFake: SensitiveCachePurging {
    private let name: String
    private let log: CompositeCachePurgeLog

    init(name: String, log: CompositeCachePurgeLog) {
        self.name = name
        self.log = log
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        await log.append("\(name).\(reason.testName)")
    }
}

private extension SensitiveCachePurgeReason {
    var testName: String {
        switch self {
        case .signedOut:
            "signedOut"
        case .authExpired:
            "authExpired"
        case .accountDeleted:
            "accountDeleted"
        case .shareRevoked:
            "shareRevoked"
        case .ghostEnabled:
            "ghostEnabled"
        case .presenceCleared:
            "presenceCleared"
        case .presenceExpired:
            "presenceExpired"
        case .sceneBackgrounded:
            "sceneBackgrounded"
        }
    }
}
