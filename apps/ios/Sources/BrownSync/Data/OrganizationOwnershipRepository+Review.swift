import BrownSyncAPI
import Foundation

extension WorkerOrganizationOwnershipRepository {
    func reviewPage(
        after cursor: OrganizationClaimCursor?,
        limit: Int
    ) async throws -> OrganizationClaimReviewPage {
        guard (1...100).contains(limit) else {
            throw OrganizationOwnershipError.invalidReviewPageSize
        }
        return try await runLogged(operation: .review) { [client] in
            let output =
                try await client.listReviewableOrganizationClaims(
                    .init(
                        query: .init(
                            afterCreatedAt: cursor?.afterCreatedAt,
                            afterClaimId: cursor?.afterClaimID
                                .uuidString.lowercased(),
                            limit: limit
                        )
                    )
                )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationClaimReviewQueueWire =
                        try Self.decode(payload)
                    return try OrganizationClaimReviewPage(wire: wire)
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

    func decideClaim(
        claimID: UUID,
        approve: Bool,
        note: String?
    ) async throws -> OrganizationClaimDecisionOutcome {
        try await runLogged(operation: .decideClaim) { [client] in
            let output = try await client.decideOrganizationClaim(
                .init(
                    path: .init(
                        claimId: claimID.uuidString.lowercased()
                    ),
                    body: .json(
                        Components.Schemas.OrgClaimDecisionRequest(
                            approve: approve,
                            note: note
                        )
                    )
                )
            )
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationClaimDecisionResultWire =
                        try Self.decode(payload)
                    return try OrganizationClaimDecisionOutcome(
                        wire: wire,
                        expectedClaimID: claimID
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
}

private struct OrganizationClaimReviewQueueWire: Decodable {
    let claims: [OrganizationReviewableClaimWire]
    let next: OrganizationClaimReviewCursorWire?
}

private struct OrganizationReviewableClaimWire: Decodable {
    let claimId: UUID
    let organizationId: String
    let organizationName: String
    let claimantDisplayName: String?
    let claimantHandle: String?
    let evidence: String?
    let createdAt: Date
}

private struct OrganizationClaimReviewCursorWire: Decodable {
    let afterCreatedAt: Date
    let afterClaimId: UUID
}

private struct OrganizationClaimDecisionResultWire: Decodable {
    let claimId: UUID
    let status: String
    let grantedRole: String?
    let changed: Bool
}

private extension OrganizationClaimReviewPage {
    init(wire: OrganizationClaimReviewQueueWire) throws {
        self.init(
            claims: try wire.claims.map {
                try OrganizationReviewableClaim(wire: $0)
            },
            next: wire.next.map {
                OrganizationClaimCursor(
                    afterCreatedAt: $0.afterCreatedAt,
                    afterClaimID: $0.afterClaimId
                )
            }
        )
    }
}

private extension OrganizationReviewableClaim {
    init(wire: OrganizationReviewableClaimWire) throws {
        guard
            !wire.organizationId.isEmpty,
            !wire.organizationName.isEmpty
        else {
            throw APIError.invalidResponse
        }
        self.init(
            claimID: wire.claimId,
            organizationID: wire.organizationId,
            organizationName: wire.organizationName,
            claimantDisplayName: wire.claimantDisplayName,
            claimantHandle: wire.claimantHandle,
            evidence: wire.evidence,
            createdAt: wire.createdAt
        )
    }
}

private extension OrganizationClaimDecisionOutcome {
    init(
        wire: OrganizationClaimDecisionResultWire,
        expectedClaimID: UUID
    ) throws {
        guard wire.claimId == expectedClaimID else {
            throw APIError.invalidResponse
        }
        let status: OrganizationClaimStatus
        switch wire.status {
        case "approved":
            status = .approved
        case "rejected":
            status = .rejected
        default:
            throw APIError.invalidResponse
        }
        let grantedRole = try wire.grantedRole.map {
            try organizationRole(wire: $0)
        }
        self.init(
            claimID: wire.claimId,
            status: status,
            grantedRole: grantedRole,
            changed: wire.changed
        )
    }
}

private func organizationRole(
    wire value: String
) throws -> OrganizationRole {
    switch value {
    case "owner":
        return .owner
    case "editor":
        return .editor
    default:
        throw APIError.invalidResponse
    }
}
