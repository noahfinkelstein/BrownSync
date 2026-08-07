import Foundation
import XCTest

@testable import BrownSync

final class PresenceShareDurationOptionREDTests: XCTestCase {
    func testOptionsExposeStableOrderLocalizedLabelsAndIdentifiers() {
        let options = PresenceShareDurationOption.allCases

        XCTAssertEqual(
            options,
            [.fourHours, .twelveHours, .untilLocalMidnight, .sevenDays]
        )
        XCTAssertEqual(
            options.map(\.localizedLabel),
            ["4 hours", "12 hours", "Until midnight", "7 days"]
        )
        XCTAssertEqual(
            options.map(\.localizedAccessibilityLabel),
            [
                "Share presence for 4 hours",
                "Share presence for 12 hours",
                "Share presence until local midnight",
                "Share presence for 7 days",
            ]
        )
        XCTAssertEqual(
            options.map(\.id),
            [
                "presence-share-duration-four-hours",
                "presence-share-duration-twelve-hours",
                "presence-share-duration-until-midnight",
                "presence-share-duration-seven-days",
            ]
        )
    }

    func testFixedDurationOptionsUseExactElapsedSecondsAcrossDST() {
        let start = instant("2026-03-07T17:00:00Z")
        let calendar = newYorkCalendar()

        XCTAssertEqual(
            PresenceShareDurationOption.fourHours
                .expiry(from: start, calendar: calendar)
                .timeIntervalSince(start),
            14_400,
            accuracy: 0.001
        )
        XCTAssertEqual(
            PresenceShareDurationOption.twelveHours
                .expiry(from: start, calendar: calendar)
                .timeIntervalSince(start),
            43_200,
            accuracy: 0.001
        )
        XCTAssertEqual(
            PresenceShareDurationOption.sevenDays
                .expiry(from: start, calendar: calendar)
                .timeIntervalSince(start),
            604_800,
            accuracy: 0.001
        )
    }

    func testUntilLocalMidnightUsesSpringForwardDayBoundary() {
        let start = instant("2026-03-08T05:30:00Z")

        let expiry = PresenceShareDurationOption.untilLocalMidnight.expiry(
            from: start,
            calendar: newYorkCalendar()
        )

        XCTAssertEqual(expiry, instant("2026-03-09T04:00:00Z"))
        XCTAssertEqual(
            expiry.timeIntervalSince(start),
            22.5 * 60 * 60,
            accuracy: 0.001
        )
    }

    func testUntilLocalMidnightUsesFallBackDayBoundary() {
        let start = instant("2026-11-01T04:30:00Z")

        let expiry = PresenceShareDurationOption.untilLocalMidnight.expiry(
            from: start,
            calendar: newYorkCalendar()
        )

        XCTAssertEqual(expiry, instant("2026-11-02T05:00:00Z"))
        XCTAssertEqual(
            expiry.timeIntervalSince(start),
            24.5 * 60 * 60,
            accuracy: 0.001
        )
    }

    func testUntilLocalMidnightUsesTheSuppliedCalendarTimeZone() {
        let start = instant("2026-01-15T20:00:00Z")
        var losAngeles = Calendar(identifier: .gregorian)
        losAngeles.timeZone = TimeZone(
            identifier: "America/Los_Angeles"
        )!

        let newYorkExpiry =
            PresenceShareDurationOption.untilLocalMidnight.expiry(
                from: start,
                calendar: newYorkCalendar()
            )
        let losAngelesExpiry =
            PresenceShareDurationOption.untilLocalMidnight.expiry(
                from: start,
                calendar: losAngeles
            )

        XCTAssertEqual(newYorkExpiry, instant("2026-01-16T05:00:00Z"))
        XCTAssertEqual(losAngelesExpiry, instant("2026-01-16T08:00:00Z"))
    }

    private func newYorkCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func instant(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)!
    }
}
