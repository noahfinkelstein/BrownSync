import Foundation

enum SocialTable: String, CaseIterable, Sendable {
    case profiles
    case friendships
    case presenceShares = "presence_shares"
    case presenceState = "presence_state"
}

enum SocialRPC: String, Sendable {
    case requestFriend = "request_friend"
    case respondFriend = "respond_friend"
    case removeFriend = "remove_friend"
    case blockUser = "block_user"
    case unblockUser = "unblock_user"
    case setPresenceShare = "set_presence_share"
    case revokePresenceShare = "revoke_presence_share"
    case setPresence = "set_presence"
    case clearPresence = "clear_presence"
    case setGhost = "set_ghost"
}

enum FriendshipStatus: String, Codable, Sendable {
    case pending
    case accepted
    case blocked
}

enum PresenceStatus: String, Codable, CaseIterable, Sendable {
    case studying
    case eating
    case inClass = "class"
    case free
}

struct SocialProfile: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let handle: String
    let displayName: String
    let avatarURL: URL?
    let classYear: Int?
    let concentration: String?
    let bio: String?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case handle
        case displayName = "display_name"
        case avatarURL = "avatar_url"
        case classYear = "class_year"
        case concentration
        case bio
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(
        id: UUID,
        handle: String,
        displayName: String,
        avatarURL: URL?,
        classYear: Int?,
        concentration: String?,
        bio: String?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.handle = handle
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.classYear = classYear
        self.concentration = concentration
        self.bio = bio
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        handle = try container.decode(String.self, forKey: .handle)
        displayName = try container.decode(String.self, forKey: .displayName)
        if
            let value = try container.decodeIfPresent(
                String.self,
                forKey: .avatarURL
            ),
            let candidate = URL(string: value),
            let scheme = candidate.scheme?.lowercased(),
            ["http", "https"].contains(scheme),
            candidate.host != nil
        {
            avatarURL = candidate
        } else {
            avatarURL = nil
        }
        classYear = try container.decodeIfPresent(
            Int.self,
            forKey: .classYear
        )
        concentration = try container.decodeIfPresent(
            String.self,
            forKey: .concentration
        )
        bio = try container.decodeIfPresent(String.self, forKey: .bio)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(handle, forKey: .handle)
        try container.encode(displayName, forKey: .displayName)
        try container.encodeIfPresent(
            avatarURL?.absoluteString,
            forKey: .avatarURL
        )
        try container.encodeIfPresent(classYear, forKey: .classYear)
        try container.encodeIfPresent(
            concentration,
            forKey: .concentration
        )
        try container.encodeIfPresent(bio, forKey: .bio)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
}

struct Friendship: Codable, Equatable, Sendable {
    let requesterID: UUID
    let addresseeID: UUID
    let status: FriendshipStatus
    let blockedByID: UUID?
    let createdAt: Date
    let respondedAt: Date?

    enum CodingKeys: String, CodingKey {
        case requesterID = "requester"
        case addresseeID = "addressee"
        case status
        case blockedByID = "blocked_by"
        case createdAt = "created_at"
        case respondedAt = "responded_at"
    }
}

struct PresenceShare: Codable, Equatable, Sendable {
    let ownerID: UUID
    let viewerID: UUID
    let expiresAt: Date
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case ownerID = "owner"
        case viewerID = "viewer"
        case expiresAt = "expires_at"
        case createdAt = "created_at"
    }
}

struct PresenceState: Codable, Equatable, Identifiable, Sendable {
    let userID: UUID
    let placeID: String?
    let status: PresenceStatus?
    let note: String?
    let ghost: Bool
    let updatedAt: Date
    let expiresAt: Date

    var id: UUID { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case placeID = "place_id"
        case status
        case note
        case ghost
        case updatedAt = "updated_at"
        case expiresAt = "expires_at"
    }
}

struct SocialSnapshot: Equatable, Sendable {
    let profiles: [SocialProfile]
    let friendships: [Friendship]
    let shares: [PresenceShare]
    let presence: [PresenceState]

    static let empty = SocialSnapshot(
        profiles: [],
        friendships: [],
        shares: [],
        presence: []
    )
}

struct ConfirmedPresence: Equatable, Sendable {
    let placeID: String
    let status: PresenceStatus?
    let note: String?
    let ttlSeconds: Int
}

struct PresenceTime: Equatable, Sendable {
    let wallClock: Date
    let monotonic: Duration
}

protocol PresenceTimeProviding: Sendable {
    func now() async -> PresenceTime
}

struct SystemPresenceTimeSource: PresenceTimeProviding {
    private let clock = ContinuousClock()
    private let origin: ContinuousClock.Instant

    init() {
        origin = clock.now
    }

    func now() async -> PresenceTime {
        PresenceTime(
            wallClock: Date(),
            monotonic: origin.duration(to: clock.now)
        )
    }
}

protocol SocialDatabaseTransport: Sendable {
    func select<Row: Decodable & Sendable>(
        _ table: SocialTable,
        as type: Row.Type
    ) async throws -> [Row]

    func rpc<Parameters: Encodable & Sendable>(
        _ function: SocialRPC,
        parameters: Parameters
    ) async throws

    func rpc(_ function: SocialRPC) async throws
}

protocol SocialRepository: Sendable {
    func fetchSocialSnapshot() async throws -> SocialSnapshot
    func fetchVisiblePresence() async throws -> [PresenceState]
    func requestFriend(addresseeID: UUID) async throws
    func respondToFriendRequest(requesterID: UUID, accept: Bool) async throws
    func removeFriend(otherUserID: UUID) async throws
    func blockUser(otherUserID: UUID) async throws
    func unblockUser(otherUserID: UUID) async throws
    func setPresenceShare(viewerID: UUID, expiresAt: Date) async throws
    func revokePresenceShare(viewerID: UUID) async throws
    func setPresence(_ presence: ConfirmedPresence) async throws
    func clearPresence() async throws
    func setGhost(_ ghost: Bool) async throws
}
