import XCTest
@testable import BrownSync

final class MapLoadStatusTests: XCTestCase {
    func testFullyRenderedDoesNotHideEarlierFailure() {
        let status = MapLoadStatus.failed("Campus data is invalid")

        XCTAssertEqual(
            status.acceptingFullyRendered(),
            .failed("Campus data is invalid")
        )
    }

    func testFullyRenderedAdvancesLoadingStateToReady() {
        XCTAssertEqual(
            MapLoadStatus.loading.acceptingFullyRendered(),
            .ready
        )
    }
}
