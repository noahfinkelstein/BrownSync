import XCTest
@testable import BrownSync

final class DesignTokensTests: XCTestCase {
    func testGeneratedTokensExposeTheSharedDesignContract() {
        XCTAssertEqual(Tokens.Bg.base, "#FFFFFF")
        XCTAssertEqual(Tokens.accent, "#C00404")
        XCTAssertEqual(Tokens.TypeTokens.scale, [12, 14, 16, 19, 24, 30])
        XCTAssertEqual(Tokens.TypeTokens.body, 14)
        XCTAssertEqual(
            Tokens.TypeTokens.lineHeights,
            [12: 16, 14: 20, 16: 22, 19: 26, 24: 30, 30: 36]
        )
        XCTAssertEqual(
            Tokens.TypeTokens.display,
            "\"Instrument Sans\", system-ui, sans-serif"
        )
        XCTAssertEqual(
            Tokens.TypeTokens.mono,
            "\"IBM Plex Mono\", ui-monospace, monospace"
        )
        XCTAssertEqual(Tokens.Motion.minMs, 120)
        XCTAssertEqual(Tokens.Motion.maxMs, 160)
    }
}
