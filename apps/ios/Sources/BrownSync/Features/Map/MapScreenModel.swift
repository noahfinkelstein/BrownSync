import Combine
import Foundation

struct AccessibleMapEvent: Equatable, Identifiable, Sendable {
    let route: AppRoute
    let title: String
    let start: Date
    let placeName: String?

    var id: AppRoute { route }
}

struct MapEventMarker: Equatable, Identifiable, Sendable {
    let eventID: UUID
    let title: String
    let coordinate: EventCoordinate

    var id: UUID { eventID }
    var route: AppRoute { .event(eventID) }
}

@MainActor
final class MapScreenModel: ObservableObject {
    static let campusBoundingBox = "-71.43,41.81,-71.38,41.85"

    @Published private(set) var events: [PublicEvent] = []
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isLoading = false

    private let repository: any EventRepository
    private let nowProvider: @Sendable () -> Date

    init(
        events: any EventRepository,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        repository = events
        nowProvider = now
    }

    var accessibleItems: [AccessibleMapEvent] {
        events.map {
            AccessibleMapEvent(
                route: .event($0.id),
                title: $0.title,
                start: $0.start,
                placeName: $0.placeName
            )
        }
    }

    var mapMarkers: [MapEventMarker] {
        events.compactMap { event in
            guard let coordinate = event.coordinate else { return nil }
            return MapEventMarker(
                eventID: event.id,
                title: event.title,
                coordinate: coordinate
            )
        }
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        isLoading = true
        errorMessage = nil
        let now = nowProvider()
        do {
            let loaded = try await repository.events(
                query: EventQuery(
                    from: now,
                    to: now.addingTimeInterval(7 * 24 * 60 * 60),
                    boundingBox: Self.campusBoundingBox
                ),
                policy: policy
            )
            events = loaded.value.sorted {
                if $0.start != $1.start {
                    return $0.start < $1.start
                }
                return $0.title.localizedStandardCompare($1.title)
                    == .orderedAscending
            }
            source = loaded.source
            isLoading = false
        } catch is CancellationError {
            isLoading = false
        } catch {
            isLoading = false
            errorMessage = "Campus events are temporarily unavailable."
        }
    }
}
