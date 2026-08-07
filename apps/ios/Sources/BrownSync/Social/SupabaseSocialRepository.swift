import Foundation
import Supabase

struct SupabaseSocialDatabaseTransport: SocialDatabaseTransport {
    let client: SupabaseClient

    func select<Row: Decodable & Sendable>(
        _ table: SocialTable,
        as _: Row.Type
    ) async throws -> [Row] {
        let response: PostgrestResponse<[Row]> = try await client
            .from(table.rawValue)
            .select()
            .execute()
        return response.value
    }

    func rpc<Parameters: Encodable & Sendable>(
        _ function: SocialRPC,
        parameters: Parameters
    ) async throws {
        try await client
            .rpc(function.rawValue, params: parameters)
            .retry(enabled: false)
            .execute()
    }

    func rpc(_ function: SocialRPC) async throws {
        try await client
            .rpc(function.rawValue)
            .retry(enabled: false)
            .execute()
    }
}

struct SupabaseSocialRepository: SocialRepository {
    private let transport: any SocialDatabaseTransport

    init(transport: any SocialDatabaseTransport) {
        self.transport = transport
    }

    func fetchSocialSnapshot() async throws -> SocialSnapshot {
        async let profiles = transport.select(
            .profiles,
            as: SocialProfile.self
        )
        async let friendships = transport.select(
            .friendships,
            as: Friendship.self
        )
        async let shares = transport.select(
            .presenceShares,
            as: PresenceShare.self
        )
        async let presence = transport.select(
            .presenceState,
            as: PresenceState.self
        )
        return try await SocialSnapshot(
            profiles: profiles,
            friendships: friendships,
            shares: shares,
            presence: presence
        )
    }

    func fetchVisiblePresence() async throws -> [PresenceState] {
        try await transport.select(
            .presenceState,
            as: PresenceState.self
        )
    }

    func requestFriend(addresseeID: UUID) async throws {
        try await transport.rpc(
            .requestFriend,
            parameters: RequestFriendParameters(pAddressee: addresseeID)
        )
    }

    func respondToFriendRequest(
        requesterID: UUID,
        accept: Bool
    ) async throws {
        try await transport.rpc(
            .respondFriend,
            parameters: RespondFriendParameters(
                pRequester: requesterID,
                pAccept: accept
            )
        )
    }

    func removeFriend(otherUserID: UUID) async throws {
        try await transport.rpc(
            .removeFriend,
            parameters: OtherUserParameters(pOther: otherUserID)
        )
    }

    func blockUser(otherUserID: UUID) async throws {
        try await transport.rpc(
            .blockUser,
            parameters: OtherUserParameters(pOther: otherUserID)
        )
    }

    func unblockUser(otherUserID: UUID) async throws {
        try await transport.rpc(
            .unblockUser,
            parameters: OtherUserParameters(pOther: otherUserID)
        )
    }

    func setPresenceShare(viewerID: UUID, expiresAt: Date) async throws {
        try await transport.rpc(
            .setPresenceShare,
            parameters: SetPresenceShareParameters(
                pViewer: viewerID,
                pExpiresAt: expiresAt
            )
        )
    }

    func revokePresenceShare(viewerID: UUID) async throws {
        try await transport.rpc(
            .revokePresenceShare,
            parameters: ViewerParameters(pViewer: viewerID)
        )
    }

    func setPresence(_ presence: ConfirmedPresence) async throws {
        try await transport.rpc(
            .setPresence,
            parameters: SetPresenceParameters(presence: presence)
        )
    }

    func clearPresence() async throws {
        try await transport.rpc(.clearPresence)
    }

    func setGhost(_ ghost: Bool) async throws {
        try await transport.rpc(
            .setGhost,
            parameters: SetGhostParameters(pGhost: ghost)
        )
    }
}

private struct RequestFriendParameters: Encodable, Sendable {
    let pAddressee: UUID

    enum CodingKeys: String, CodingKey {
        case pAddressee = "p_addressee"
    }
}

private struct RespondFriendParameters: Encodable, Sendable {
    let pRequester: UUID
    let pAccept: Bool

    enum CodingKeys: String, CodingKey {
        case pRequester = "p_requester"
        case pAccept = "p_accept"
    }
}

private struct OtherUserParameters: Encodable, Sendable {
    let pOther: UUID

    enum CodingKeys: String, CodingKey {
        case pOther = "p_other"
    }
}

private struct SetPresenceShareParameters: Encodable, Sendable {
    let pViewer: UUID
    let pExpiresAt: Date

    enum CodingKeys: String, CodingKey {
        case pViewer = "p_viewer"
        case pExpiresAt = "p_expires_at"
    }
}

private struct ViewerParameters: Encodable, Sendable {
    let pViewer: UUID

    enum CodingKeys: String, CodingKey {
        case pViewer = "p_viewer"
    }
}

private struct SetPresenceParameters: Encodable, Sendable {
    let pPlaceID: String
    let pStatus: PresenceStatus?
    let pNote: String?
    let pTTL: String

    init(presence: ConfirmedPresence) {
        pPlaceID = presence.placeID
        pStatus = presence.status
        pNote = presence.note
        pTTL = "\(presence.ttlSeconds) seconds"
    }

    enum CodingKeys: String, CodingKey {
        case pPlaceID = "p_place_id"
        case pStatus = "p_status"
        case pNote = "p_note"
        case pTTL = "p_ttl"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pPlaceID, forKey: .pPlaceID)
        if let pStatus {
            try container.encode(pStatus, forKey: .pStatus)
        } else {
            try container.encodeNil(forKey: .pStatus)
        }
        if let pNote {
            try container.encode(pNote, forKey: .pNote)
        } else {
            try container.encodeNil(forKey: .pNote)
        }
        try container.encode(pTTL, forKey: .pTTL)
    }
}

private struct SetGhostParameters: Encodable, Sendable {
    let pGhost: Bool

    enum CodingKeys: String, CodingKey {
        case pGhost = "p_ghost"
    }
}
