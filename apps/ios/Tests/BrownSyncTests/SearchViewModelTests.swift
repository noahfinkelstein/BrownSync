import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class SearchViewModelTests: XCTestCase {
    func testNewQueryCancelsThePendingDebounceBeforeRequestingEvents()
        async
    {
        let debouncer = ManualSearchDebouncer()
        let events = SearchEventRepositoryFake()
        let model = SearchViewModel(
            events: events,
            places: SearchPlaceRepositoryFake(),
            organizations: SearchOrganizationRepositoryFake(),
            debouncer: debouncer
        )

        model.updateQuery("first")
        await waitUntil {
            await debouncer.waiterCount() == 1
        }
        model.updateQuery("second")
        await waitUntil {
            let cancellations = await debouncer.cancellationCount()
            let waiters = await debouncer.waiterCount()
            return cancellations == 1 && waiters == 1
        }
        await debouncer.releaseAll()
        await waitUntil {
            model.results.first?.title == "Result for second"
        }

        let queries = await events.queries()
        XCTAssertEqual(queries, ["second"])
        XCTAssertEqual(model.results.map(\.title), ["Result for second"])
    }

    func testLocalPlaceAndOrganizationSearchNormalizesCasePunctuationAndDiacritics() {
        let place = PublicPlace(
            id: "sciences-library",
            name: "Sciences Library",
            aliases: ["Sci-Li"],
            kind: "library",
            address: "201 Thayer Street",
            latitude: 41.826,
            longitude: -71.4
        )
        let organization = PublicOrganization(
            id: "cafe-collective",
            name: "Café Collective",
            kind: "club",
            category: "social",
            summary: "Coffee and community."
        )

        let placeResults = PublicSearchIndex.merge(
            query: "  SCI—LI ",
            events: [],
            places: [place],
            organizations: [organization]
        )
        let organizationResults = PublicSearchIndex.merge(
            query: "cafe\u{301} collective",
            events: [],
            places: [place],
            organizations: [organization]
        )

        XCTAssertEqual(placeResults, [.place(place)])
        XCTAssertEqual(
            organizationResults,
            [.organization(organization)]
        )
    }

    func testMergeRanksResultsWithoutErasingTheirSourceType() {
        let event = makeEvent(
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            title: "Brown"
        )
        let place = PublicPlace(
            id: "brown-street-park",
            name: "Brown Street Park",
            aliases: [],
            kind: "outdoor",
            address: nil,
            latitude: 41.83,
            longitude: -71.4
        )
        let organization = PublicOrganization(
            id: "brown-outing-club",
            name: "Brown Outing Club",
            kind: "club",
            category: "social",
            summary: nil
        )

        let results = PublicSearchIndex.merge(
            query: "brown",
            events: [event],
            places: [place],
            organizations: [organization]
        )

        XCTAssertEqual(
            results,
            [
                .event(event),
                .organization(organization),
                .place(place),
            ]
        )
        XCTAssertEqual(
            results.map(\.kind),
            [.event, .organization, .place]
        )
    }

    func testOfflineEventFailureKeepsCachedPlaceAndOrganizationResults()
        async
    {
        let debouncer = ManualSearchDebouncer()
        let place = PublicPlace(
            id: "brown-street-park",
            name: "Brown Street Park",
            aliases: [],
            kind: "outdoor",
            address: nil,
            latitude: 41.83,
            longitude: -71.4
        )
        let organization = PublicOrganization(
            id: "brown-outing-club",
            name: "Brown Outing Club",
            kind: "club",
            category: "social",
            summary: nil
        )
        let model = SearchViewModel(
            events: OfflineSearchEventRepositoryFake(),
            places: CachedSearchPlaceRepositoryFake(place: place),
            organizations: CachedSearchOrganizationRepositoryFake(
                organization: organization
            ),
            debouncer: debouncer
        )

        model.updateQuery("brown")
        await waitUntil {
            await debouncer.waiterCount() == 1
        }
        await debouncer.releaseAll()
        await waitUntil {
            model.results.count == 2
        }

        XCTAssertEqual(
            model.results,
            [.organization(organization), .place(place)]
        )
        XCTAssertEqual(model.source, .offline(isStale: true))
        XCTAssertNil(model.errorMessage)
    }

    func testNonConnectivityFailureKeepsPartialResultsWithoutClaimingOffline()
        async
    {
        let debouncer = ManualSearchDebouncer()
        let place = PublicPlace(
            id: "brown-street-park",
            name: "Brown Street Park",
            aliases: [],
            kind: "outdoor",
            address: nil,
            latitude: 41.83,
            longitude: -71.4
        )
        let organization = PublicOrganization(
            id: "brown-outing-club",
            name: "Brown Outing Club",
            kind: "club",
            category: "social",
            summary: nil
        )
        let model = SearchViewModel(
            events: FailedSearchEventRepositoryFake(),
            places: CachedSearchPlaceRepositoryFake(place: place),
            organizations: CachedSearchOrganizationRepositoryFake(
                organization: organization
            ),
            debouncer: debouncer
        )

        model.updateQuery("brown")
        await waitUntil {
            await debouncer.waiterCount() == 1
        }
        await debouncer.releaseAll()
        await waitUntil {
            model.results.count == 2
        }

        XCTAssertEqual(
            model.results,
            [.organization(organization), .place(place)]
        )
        XCTAssertEqual(model.source, .cache)
        XCTAssertEqual(
            model.partialResultsMessage,
            "Some search results are temporarily unavailable."
        )
        XCTAssertNil(model.errorMessage)
    }

    private func waitUntil(
        _ predicate: @MainActor () async -> Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<1_000 {
            if await predicate() {
                return
            }
            await Task.yield()
        }
        XCTFail("Condition was not reached", file: file, line: line)
    }
}

private actor SearchEventRepositoryFake: EventRepository {
    private var capturedQueries: [String] = []

    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        let text = query.text ?? ""
        capturedQueries.append(text)
        return PublicResource(
            value: [
                makeEvent(
                    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    title: "Result for \(text)"
                ),
            ],
            source: .network
        )
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
            value: PublicEventDetail(event: makeEvent(), organization: nil),
            source: .network
        )
    }

    func queries() -> [String] {
        capturedQueries
    }
}

private actor OfflineSearchEventRepositoryFake: EventRepository {
    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        throw URLError(.notConnectedToInternet)
    }

    func now(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        throw URLError(.notConnectedToInternet)
    }

    func event(
        id: UUID,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicEventDetail> {
        throw URLError(.notConnectedToInternet)
    }
}

private actor FailedSearchEventRepositoryFake: EventRepository {
    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        throw SearchRepositoryFailure.invalidResponse
    }

    func now(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        throw SearchRepositoryFailure.invalidResponse
    }

    func event(
        id: UUID,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicEventDetail> {
        throw SearchRepositoryFailure.invalidResponse
    }
}

private enum SearchRepositoryFailure: Error {
    case invalidResponse
}

private actor SearchPlaceRepositoryFake: PlaceRepository {
    func places(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicPlace]> {
        PublicResource(value: [], source: .cache)
    }

    func activity(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicPlaceActivity> {
        PublicResource(
            value: PublicPlaceActivity(
                place: PublicPlace(
                    id: id,
                    name: id,
                    aliases: [],
                    kind: "other",
                    address: nil,
                    latitude: 0,
                    longitude: 0
                ),
                events: [],
                meetingCount: 0
            ),
            source: .network
        )
    }
}

private actor CachedSearchPlaceRepositoryFake: PlaceRepository {
    private let place: PublicPlace

    init(place: PublicPlace) {
        self.place = place
    }

    func places(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicPlace]> {
        PublicResource(value: [place], source: .cache)
    }

    func activity(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicPlaceActivity> {
        PublicResource(
            value: PublicPlaceActivity(
                place: place,
                events: [],
                meetingCount: 0
            ),
            source: .cache
        )
    }
}

private actor SearchOrganizationRepositoryFake: OrganizationRepository {
    func organizations(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicOrganization]> {
        PublicResource(value: [], source: .cache)
    }

    func profile(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicOrganizationProfile> {
        PublicResource(
            value: PublicOrganizationProfile(
                id: id,
                name: id,
                kind: "club",
                category: nil,
                summary: nil,
                advisor: nil,
                fundingCategory: nil,
                about: nil,
                meetingInformation: nil,
                links: [],
                avatarURL: nil,
                bannerURL: nil,
                upcoming: [],
                past: [],
                revision: 0
            ),
            source: .network
        )
    }
}

private actor CachedSearchOrganizationRepositoryFake:
    OrganizationRepository
{
    private let organization: PublicOrganization

    init(organization: PublicOrganization) {
        self.organization = organization
    }

    func organizations(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicOrganization]> {
        PublicResource(value: [organization], source: .cache)
    }

    func profile(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicOrganizationProfile> {
        throw URLError(.resourceUnavailable)
    }
}

private actor ManualSearchDebouncer: SearchDebouncing {
    private var waiters: [
        UUID: CheckedContinuation<Void, any Error>
    ] = [:]
    private var cancellations = 0

    func wait() async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                waiters[id] = continuation
            }
        } onCancel: {
            Task {
                await self.cancel(id)
            }
        }
    }

    func releaseAll() {
        let pending = Array(waiters.values)
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }

    func waiterCount() -> Int {
        waiters.count
    }

    func cancellationCount() -> Int {
        cancellations
    }

    private func cancel(_ id: UUID) {
        guard let continuation = waiters.removeValue(forKey: id) else {
            return
        }
        cancellations += 1
        continuation.resume(throwing: CancellationError())
    }
}

private func makeEvent(
    id: String = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    title: String = "Event"
) -> PublicEvent {
    PublicEvent(
        id: UUID(uuidString: id)!,
        title: title,
        summary: nil,
        start: Date(timeIntervalSince1970: 1_800_000_000),
        end: nil,
        allDay: false,
        coordinate: nil,
        placeID: nil,
        placeName: nil,
        organizationID: nil,
        organizationName: nil,
        category: "social",
        isCanceled: false
    )
}
