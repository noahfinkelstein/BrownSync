import Combine
import Foundation

enum PublicSearchResultKind: Equatable, Sendable {
    case event
    case place
    case organization
}

enum PublicSearchResult: Equatable, Hashable, Identifiable, Sendable {
    case event(PublicEvent)
    case place(PublicPlace)
    case organization(PublicOrganization)

    var id: String {
        switch self {
        case let .event(event):
            return "event:\(event.id.uuidString)"
        case let .place(place):
            return "place:\(place.id)"
        case let .organization(organization):
            return "organization:\(organization.id)"
        }
    }

    var kind: PublicSearchResultKind {
        switch self {
        case .event:
            return .event
        case .place:
            return .place
        case .organization:
            return .organization
        }
    }

    var title: String {
        switch self {
        case let .event(event):
            return event.title
        case let .place(place):
            return place.name
        case let .organization(organization):
            return organization.name
        }
    }

    var subtitle: String? {
        switch self {
        case let .event(event):
            return event.placeName ?? event.organizationName
        case let .place(place):
            return place.address ?? place.kind.capitalized
        case let .organization(organization):
            return organization.summary ?? organization.kind.capitalized
        }
    }

    var route: AppRoute {
        switch self {
        case let .event(event):
            return .event(event.id)
        case let .place(place):
            return .place(place.id)
        case let .organization(organization):
            return .organization(organization.id)
        }
    }
}

protocol SearchDebouncing: Sendable {
    func wait() async throws
}

struct DefaultSearchDebouncer: SearchDebouncing {
    private let nanoseconds: UInt64

    init(nanoseconds: UInt64 = 300_000_000) {
        self.nanoseconds = nanoseconds
    }

    func wait() async throws {
        try await Task.sleep(nanoseconds: nanoseconds)
    }
}

private enum SearchFamilyFailure: Sendable {
    case offline
    case other
}

private enum SearchFamilyResult<Value: Sendable>: Sendable {
    case success(PublicResource<Value>)
    case failure(SearchFamilyFailure)
    case cancelled
}

private enum SearchLoadError: Error {
    case allFamiliesFailed
}

private func loadSearchFamily<Value: Sendable>(
    _ operation: @escaping @Sendable () async throws -> PublicResource<Value>
) async -> SearchFamilyResult<Value> {
    do {
        return .success(try await operation())
    } catch is CancellationError {
        return .cancelled
    } catch let error as URLError where error.code == .cancelled {
        return .cancelled
    } catch {
        return .failure(searchFamilyFailure(for: error))
    }
}

private func searchFamilyFailure(for error: any Error) -> SearchFamilyFailure {
    guard let urlError = error as? URLError else { return .other }
    switch urlError.code {
    case .notConnectedToInternet,
         .networkConnectionLost,
         .cannotConnectToHost,
         .cannotFindHost,
         .dnsLookupFailed,
         .internationalRoamingOff,
         .dataNotAllowed,
         .callIsActive:
        return .offline
    default:
        return .other
    }
}

enum PublicSearchIndex {
    static func merge(
        query: String,
        events: [PublicEvent],
        places: [PublicPlace],
        organizations: [PublicOrganization]
    ) -> [PublicSearchResult] {
        let needle = normalize(query)
        guard !needle.isEmpty else { return [] }

        var ranked: [RankedResult] = []
        ranked.append(
            contentsOf: events.compactMap { event in
                rank(
                    result: .event(event),
                    fields: [event.title, event.summary ?? ""],
                    needle: needle,
                    kindPriority: 0
                )
            }
        )
        ranked.append(
            contentsOf: organizations.compactMap { organization in
                rank(
                    result: .organization(organization),
                    fields: [
                        organization.name,
                        organization.summary ?? "",
                    ],
                    needle: needle,
                    kindPriority: 1
                )
            }
        )
        ranked.append(
            contentsOf: places.compactMap { place in
                rank(
                    result: .place(place),
                    fields: [place.name] + place.aliases,
                    needle: needle,
                    kindPriority: 2
                )
            }
        )
        return ranked.sorted {
            if $0.matchRank != $1.matchRank {
                return $0.matchRank < $1.matchRank
            }
            if $0.kindPriority != $1.kindPriority {
                return $0.kindPriority < $1.kindPriority
            }
            return $0.result.title.localizedStandardCompare(
                $1.result.title
            ) == .orderedAscending
        }.map(\.result)
    }

    static func normalize(_ value: String) -> String {
        let folded = value.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: .current
        )
        let pieces = folded.unicodeScalars.split { scalar in
            !CharacterSet.alphanumerics.contains(scalar)
        }
        return pieces.map(String.init).joined(separator: " ")
    }

    private static func rank(
        result: PublicSearchResult,
        fields: [String],
        needle: String,
        kindPriority: Int
    ) -> RankedResult? {
        let ranks = fields.compactMap { field -> Int? in
            let haystack = normalize(field)
            guard !haystack.isEmpty else { return nil }
            if haystack == needle { return 0 }
            if haystack.hasPrefix(needle) { return 1 }
            if haystack.split(separator: " ").contains(
                where: { $0.hasPrefix(needle) }
            ) {
                return 2
            }
            if haystack.contains(needle) { return 3 }
            return nil
        }
        guard let matchRank = ranks.min() else { return nil }
        return RankedResult(
            result: result,
            matchRank: matchRank,
            kindPriority: kindPriority
        )
    }

    private struct RankedResult {
        let result: PublicSearchResult
        let matchRank: Int
        let kindPriority: Int
    }
}

@MainActor
final class SearchViewModel: ObservableObject {
    @Published private(set) var results: [PublicSearchResult] = []
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var errorMessage: String?
    @Published private(set) var partialResultsMessage: String?
    @Published private(set) var isLoading = false
    @Published private(set) var query = ""

    private let events: any EventRepository
    private let places: any PlaceRepository
    private let organizations: any OrganizationRepository
    private let debouncer: any SearchDebouncing
    private var searchTask: Task<Void, Never>?

    init(
        events: any EventRepository,
        places: any PlaceRepository,
        organizations: any OrganizationRepository,
        debouncer: any SearchDebouncing = DefaultSearchDebouncer()
    ) {
        self.events = events
        self.places = places
        self.organizations = organizations
        self.debouncer = debouncer
    }

    func updateQuery(_ value: String) {
        query = value
        searchTask?.cancel()
        guard !PublicSearchIndex.normalize(value).isEmpty else {
            results = []
            source = nil
            errorMessage = nil
            partialResultsMessage = nil
            isLoading = false
            return
        }

        searchTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await debouncer.wait()
                try Task.checkCancellation()
                try await search(value)
            } catch is CancellationError {
                guard !Task.isCancelled, query == value else { return }
                isLoading = false
                return
            } catch {
                guard query == value else { return }
                results = []
                source = nil
                partialResultsMessage = nil
                isLoading = false
                errorMessage = "Search is temporarily unavailable."
            }
        }
    }

    private func search(_ value: String) async throws {
        guard query == value else { return }
        isLoading = true
        errorMessage = nil
        partialResultsMessage = nil
        async let eventResult = loadSearchFamily { [events] in
            try await events.events(
                query: EventQuery(text: value),
                policy: .reload
            )
        }
        async let placeResult = loadSearchFamily { [places] in
            try await places.places(policy: .useCache)
        }
        async let organizationResult = loadSearchFamily {
            [organizations] in
            try await organizations.organizations(
                policy: .useCache
            )
        }
        let loaded = await (
            eventResult,
            placeResult,
            organizationResult
        )
        try Task.checkCancellation()

        var loadedEvents: [PublicEvent] = []
        var loadedPlaces: [PublicPlace] = []
        var loadedOrganizations: [PublicOrganization] = []
        var sources: [PublicDataSource] = []
        var offlineFailureCount = 0
        var otherFailureCount = 0

        switch loaded.0 {
        case let .success(resource):
            loadedEvents = resource.value
            sources.append(resource.source)
        case let .failure(failure):
            switch failure {
            case .offline:
                offlineFailureCount += 1
            case .other:
                otherFailureCount += 1
            }
        case .cancelled:
            throw CancellationError()
        }
        switch loaded.1 {
        case let .success(resource):
            loadedPlaces = resource.value
            sources.append(resource.source)
        case let .failure(failure):
            switch failure {
            case .offline:
                offlineFailureCount += 1
            case .other:
                otherFailureCount += 1
            }
        case .cancelled:
            throw CancellationError()
        }
        switch loaded.2 {
        case let .success(resource):
            loadedOrganizations = resource.value
            sources.append(resource.source)
        case let .failure(failure):
            switch failure {
            case .offline:
                offlineFailureCount += 1
            case .other:
                otherFailureCount += 1
            }
        case .cancelled:
            throw CancellationError()
        }

        guard let firstSource = sources.first else {
            throw SearchLoadError.allFamiliesFailed
        }
        try Task.checkCancellation()
        guard query == value else { return }

        results = PublicSearchIndex.merge(
            query: value,
            events: loadedEvents,
            places: loadedPlaces,
            organizations: loadedOrganizations
        )
        let combinedSource = sources.dropFirst().reduce(firstSource) {
            $0.combined(with: $1)
        }
        source = offlineFailureCount > 0
            ? combinedSource.combined(with: .offline(isStale: true))
            : combinedSource
        partialResultsMessage = otherFailureCount > 0
            ? "Some search results are temporarily unavailable."
            : nil
        isLoading = false
    }
}
