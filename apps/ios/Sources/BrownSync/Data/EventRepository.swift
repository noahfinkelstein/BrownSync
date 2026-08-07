import BrownSyncAPI
import Foundation

struct EventCoordinate: Codable, Equatable, Hashable, Sendable {
    let latitude: Double
    let longitude: Double
}

struct PublicEvent: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: UUID
    let title: String
    let summary: String?
    let start: Date
    let end: Date?
    let allDay: Bool
    let coordinate: EventCoordinate?
    let placeID: String?
    let placeName: String?
    let organizationID: String?
    let organizationName: String?
    let category: String
    let isCanceled: Bool

    init(
        id: UUID,
        title: String,
        summary: String?,
        start: Date,
        end: Date?,
        allDay: Bool,
        coordinate: EventCoordinate?,
        placeID: String?,
        placeName: String?,
        organizationID: String?,
        organizationName: String?,
        category: String,
        isCanceled: Bool
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.start = start
        self.end = end
        self.allDay = allDay
        self.coordinate = coordinate
        self.placeID = placeID
        self.placeName = placeName
        self.organizationID = organizationID
        self.organizationName = organizationName
        self.category = category
        self.isCanceled = isCanceled
    }

    init(wire: EventWire) throws {
        guard let id = UUID(uuidString: wire.id) else {
            throw APIError.invalidResponse
        }
        self.init(
            id: id,
            title: wire.title,
            summary: wire.description,
            start: try PublicDateParser.date(wire.start),
            end: try wire.end.map(PublicDateParser.date),
            allDay: wire.allDay,
            coordinate: EventCoordinate(
                latitude: wire.lat,
                longitude: wire.lng
            ),
            placeID: wire.placeId,
            placeName: wire.placeName,
            organizationID: wire.orgId,
            organizationName: wire.orgName,
            category: wire.category,
            isCanceled: wire.isCanceled
        )
    }
}

private extension EventCoordinate {
    init?(latitude: Double?, longitude: Double?) {
        guard let latitude, let longitude else { return nil }
        self.init(latitude: latitude, longitude: longitude)
    }
}

struct PublicEventDetail: Codable, Equatable, Sendable {
    let event: PublicEvent
    let organization: PublicOrganization?
}

struct EventQuery: Codable, Equatable, Hashable, Sendable {
    let from: Date?
    let to: Date?
    let boundingBox: String?
    let text: String?

    init(
        from: Date? = nil,
        to: Date? = nil,
        boundingBox: String? = nil,
        text: String? = nil
    ) {
        self.from = from
        self.to = to
        self.boundingBox = boundingBox
        self.text = text
    }

    var cacheKey: String {
        [
            from.map { String($0.timeIntervalSince1970) } ?? "-",
            to.map { String($0.timeIntervalSince1970) } ?? "-",
            boundingBox ?? "-",
            text ?? "-",
        ].joined(separator: "|")
    }
}

protocol EventRepository: Sendable {
    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]>

    func now(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]>

    func event(
        id: UUID,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicEventDetail>
}

struct WorkerEventRepository: EventRepository {
    private let client: BrownSyncAPI.Client
    private let cache: PublicResponseCache
    private let nowProvider: @Sendable () -> Date

    init(
        client: BrownSyncAPI.Client,
        cache: PublicResponseCache,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.client = client
        self.cache = cache
        nowProvider = now
    }

    func events(
        query: EventQuery,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        try await loadPublicResource(
            cache: cache,
            key: "events:\(query.cacheKey)",
            ttl: 5 * 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getApiEvents(
                .init(
                    query: .init(
                        from: query.from,
                        to: query.to,
                        bbox: query.boundingBox,
                        q: query.text
                    )
                )
            )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: EventsEnvelopeWire = try GeneratedJSONBridge
                        .decode(payload)
                    return try wire.events.map(PublicEvent.init(wire:))
                }
            case .badRequest:
                throw APIError.server(status: 400, code: nil)
            case .serviceUnavailable:
                throw APIError.unavailable
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func now(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicEvent]> {
        try await loadPublicResource(
            cache: cache,
            key: "events:now",
            ttl: 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getApiNow()
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: NowEnvelopeWire = try GeneratedJSONBridge
                        .decode(payload)
                    return try wire.events.map(PublicEvent.init(wire:))
                }
            case .serviceUnavailable:
                throw APIError.unavailable
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func event(
        id: UUID,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicEventDetail> {
        try await loadPublicResource(
            cache: cache,
            key: "event:\(id.uuidString.lowercased())",
            ttl: 2 * 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getApiEventsId(
                .init(path: .init(id: id.uuidString.lowercased()))
            )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: EventDetailWire = try GeneratedJSONBridge
                        .decode(payload)
                    return PublicEventDetail(
                        event: try PublicEvent(wire: wire.event),
                        organization: try wire.org.map(
                            PublicOrganization.init(wire:)
                        )
                    )
                }
            case .badRequest:
                throw APIError.server(status: 400, code: nil)
            case .notFound:
                throw APIError.server(status: 404, code: nil)
            case .serviceUnavailable:
                throw APIError.unavailable
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }
}

enum GeneratedJSONBridge {
    static func decode<Source: Encodable, Target: Decodable>(
        _ source: Source
    ) throws -> Target {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(
            Target.self,
            from: encoder.encode(source)
        )
    }
}

enum PublicDateParser {
    static func date(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]
        if let date = formatter.date(from: value) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: value) else {
            throw APIError.invalidResponse
        }
        return date
    }
}

struct EventWire: Decodable {
    let id: String
    let title: String
    let description: String?
    let start: String
    let end: String?
    let allDay: Bool
    let lat: Double?
    let lng: Double?
    let placeId: String?
    let placeName: String?
    let orgId: String?
    let orgName: String?
    let category: String
    let isCanceled: Bool
}

private struct EventsEnvelopeWire: Decodable {
    let events: [EventWire]
}

private struct NowEnvelopeWire: Decodable {
    let events: [EventWire]
}

private struct EventDetailWire: Decodable {
    let event: EventWire
    let org: OrganizationWire?

    init(from decoder: Decoder) throws {
        event = try EventWire(from: decoder)
        let container = try decoder.container(
            keyedBy: CodingKeys.self
        )
        org = try container.decodeIfPresent(
            OrganizationWire.self,
            forKey: .org
        )
    }

    private enum CodingKeys: String, CodingKey {
        case org
    }
}
