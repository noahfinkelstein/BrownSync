import Foundation

enum PresenceShareDurationOption:
    CaseIterable,
    Equatable,
    Hashable,
    Identifiable,
    Sendable
{
    case fourHours
    case twelveHours
    case untilLocalMidnight
    case sevenDays

    var id: String {
        switch self {
        case .fourHours:
            return "presence-share-duration-four-hours"
        case .twelveHours:
            return "presence-share-duration-twelve-hours"
        case .untilLocalMidnight:
            return "presence-share-duration-until-midnight"
        case .sevenDays:
            return "presence-share-duration-seven-days"
        }
    }

    var localizedLabel: String {
        switch self {
        case .fourHours:
            return String(
                localized: "4 hours",
                comment: "A presence-sharing duration option."
            )
        case .twelveHours:
            return String(
                localized: "12 hours",
                comment: "A presence-sharing duration option."
            )
        case .untilLocalMidnight:
            return String(
                localized: "Until midnight",
                comment: "A presence-sharing duration option."
            )
        case .sevenDays:
            return String(
                localized: "7 days",
                comment: "A presence-sharing duration option."
            )
        }
    }

    var localizedAccessibilityLabel: String {
        switch self {
        case .fourHours:
            return String(
                localized: "Share presence for 4 hours",
                comment: "An accessible presence-sharing duration label."
            )
        case .twelveHours:
            return String(
                localized: "Share presence for 12 hours",
                comment: "An accessible presence-sharing duration label."
            )
        case .untilLocalMidnight:
            return String(
                localized: "Share presence until local midnight",
                comment: "An accessible presence-sharing duration label."
            )
        case .sevenDays:
            return String(
                localized: "Share presence for 7 days",
                comment: "An accessible presence-sharing duration label."
            )
        }
    }

    func expiry(from start: Date, calendar: Calendar) -> Date {
        switch self {
        case .fourHours:
            return start.addingTimeInterval(4 * 60 * 60)
        case .twelveHours:
            return start.addingTimeInterval(12 * 60 * 60)
        case .sevenDays:
            return start.addingTimeInterval(7 * 24 * 60 * 60)
        case .untilLocalMidnight:
            guard
                let localDay = calendar.dateInterval(
                    of: .day,
                    for: start
                )
            else {
                preconditionFailure(
                    "The supplied calendar cannot resolve a local day."
                )
            }
            return localDay.end
        }
    }
}
