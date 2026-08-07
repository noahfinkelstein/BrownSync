import Foundation

struct BoardCursor: RawRepresentable, Hashable, Sendable {
    let rawValue: String

    init?(rawValue: String) {
        guard
            !rawValue.isEmpty,
            rawValue.utf8.count <= 256,
            rawValue.utf8.allSatisfy({
                ($0 >= 48 && $0 <= 57)
                    || ($0 >= 65 && $0 <= 90)
                    || ($0 >= 97 && $0 <= 122)
                    || $0 == 45
                    || $0 == 95
            })
        else {
            return nil
        }
        self.rawValue = rawValue
    }
}

struct BoardPageRequest: Equatable, Sendable {
    let cursor: BoardCursor?
    let limit: Int

    init(cursor: BoardCursor? = nil, limit: Int = 25) throws {
        guard (1...50).contains(limit) else {
            throw BoardError.invalidPage
        }
        self.cursor = cursor
        self.limit = limit
    }
}

enum BoardContentTarget: Equatable, Sendable {
    case post(UUID)
    case comment(UUID)
}

enum BoardModerationTarget: Equatable, Sendable {
    case post(UUID)
    case comment(UUID)
    case ban(UUID)
}

enum BoardContentType: String, Equatable, Sendable {
    case post
    case comment
}

enum BoardModerationQueueKind: String, Equatable, Sendable {
    case report
    case appeal
}

enum BoardVoteValue: Int, Equatable, Sendable {
    case down = -1
    case none = 0
    case up = 1
}

enum BoardReportReason: String, CaseIterable, Equatable, Sendable {
    case harassment
    case hate
    case threat
    case sexual
    case personalInfo = "personal_info"
    case spam
    case other
}

enum BoardVisibility: String, Equatable, Sendable {
    case visible
    case autoHidden = "auto_hidden"
    case moderatorHidden = "moderator_hidden"
    case removed
    case authorDeleted = "author_deleted"
    case accountDeleted = "account_deleted"
}

enum BoardAppealState: String, Equatable, Sendable {
    case pending
    case approved
    case denied
}

enum BoardModerationAction: String, Equatable, Sendable {
    case hide
    case remove
    case restore
    case dismiss
}

enum BoardAppealDecision: String, Equatable, Sendable {
    case approved
    case denied
}

enum BoardModeratorRole: String, Equatable, Sendable {
    case moderator
    case owner
}

enum BoardError: Error, Equatable, Sendable {
    case invalidPage
    case invalidRequest
    case authenticationRequired
    case brownMembershipRequired
    case authorityRequired
    case banned
    case notFound
    case conflict
    case quotaLimited
    case disabled
    case unavailable
    case invalidResponse
}

struct BoardBanSummary: Equatable, Sendable {
    let id: UUID
    let until: Date
    let reason: String
}

struct BoardStatus: Equatable, Sendable {
    let enabled: Bool
    let authorAlias: String
    let ban: BoardBanSummary?
    let pendingAppeals: Int
    let privacyNotice: String
    let edgeMetadataNotice: String
}

struct BoardPost: Equatable, Sendable, Identifiable {
    let id: UUID
    let title: String?
    let body: String
    let visibility: BoardVisibility
    let moderationEpoch: Int
    let score: Int
    let revision: Int
    let authorAlias: String
    let isMine: Bool
    let commentCount: Int?
    let myVote: BoardVoteValue
    let createdAt: Date
    let updatedAt: Date
}

struct BoardComment: Equatable, Sendable, Identifiable {
    let id: UUID
    let postID: UUID
    let parentCommentID: UUID?
    let body: String
    let visibility: BoardVisibility
    let moderationEpoch: Int
    let score: Int
    let revision: Int
    let authorAlias: String
    let isMine: Bool
    let myVote: BoardVoteValue
    let createdAt: Date
    let updatedAt: Date
}

struct BoardOwnContentItem: Equatable, Sendable, Identifiable {
    let contentType: BoardContentType
    let id: UUID
    let postID: UUID
    let parentCommentID: UUID?
    let title: String?
    let body: String?
    let visibility: BoardVisibility
    let moderationEpoch: Int
    let score: Int
    let revision: Int
    let authorAlias: String
    let isMine: Bool
    let createdAt: Date
    let updatedAt: Date
}

struct BoardModerationQueueItem: Equatable, Sendable, Identifiable {
    var id: UUID {
        queueID
    }

    let queueKind: BoardModerationQueueKind
    let queueID: UUID
    let target: BoardModerationTarget
    let postID: UUID?
    let parentCommentID: UUID?
    let title: String?
    let body: String?
    let visibility: BoardVisibility?
    let moderationEpoch: Int?
    let score: Int?
    let openReportCount: Int
    let reportReasons: [BoardReportReason]
    let appealBody: String?
    let createdAt: Date
    let updatedAt: Date
}

struct BoardFeedPage: Equatable, Sendable {
    let posts: [BoardPost]
    let next: BoardCursor?
}

struct BoardThreadPage: Equatable, Sendable {
    let post: BoardPost
    let comments: [BoardComment]
    let next: BoardCursor?
}

struct BoardOwnContentPage: Equatable, Sendable {
    let items: [BoardOwnContentItem]
    let next: BoardCursor?
}

struct BoardModerationQueuePage: Equatable, Sendable {
    let items: [BoardModerationQueueItem]
    let next: BoardCursor?
}

struct BoardModeratorPage: Equatable, Sendable {
    let moderators: [BoardModeratorMembership]
    let next: BoardCursor?
}

struct BoardCreatePostCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let title: String?
    let body: String
}

enum BoardEditField<Value: Equatable & Sendable>: Equatable, Sendable {
    case unchanged
    case set(Value)
    case clear
}

struct BoardEditPostCommand: Equatable, Sendable {
    let expectedRevision: Int
    let title: BoardEditField<String>
    let body: BoardEditField<String>

    init(
        expectedRevision: Int,
        title: BoardEditField<String>,
        body: BoardEditField<String>
    ) throws {
        guard expectedRevision > 0 else {
            throw BoardError.invalidRequest
        }
        guard title != .unchanged || body != .unchanged else {
            throw BoardError.invalidRequest
        }
        guard body != .clear else {
            throw BoardError.invalidRequest
        }
        self.expectedRevision = expectedRevision
        self.title = title
        self.body = body
    }
}

struct BoardCreateCommentCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let postID: UUID
    let parentCommentID: UUID?
    let body: String
}

struct BoardContentAppealCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let target: BoardContentTarget
    let targetEpoch: Int
    let body: String
}

struct BoardBanAppealCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let banID: UUID
    let body: String
}

struct BoardModerationDecisionCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let target: BoardContentTarget
    let expectedEpoch: Int
    let action: BoardModerationAction
    let reason: String
}

struct BoardCreateBanCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let target: BoardContentTarget
    let durationSeconds: Int
    let reason: String
    let note: String?
}

struct BoardRevokeBanCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let banID: UUID
    let reason: String
}

struct BoardAppealDecisionCommand: Equatable, Sendable {
    let clientRequestID: UUID
    let appealID: UUID
    let decision: BoardAppealDecision
    let reason: String
}

struct BoardConfigUpdateCommand: Equatable, Sendable {
    let enabled: Bool
    let autoHideThreshold: Int
}

struct BoardModeratorUpsertCommand: Equatable, Sendable {
    let userID: UUID
    let role: BoardModeratorRole
}

struct BoardCreatePostResult: Equatable, Sendable {
    let postID: UUID
    let revision: Int
    let replayed: Bool
}

struct BoardPostMutationResult: Equatable, Sendable {
    let postID: UUID
    let revision: Int
    let changed: Bool
}

struct BoardCreateCommentResult: Equatable, Sendable {
    let commentID: UUID
    let postID: UUID
    let revision: Int
    let replayed: Bool
}

struct BoardCommentMutationResult: Equatable, Sendable {
    let commentID: UUID
    let revision: Int
    let changed: Bool
}

struct BoardVoteResult: Equatable, Sendable {
    let target: BoardContentTarget
    let value: BoardVoteValue
    let score: Int
    let changed: Bool
}

struct BoardReportResult: Equatable, Sendable {
    let reportID: UUID
    let targetEpoch: Int
    let visibility: BoardVisibility
    let revision: Int
    let autoHidden: Bool
    let replayed: Bool
}

struct BoardAppealResult: Equatable, Sendable {
    let appealID: UUID
    let state: BoardAppealState
    let replayed: Bool
}

struct BoardModerationDecisionResult: Equatable, Sendable {
    let target: BoardContentTarget
    let visibility: BoardVisibility
    let moderationEpoch: Int
    let revision: Int
    let replayed: Bool
}

struct BoardBanResult: Equatable, Sendable {
    let id: UUID
    let expiresAt: Date
    let replayed: Bool
}

struct BoardBanRevokeResult: Equatable, Sendable {
    let id: UUID
    let revokedAt: Date
    let changed: Bool
    let replayed: Bool
}

struct BoardAppealDecisionResult: Equatable, Sendable {
    let appealID: UUID
    let state: BoardAppealState
    let target: BoardModerationTarget
    let changed: Bool
    let replayed: Bool
}

struct BoardConfig: Equatable, Sendable {
    let enabled: Bool
    let autoHideThreshold: Int
    let updatedAt: Date
}

struct BoardConfigMutationResult: Equatable, Sendable {
    let enabled: Bool
    let autoHideThreshold: Int
    let updatedAt: Date
    let changed: Bool
}

struct BoardModeratorMembership: Equatable, Sendable, Identifiable {
    var id: UUID {
        userID
    }

    let userID: UUID
    let role: BoardModeratorRole
    let grantedBy: UUID?
    let grantedAt: Date
}

struct BoardModeratorMutationResult: Equatable, Sendable {
    let userID: UUID
    let role: BoardModeratorRole?
    let changed: Bool
}

protocol BoardRepository: Sendable {
    func status() async throws -> BoardStatus
    func feed(page: BoardPageRequest) async throws -> BoardFeedPage
    func thread(
        postID: UUID,
        page: BoardPageRequest
    ) async throws -> BoardThreadPage
    func ownContent(page: BoardPageRequest) async throws
        -> BoardOwnContentPage
    func createPost(_ command: BoardCreatePostCommand) async throws
        -> BoardCreatePostResult
    func editPost(
        id: UUID,
        command: BoardEditPostCommand
    ) async throws -> BoardPostMutationResult
    func deletePost(
        id: UUID,
        expectedRevision: Int
    ) async throws -> BoardPostMutationResult
    func createComment(_ command: BoardCreateCommentCommand) async throws
        -> BoardCreateCommentResult
    func editComment(
        id: UUID,
        expectedRevision: Int,
        body: String
    ) async throws -> BoardCommentMutationResult
    func deleteComment(
        id: UUID,
        expectedRevision: Int
    ) async throws -> BoardCommentMutationResult
    func setVote(
        target: BoardContentTarget,
        value: BoardVoteValue
    ) async throws -> BoardVoteResult
    func report(
        target: BoardContentTarget,
        reason: BoardReportReason,
        detail: String?
    ) async throws -> BoardReportResult
    func appealContent(_ command: BoardContentAppealCommand) async throws
        -> BoardAppealResult
    func appealBan(_ command: BoardBanAppealCommand) async throws
        -> BoardAppealResult
}

protocol BoardModerationRepository: Sendable {
    func moderationQueue(page: BoardPageRequest) async throws
        -> BoardModerationQueuePage
    func decideContent(
        _ command: BoardModerationDecisionCommand
    ) async throws -> BoardModerationDecisionResult
    func createBan(_ command: BoardCreateBanCommand) async throws
        -> BoardBanResult
    func revokeBan(_ command: BoardRevokeBanCommand) async throws
        -> BoardBanRevokeResult
    func decideAppeal(
        _ command: BoardAppealDecisionCommand
    ) async throws -> BoardAppealDecisionResult
}

protocol BoardOwnerRepository: Sendable {
    func config() async throws -> BoardConfig
    func updateConfig(_ command: BoardConfigUpdateCommand) async throws
        -> BoardConfigMutationResult
    func moderators(page: BoardPageRequest) async throws
        -> BoardModeratorPage
    func upsertModerator(
        _ command: BoardModeratorUpsertCommand
    ) async throws -> BoardModeratorMutationResult
    func removeModerator(userID: UUID) async throws
        -> BoardModeratorMutationResult
}

protocol BoardLogSink: Sendable {
    func record(_ event: BoardLogEvent) async
}

struct BoardLogEvent: Equatable, Sendable {
    let operation: BoardOperation
    let outcome: BoardLogOutcome
}

enum BoardOperation: CaseIterable, Equatable, Sendable {
    case status
    case feed
    case thread
    case ownContent
    case createPost
    case editPost
    case deletePost
    case createComment
    case editComment
    case deleteComment
    case vote
    case report
    case appealContent
    case appealBan
    case moderationQueue
    case moderationDecision
    case createBan
    case revokeBan
    case appealDecision
    case config
    case updateConfig
    case moderators
    case upsertModerator
    case removeModerator
}

enum BoardLogFailure: Equatable, Sendable {
    case invalidRequest
    case authenticationRequired
    case brownMembershipRequired
    case authorityRequired
    case banned
    case notFound
    case conflict
    case quotaLimited
    case unavailable
    case invalidResponse
}

enum BoardLogOutcome: Equatable, Sendable {
    case succeeded
    case failed(BoardLogFailure)
}

struct BoardMemberPermissions: Equatable, Sendable {
    let canRead: Bool
    let canCreate: Bool
    let canVote: Bool
    let canReport: Bool
    let canDeleteOwnContent: Bool
    let canAppeal: Bool

    static let active = BoardMemberPermissions(
        canRead: true,
        canCreate: true,
        canVote: true,
        canReport: true,
        canDeleteOwnContent: true,
        canAppeal: true
    )

    static let banned = BoardMemberPermissions(
        canRead: true,
        canCreate: false,
        canVote: false,
        canReport: false,
        canDeleteOwnContent: true,
        canAppeal: true
    )
}

struct BoardLoadedState: Equatable, Sendable {
    let status: BoardStatus
    let feed: BoardFeedPage
    let permissions: BoardMemberPermissions
    let availability: BoardStatePresentation
}

enum BoardScreenState: Equatable, Sendable {
    case authenticationRequired
    case loading
    case disabled(BoardStatePresentation)
    case loaded(BoardLoadedState)
    case quotaLimited(BoardStatePresentation)
    case conflict(BoardStatePresentation)
    case failed(BoardError, BoardStatePresentation)
}

enum BoardModerationScreenState: Equatable, Sendable {
    case authenticationRequired
    case loading
    case authorityRequired
    case loaded(BoardModerationQueuePage)
    case failed(BoardError, BoardStatePresentation)
}

enum BoardOwnerScreenState: Equatable, Sendable {
    case authenticationRequired
    case loading
    case authorityRequired
    case loaded(config: BoardConfig, moderators: BoardModeratorPage?)
    case failed(BoardError, BoardStatePresentation)
}

struct BoardStatePresentation: Equatable, Sendable {
    let title: String
    let message: String
    let systemImage: String
    let accessibilityLabel: String
    let accessibilityValue: String?
    let accessibilityHint: String?

    static func make(for state: BoardSemanticState)
        -> BoardStatePresentation
    {
        let title: String
        let message: String
        let systemImage: String
        let value: String?
        let hint: String?

        switch state {
        case .authenticationRequired:
            title = "Brown sign-in required"
            message = "Sign in with an admitted Brown account to use Board."
            systemImage = "lock"
            value = "Signed out"
            hint = "Sign in to continue."
        case .authorityRequired:
            title = "Board access unavailable"
            message = "Your account does not have access to these Board controls."
            systemImage = "hand.raised"
            value = "Permission required"
            hint = nil
        case .enabled:
            title = "Board is available"
            message = "Pseudonymous posting is enabled."
            systemImage = "checkmark.circle"
            value = "Enabled"
            hint = nil
        case .disabled:
            title = "Board is unavailable"
            message = "Board posting is currently disabled."
            systemImage = "pause.circle"
            value = "Disabled"
            hint = "Try again later."
        case .banned:
            title = "Posting suspended"
            message =
                "You can read, delete your content, and appeal, but cannot create, vote, or report."
            systemImage = "exclamationmark.shield"
            value = "Read-only access"
            hint = "Review the ban details or submit an appeal."
        case .quotaLimited:
            title = "Request limit reached"
            message = "Board could not complete this action right now."
            systemImage = "clock"
            value = "Temporarily limited"
            hint = "Try again later."
        case .conflict:
            title = "Board content changed"
            message = "Reload the latest content before trying this action again."
            systemImage = "arrow.triangle.2.circlepath"
            value = "Conflict"
            hint = "Reload to continue."
        case .unavailable:
            title = "Board unavailable"
            message = "The Board service cannot be reached right now."
            systemImage = "wifi.exclamationmark"
            value = "Unavailable"
            hint = "Try again later."
        case .voteSelected:
            title = "Vote selected"
            message = "Your selected vote is active."
            systemImage = "checkmark.circle.fill"
            value = "Selected"
            hint = "Activate again to change your vote."
        case .autoHidden:
            title = "Automatically hidden"
            message = "This content is hidden while it awaits review."
            systemImage = "eye.slash"
            value = "Hidden"
            hint = nil
        case .moderatorHidden:
            title = "Hidden by moderation"
            message = "A moderator has hidden this content."
            systemImage = "hand.raised.slash"
            value = "Hidden"
            hint = nil
        case .removed:
            title = "Removed"
            message = "This content was removed by moderation."
            systemImage = "trash"
            value = "Removed"
            hint = nil
        case .appealPending:
            title = "Appeal pending"
            message = "Your appeal is waiting for review."
            systemImage = "hourglass"
            value = "Pending"
            hint = nil
        case .appealApproved:
            title = "Appeal approved"
            message = "The appeal was approved."
            systemImage = "checkmark.seal"
            value = "Approved"
            hint = nil
        case .appealDenied:
            title = "Appeal denied"
            message = "The appeal was denied."
            systemImage = "xmark.seal"
            value = "Denied"
            hint = nil
        }

        return BoardStatePresentation(
            title: title,
            message: message,
            systemImage: systemImage,
            accessibilityLabel: "\(title). \(message)",
            accessibilityValue: value,
            accessibilityHint: hint
        )
    }
}

enum BoardSemanticState: CaseIterable, Equatable, Sendable {
    case authenticationRequired
    case authorityRequired
    case enabled
    case disabled
    case banned
    case quotaLimited
    case conflict
    case unavailable
    case voteSelected
    case autoHidden
    case moderatorHidden
    case removed
    case appealPending
    case appealApproved
    case appealDenied
}

enum BoardLifecycleEvent: Equatable, Sendable {
    case sceneBackgrounded
    case authExpired
    case signedOut
    case accountDeleted
}
