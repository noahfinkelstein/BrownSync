import XCTest

final class MapSmokeTests: XCTestCase {
    @MainActor
    func testBundledPMTilesMapFullyRenders() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()

        let ready = app.staticTexts["map-status-ready"]
        let failed = app.staticTexts["map-status-failed"]
        let rendered = ready.waitForExistence(timeout: 30)

        XCTAssertTrue(
            rendered,
            failed.exists ? failed.label : "Map did not reach a terminal state."
        )
        XCTAssertFalse(
            failed.exists,
            "Map failed: \(failed.label)"
        )
        XCTAssertEqual(ready.label, "Map ready")
    }
}
