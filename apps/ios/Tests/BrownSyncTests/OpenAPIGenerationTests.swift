import BrownSyncAPI
import XCTest

final class OpenAPIGenerationTests: XCTestCase {
    func testNamedEventSchemaIsGenerated() {
        let generatedType: Components.Schemas.Event.Type = Components.Schemas.Event.self
        XCTAssertTrue(generatedType == Components.Schemas.Event.self)
    }
}
