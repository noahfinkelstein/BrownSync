import BrownSyncAPI
import Foundation

extension WorkerOrganizationOwnershipRepository {
    func access() async throws -> OrganizationAccessSnapshot {
        try await runLogged(operation: .access) { [client] in
            let output = try await client.listMyOrganizations()
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: MyOrganizationsWire =
                        try Self.decode(payload)
                    return try OrganizationAccessSnapshot(
                        memberships: wire.memberships.map {
                            try OrganizationMembership(wire: $0)
                        },
                        claims: wire.claims.map {
                            try OrganizationClaimSummary(wire: $0)
                        }
                    )
                }
            case let .badRequest(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 400, payload: payload)
                }
            case let .unauthorized(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 401, payload: payload)
                }
            case let .forbidden(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 403, payload: payload)
                }
            case let .notFound(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 404, payload: payload)
                }
            case let .conflict(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 409, payload: payload)
                }
            case let .tooManyRequests(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 429, payload: payload)
                }
            case let .serviceUnavailable(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 503, payload: payload)
                }
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func create(
        _ draft: OrganizationCreateDraft
    ) async throws -> OrganizationCreateOutcome {
        try await runLogged(operation: .create) { [client] in
            let request = Components.Schemas.OrgCreateRequest(
                name: draft.name,
                description: draft.description,
                aboutMd: draft.aboutMarkdown,
                meetingInfo: draft.meetingInformation,
                links: draft.links.map(Self.generatedLink)
            )
            let output = try await client.createOrganization(
                .init(body: .json(request))
            )
            switch output {
            case let .created(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationCreateResultWire =
                        try Self.decode(payload)
                    return try OrganizationCreateOutcome(wire: wire)
                }
            case let .badRequest(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 400, payload: payload)
                }
            case let .unauthorized(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 401, payload: payload)
                }
            case let .forbidden(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 403, payload: payload)
                }
            case let .notFound(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 404, payload: payload)
                }
            case let .conflict(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 409, payload: payload)
                }
            case let .tooManyRequests(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 429, payload: payload)
                }
            case let .serviceUnavailable(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 503, payload: payload)
                }
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func claim(
        organizationID: String,
        evidence: String?
    ) async throws -> OrganizationClaimOutcome {
        try await runLogged(operation: .claim) { [client] in
            let output = try await client.claimOrganization(
                .init(
                    path: .init(id: organizationID),
                    body: .json(
                        Components.Schemas.OrgClaimRequest(
                            evidence: evidence
                        )
                    )
                )
            )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationClaimResultWire =
                        try Self.decode(payload)
                    return try OrganizationClaimOutcome(
                        wire: wire,
                        expectedOrganizationID: organizationID
                    )
                }
            case let .badRequest(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 400, payload: payload)
                }
            case let .unauthorized(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 401, payload: payload)
                }
            case let .forbidden(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 403, payload: payload)
                }
            case let .notFound(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 404, payload: payload)
                }
            case let .conflict(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 409, payload: payload)
                }
            case let .tooManyRequests(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 429, payload: payload)
                }
            case let .serviceUnavailable(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 503, payload: payload)
                }
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    private static func generatedLink(
        _ link: OrganizationLink
    ) -> Components.Schemas.OrgLink {
        switch link.platform {
        case .instagram:
            return .init(
                platform: .instagram,
                url: link.url.absoluteString,
                label: link.label
            )
        case .discord:
            return .init(
                platform: .discord,
                url: link.url.absoluteString,
                label: link.label
            )
        case .facebook:
            return .init(
                platform: .facebook,
                url: link.url.absoluteString,
                label: link.label
            )
        case .linkedin:
            return .init(
                platform: .linkedin,
                url: link.url.absoluteString,
                label: link.label
            )
        case .youtube:
            return .init(
                platform: .youtube,
                url: link.url.absoluteString,
                label: link.label
            )
        case .x:
            return .init(
                platform: .x,
                url: link.url.absoluteString,
                label: link.label
            )
        case .tiktok:
            return .init(
                platform: .tiktok,
                url: link.url.absoluteString,
                label: link.label
            )
        case .website:
            return .init(
                platform: .website,
                url: link.url.absoluteString,
                label: link.label
            )
        case .other:
            return .init(
                platform: .other,
                url: link.url.absoluteString,
                label: link.label
            )
        }
    }
}

private struct MyOrganizationsWire: Decodable {
    let memberships: [OrganizationMembershipWire]
    let claims: [OrganizationClaimSummaryWire]
}

private struct OrganizationMembershipWire: Decodable {
    let organizationId: String
    let organizationName: String
    let role: String
    let grantedAt: Date
}

private struct OrganizationClaimSummaryWire: Decodable {
    let id: UUID
    let organizationId: String
    let organizationName: String
    let status: String
    let createdAt: Date
    let reviewedAt: Date?
    let reviewNote: String?
}

private struct OrganizationCreateResultWire: Decodable {
    let organizationId: String
    let revision: Int
    let role: String
    let disposition: String
}

private struct OrganizationClaimResultWire: Decodable {
    let organizationId: String
    let disposition: String
    let role: String?
    let claimId: UUID?
}

private extension OrganizationRole {
    init(wire value: String) throws {
        switch value {
        case "owner":
            self = .owner
        case "editor":
            self = .editor
        default:
            throw APIError.invalidResponse
        }
    }
}

private extension OrganizationClaimStatus {
    init(wire value: String) throws {
        switch value {
        case "pending":
            self = .pending
        case "approved":
            self = .approved
        case "rejected":
            self = .rejected
        default:
            throw APIError.invalidResponse
        }
    }
}

private extension OrganizationMembership {
    init(wire: OrganizationMembershipWire) throws {
        guard
            !wire.organizationId.isEmpty,
            !wire.organizationName.isEmpty
        else {
            throw APIError.invalidResponse
        }
        self.init(
            organizationID: wire.organizationId,
            organizationName: wire.organizationName,
            role: try OrganizationRole(wire: wire.role),
            grantedAt: wire.grantedAt
        )
    }
}

private extension OrganizationClaimSummary {
    init(wire: OrganizationClaimSummaryWire) throws {
        guard
            !wire.organizationId.isEmpty,
            !wire.organizationName.isEmpty
        else {
            throw APIError.invalidResponse
        }
        self.init(
            id: wire.id,
            organizationID: wire.organizationId,
            organizationName: wire.organizationName,
            status: try OrganizationClaimStatus(wire: wire.status),
            createdAt: wire.createdAt,
            reviewedAt: wire.reviewedAt,
            reviewNote: wire.reviewNote
        )
    }
}

private extension OrganizationCreateOutcome {
    init(wire: OrganizationCreateResultWire) throws {
        guard
            !wire.organizationId.isEmpty,
            wire.revision >= 0,
            wire.role == "owner"
        else {
            throw APIError.invalidResponse
        }
        let disposition: OrganizationCreateDisposition
        switch wire.disposition {
        case "created":
            disposition = .created
        case "replayed":
            disposition = .replayed
        default:
            throw APIError.invalidResponse
        }
        self.init(
            organizationID: wire.organizationId,
            revision: wire.revision,
            role: .owner,
            disposition: disposition
        )
    }
}

private extension OrganizationClaimOutcome {
    init(
        wire: OrganizationClaimResultWire,
        expectedOrganizationID: String
    ) throws {
        guard wire.organizationId == expectedOrganizationID else {
            throw APIError.invalidResponse
        }
        switch (wire.disposition, wire.role, wire.claimId) {
        case let ("auto_approved", role?, claimID?):
            self = .autoApproved(
                role: try OrganizationRole(wire: role),
                claimID: claimID
            )
        case let ("pending", nil, claimID?):
            self = .pending(claimID: claimID)
        case let ("already_admin", role?, nil):
            self = .alreadyAdmin(
                role: try OrganizationRole(wire: role)
            )
        case let ("already_pending", nil, claimID?):
            self = .replayedPending(claimID: claimID)
        default:
            throw APIError.invalidResponse
        }
    }
}
