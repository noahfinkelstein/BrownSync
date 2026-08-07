import BrownSyncAPI
import Foundation

struct PublicOrganization: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let kind: String
    let category: String?
    let summary: String?

    init(
        id: String,
        name: String,
        kind: String,
        category: String?,
        summary: String?
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.category = category
        self.summary = summary
    }

    init(wire: OrganizationWire) throws {
        self.init(
            id: wire.id,
            name: wire.name,
            kind: wire.kind,
            category: wire.category,
            summary: wire.description
        )
    }
}

struct PublicOrganizationLink: Codable, Equatable, Hashable, Sendable {
    let platform: String
    let label: String?
    let url: String
}

struct PublicOrganizationProfile: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let kind: String
    let category: String?
    let summary: String?
    let advisor: String?
    let fundingCategory: String?
    let about: String?
    let meetingInformation: String?
    let links: [PublicOrganizationLink]
    let avatarURL: URL?
    let bannerURL: URL?
    let upcoming: [PublicEvent]
    let past: [PublicEvent]
    let revision: Int
}

protocol OrganizationRepository: Sendable {
    func organizations(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicOrganization]>

    func profile(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicOrganizationProfile>
}

struct WorkerOrganizationRepository: OrganizationRepository {
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

    func organizations(
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicOrganization]> {
        try await loadPublicResource(
            cache: cache,
            key: "organizations",
            ttl: 24 * 60 * 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getApiOrgs()
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationsEnvelopeWire =
                        try GeneratedJSONBridge.decode(payload)
                    return try wire.orgs.compactMap { organization in
                        try organization.map(
                            PublicOrganization.init(wire:)
                        )
                    }
                }
            case .serviceUnavailable:
                throw APIError.unavailable
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func profile(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicOrganizationProfile> {
        let atKey = at.map { String($0.timeIntervalSince1970) } ?? "default"
        return try await loadPublicResource(
            cache: cache,
            key: "organization:\(id):profile:\(atKey)",
            ttl: 5 * 60,
            policy: policy,
            now: nowProvider
        ) { [client] in
            let output = try await client.getOrganizationProfile(
                .init(
                    path: .init(id: id),
                    query: .init(at: at)
                )
            )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationProfileWire =
                        try GeneratedJSONBridge.decode(payload)
                    return try PublicOrganizationProfile(wire: wire)
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

struct OrganizationWire: Decodable {
    let id: String
    let name: String
    let kind: String
    let category: String?
    let description: String?
}

private struct OrganizationsEnvelopeWire: Decodable {
    let orgs: [OrganizationWire?]
}

private struct OrganizationProfileWire: Decodable {
    let id: String
    let name: String
    let kind: String
    let category: String?
    let description: String?
    let upcoming: [EventWire]
    let past: [EventWire]
    let advisor: String?
    let fundingCategory: String?
    let aboutMd: String?
    let meetingInfo: String?
    let links: [OrganizationLinkWire]
    let avatarUrl: String?
    let bannerUrl: String?
    let revision: Int
}

private struct OrganizationLinkWire: Decodable {
    let platform: String
    let label: String?
    let url: String
}

private extension PublicOrganizationProfile {
    init(wire: OrganizationProfileWire) throws {
        self.init(
            id: wire.id,
            name: wire.name,
            kind: wire.kind,
            category: wire.category,
            summary: wire.description,
            advisor: wire.advisor,
            fundingCategory: wire.fundingCategory,
            about: wire.aboutMd,
            meetingInformation: wire.meetingInfo,
            links: wire.links.map {
                PublicOrganizationLink(
                    platform: $0.platform,
                    label: $0.label,
                    url: $0.url
                )
            },
            avatarURL: wire.avatarUrl.flatMap(URL.init(string:)),
            bannerURL: wire.bannerUrl.flatMap(URL.init(string:)),
            upcoming: try wire.upcoming.map(PublicEvent.init(wire:)),
            past: try wire.past.map(PublicEvent.init(wire:)),
            revision: wire.revision
        )
    }
}
