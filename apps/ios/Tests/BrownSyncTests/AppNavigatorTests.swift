import XCTest

@testable import BrownSync

@MainActor
final class AppNavigatorTests: XCTestCase {
    func testTabsKeepIndependentTypedNavigationPaths() {
        let navigator = AppNavigator()
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!

        navigator.push(.event(eventID), in: .map)
        navigator.push(.organization("student-activities"), in: .feed)
        navigator.push(.place("sciences-library"), in: .search)

        XCTAssertEqual(navigator.mapPath, [.event(eventID)])
        XCTAssertEqual(
            navigator.feedPath,
            [.organization("student-activities")]
        )
        XCTAssertEqual(
            navigator.searchPath,
            [.place("sciences-library")]
        )
        XCTAssertEqual(navigator.friendsPath, [])
        XCTAssertEqual(navigator.mePath, [])
    }

    func testSignedOutUsersCanRouteToEveryPublicDetail() {
        let navigator = AppNavigator()
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!

        XCTAssertEqual(
            navigator.route(.event(eventID), in: .map, access: .signedOut),
            .routed
        )
        XCTAssertEqual(
            navigator.route(
                .place("campus-center"),
                in: .feed,
                access: .signedOut
            ),
            .routed
        )
        XCTAssertEqual(
            navigator.route(
                .organization("student-group"),
                in: .search,
                access: .signedOut
            ),
            .routed
        )
    }

    func testContentDeepLinkResultRoutesIntoTheSelectedPublicStack() {
        let navigator = AppNavigator()
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!
        _ = navigator.select(.search, access: .signedOut)

        XCTAssertEqual(
            navigator.handle(
                .route(.event(eventID)),
                access: .signedOut
            ),
            .routed
        )
        XCTAssertEqual(navigator.searchPath, [.event(eventID)])

        XCTAssertEqual(
            navigator.handle(.handledCallback, access: .signedOut),
            .ignored
        )
        XCTAssertEqual(
            navigator.handle(.rejected, access: .signedOut),
            .ignored
        )
        XCTAssertEqual(navigator.searchPath, [.event(eventID)])
    }

    func testSignedOutProtectedTabsGateWithoutDestroyingPublicPaths() {
        let navigator = AppNavigator()
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!
        navigator.push(.event(eventID), in: .map)

        XCTAssertEqual(
            navigator.select(.friends, access: .signedOut),
            .authenticationRequired(.friends)
        )
        XCTAssertEqual(navigator.selectedTab, .map)
        XCTAssertEqual(navigator.mapPath, [.event(eventID)])

        XCTAssertEqual(
            navigator.select(.me, access: .signedOut),
            .authenticationRequired(.me)
        )
        XCTAssertEqual(navigator.selectedTab, .map)
        XCTAssertEqual(navigator.mapPath, [.event(eventID)])
    }

    func testSignedOutOrganizationAdminRouteGatesBeforePathMutation() {
        let navigator = AppNavigator()

        XCTAssertEqual(
            navigator.route(
                .organizationAdmin,
                in: .me,
                access: .signedOut
            ),
            .authenticationRequired(.me)
        )
        XCTAssertTrue(navigator.mePath.isEmpty)
    }

    func testAdmittedOrganizationAdminRouteUsesProtectedMeStack() {
        let navigator = AppNavigator()

        XCTAssertEqual(
            navigator.route(
                .organizationAdmin,
                in: .me,
                access: .admitted
            ),
            .routed
        )
        XCTAssertEqual(navigator.mePath, [.organizationAdmin])
    }

    func testAdmittedOrganizationAdminRouteCannotEnterPublicStack() {
        let navigator = AppNavigator()

        XCTAssertEqual(
            navigator.route(
                .organizationAdmin,
                in: .map,
                access: .admitted
            ),
            .ignored
        )
        XCTAssertTrue(navigator.mapPath.isEmpty)
    }

    func testSignOutClearsOnlyProtectedTabPaths() {
        let navigator = AppNavigator()
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!
        navigator.push(.event(eventID), in: .map)
        navigator.push(.organizationAdmin, in: .map)
        navigator.push(.organizationAdmin, in: .feed)
        navigator.push(.organizationAdmin, in: .search)
        navigator.push(.place("campus-center"), in: .friends)
        navigator.push(.organization("student-group"), in: .me)

        navigator.clearProtectedPaths()

        XCTAssertEqual(navigator.mapPath, [.event(eventID)])
        XCTAssertEqual(navigator.feedPath, [])
        XCTAssertEqual(navigator.searchPath, [])
        XCTAssertEqual(navigator.friendsPath, [])
        XCTAssertEqual(navigator.mePath, [])
    }
}
