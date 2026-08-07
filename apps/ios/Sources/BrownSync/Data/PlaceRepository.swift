import BrownSyncAPI
import Foundation

struct PublicPlace: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let aliases: [String]
    let kind: String
    let address: String?
    let latitude: Double
    let longitude: Double

    init(
        id: String,
        name: String,
        aliases: [String],
        kind: String,
        address: String?,
        latitude: Double,
        longitude: Double
    ) {
        self.id = id
        self.name = name
        self.aliases = aliases
        self.kind = kind
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
    }

    init(wire: PlaceWire) {
        self.init(
            id: wire.id,
            name: wire.name,
            aliases: wire.aliases,
            kind: wire.kind,
            address: wire.address,
            latitude: wire.lat,
            longitude: wire.lng
        )
    }
}

struct PublicPlaceActivity: Codable, Equatable, Sendable {
    let place: PublicPlace
    let events: [PublicEvent]
    let meetingCount: Int
}

protocol PlaceRepository: Sendable {
    func places(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicPlace]>

    func activity(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicPlaceActivity>
}

struct WorkerPlaceRepository: PlaceRepository {
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

    func places(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicPlace]> {
        try await loadPublicResource(
            cache: cache,
            key: "places",
            ttl: 24 * 60 * 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getApiPlaces()
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: PlacesEnvelopeWire = try GeneratedJSONBridge
                        .decode(payload)
                    return wire.places.compactMap { place in
                        place.map(PublicPlace.init(wire:))
                    }
                }
            case .serviceUnavailable:
                throw APIError.unavailable
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func activity(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicPlaceActivity> {
        let atKey = at.map { String($0.timeIntervalSince1970) } ?? "now"
        return try await loadPublicResource(
            cache: cache,
            key: "place:\(id):activity:\(atKey)",
            ttl: 2 * 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getApiPlacesIdActivity(
                .init(
                    path: .init(id: id),
                    query: .init(at: at)
                )
            )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: PlaceActivityWire = try GeneratedJSONBridge
                        .decode(payload)
                    guard let place = wire.place else {
                        throw APIError.invalidResponse
                    }
                    return PublicPlaceActivity(
                        place: PublicPlace(wire: place),
                        events: try wire.events.map(
                            PublicEvent.init(wire:)
                        ),
                        meetingCount: wire.meetingCount
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

struct PlaceWire: Decodable {
    let id: String
    let name: String
    let aliases: [String]
    let kind: String
    let lat: Double
    let lng: Double
    let address: String?
}

private struct PlacesEnvelopeWire: Decodable {
    let places: [PlaceWire?]
}

private struct PlaceActivityWire: Decodable {
    let place: PlaceWire?
    let events: [EventWire]
    let meetingCount: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        place = try container.decodeIfPresent(
            PlaceWire.self,
            forKey: .place
        )
        events = try container.decode([EventWire].self, forKey: .events)
        var meetings = try container.nestedUnkeyedContainer(
            forKey: .meetings
        )
        var count = 0
        while !meetings.isAtEnd {
            _ = try meetings.decode(IgnoredJSONValue.self)
            count += 1
        }
        meetingCount = count
    }

    private enum CodingKeys: String, CodingKey {
        case place
        case events
        case meetings
    }
}

private struct IgnoredJSONValue: Decodable {
    init(from decoder: Decoder) throws {
        if var array = try? decoder.unkeyedContainer() {
            while !array.isAtEnd {
                _ = try array.decode(IgnoredJSONValue.self)
            }
            return
        }
        if let object = try? decoder.container(
            keyedBy: ArbitraryCodingKey.self
        ) {
            for key in object.allKeys {
                _ = try object.decode(IgnoredJSONValue.self, forKey: key)
            }
            return
        }
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { return }
        if (try? value.decode(Bool.self)) != nil { return }
        if (try? value.decode(Double.self)) != nil { return }
        if (try? value.decode(String.self)) != nil { return }
        throw APIError.invalidResponse
    }
}

private struct ArbitraryCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}
