import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class FeedAndMapViewModelTests: XCTestCase {
    func testFeedKeepsLiveEventsSeparateAndSortsChronologicalEvents()
        async
    {
        let late = phaseTwoEvent(
            id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
            title: "Late",
            start: Date(timeIntervalSince1970: 1_800_003_600)
        )
        let early = phaseTwoEvent(
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            title: "Early",
            start: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let live = phaseTwoEvent(
            id: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee",
            title: "Happening now",
            start: Date(timeIntervalSince1970: 1_799_999_000)
        )
        let repository = FeedEventRepositoryFake(
            events: [late, early],
            live: [live],
            source: .offline(isStale: true)
        )
        let model = FeedViewModel(events: repository)

        await model.load(policy: .reload)

        XCTAssertEqual(model.content?.live, [live])
        XCTAssertEqual(model.content?.chronological, [early, late])
        XCTAssertEqual(model.source, .offline(isStale: true))
        XCTAssertNil(model.errorMessage)
    }

    func testMapRequestsCampusBBoxAndExposesEveryVisibleEventAsAListItem()
        async
    {
        let first = phaseTwoEvent(
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            title: "First",
            start: Date(timeIntervalSince1970: 1_800_000_000),
            coordinate: EventCoordinate(
                latitude: 41.8268,
                longitude: -71.4025
            )
        )
        let second = phaseTwoEvent(
            id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
            title: "Second",
            start: Date(timeIntervalSince1970: 1_800_003_600)
        )
        let repository = MapEventRepositoryFake(events: [first, second])
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let model = MapScreenModel(events: repository, now: { now })

        await model.load()

        let queries = await repository.queries()
        XCTAssertEqual(
            queries,
            [
                EventQuery(
                    from: now,
                    to: now.addingTimeInterval(7 * 24 * 60 * 60),
                    boundingBox: "-71.43,41.81,-71.38,41.85"
                ),
            ]
        )
        XCTAssertEqual(
            model.accessibleItems.map(\.route),
            [.event(first.id), .event(second.id)]
        )
        XCTAssertEqual(
            model.accessibleItems.map(\.title),
            ["First", "Second"]
        )
        XCTAssertEqual(model.accessibleItems.count, model.events.count)
        XCTAssertEqual(
            model.mapMarkers,
            [
                MapEventMarker(
                    eventID: first.id,
                    title: "First",
                    coordinate: EventCoordinate(
                        latitude: 41.8268,
                        longitude: -71.4025
                    )
                ),
            ]
        )
        XCTAssertEqual(model.mapMarkers.first?.route, .event(first.id))
    }
}

private actor FeedEventRepositoryFake: EventRepository {
    private let listedEvents: [PublicEvent]
    private let liveEvents: [PublicEvent]
    private let resultSource: PublicDataSource

    init(
        events: [PublicEvent],
        live: [PublicEvent],
        source: PublicDataSource
    ) {
        listedEvents = events
        liveEvents = live
        resultSource = source
    }

    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        PublicResource(value: listedEvents, source: resultSource)
    }

    func now(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        PublicResource(value: liveEvents, source: resultSource)
    }

    func event(
        id: UUID,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicEventDetail> {
        PublicResource(
            value: PublicEventDetail(
                event: listedEvents[0],
                organization: nil
            ),
            source: resultSource
        )
    }
}

private actor MapEventRepositoryFake: EventRepository {
    private let listedEvents: [PublicEvent]
    private var capturedQueries: [EventQuery] = []

    init(events: [PublicEvent]) {
        listedEvents = events
    }

    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        capturedQueries.append(query)
        return PublicResource(value: listedEvents, source: .network)
    }

    func now(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        PublicResource(value: [], source: .network)
    }

    func event(
        id: UUID,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicEventDetail> {
        PublicResource(
            value: PublicEventDetail(
                event: listedEvents[0],
                organization: nil
            ),
            source: .network
        )
    }

    func queries() -> [EventQuery] {
        capturedQueries
    }
}

private func phaseTwoEvent(
    id: String,
    title: String,
    start: Date,
    coordinate: EventCoordinate? = nil
) -> PublicEvent {
    PublicEvent(
        id: UUID(uuidString: id)!,
        title: title,
        summary: nil,
        start: start,
        end: nil,
        allDay: false,
        coordinate: coordinate,
        placeID: nil,
        placeName: nil,
        organizationID: nil,
        organizationName: nil,
        category: "social",
        isCanceled: false
    )
}
