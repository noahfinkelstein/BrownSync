import Foundation
import XCTest

final class IOSDependencyResolutionTests: XCTestCase {
    func testResolvedIdentityAndNetworkingPackagesMatchTheArchitectureBoundary() throws {
        let iosRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let resolvedURL = iosRoot
            .appendingPathComponent("BrownSync.xcodeproj")
            .appendingPathComponent("project.xcworkspace")
            .appendingPathComponent("xcshareddata/swiftpm/Package.resolved")
        let data = try Data(contentsOf: resolvedURL)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let pins = try XCTUnwrap(object["pins"] as? [[String: Any]])
        let versions = Dictionary(uniqueKeysWithValues: try pins.map { pin in
            let identity = try XCTUnwrap(pin["identity"] as? String)
            let state = try XCTUnwrap(pin["state"] as? [String: Any])
            return (identity, state["version"] as? String)
        })

        XCTAssertEqual(versions["googlesignin-ios"], "9.2.0")
        XCTAssertEqual(versions["supabase-swift"], "2.54.0")
        XCTAssertEqual(versions["maplibre-gl-native-distribution"], "6.28.0")
        XCTAssertEqual(versions["swift-openapi-generator"], "1.13.0")
        XCTAssertEqual(versions["swift-openapi-runtime"], "1.12.0")
        XCTAssertEqual(versions["swift-openapi-urlsession"], "1.3.1")
    }
}
