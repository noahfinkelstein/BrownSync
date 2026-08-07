import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime

@testable import BrownSync

enum Phase5BoardTestFailure: Error, Equatable, Sendable {
    case unexpectedOperation(String)
    case unexpectedCall(String)
}

actor Phase5BoardTransport: ClientTransport {
    struct Stub: Sendable {
        let status: Int
        let json: String
    }

    struct Record: Sendable {
        let operationID: String
        let method: String
        let path: String
        let body: Data
    }

    private var responses: [String: [Stub]]
    private var captured: [Record] = []

    init(responses: [String: [Stub]] = [:]) {
        self.responses = responses
    }

    func enqueue(
        operationID: String,
        status: Int,
        json: String
    ) {
        responses[operationID, default: []].append(
            Stub(status: status, json: json)
        )
    }

    func records() -> [Record] {
        captured
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let bodyData: Data
        if let body {
            bodyData = try await Data(
                collecting: body,
                upTo: 1_048_576
            )
        } else {
            bodyData = Data()
        }
        captured.append(
            Record(
                operationID: operationID,
                method: request.method.rawValue,
                path: request.path ?? "",
                body: bodyData
            )
        )

        guard
            var queue = responses[operationID],
            !queue.isEmpty
        else {
            throw Phase5BoardTestFailure.unexpectedOperation(operationID)
        }
        let stub = queue.removeFirst()
        responses[operationID] = queue

        var fields = HTTPFields()
        fields[.contentType] = "application/json"
        return (
            HTTPResponse(
                status: HTTPResponse.Status(code: stub.status),
                headerFields: fields
            ),
            HTTPBody(stub.json)
        )
    }
}

actor Phase5BoardLogRecorder: BoardLogSink {
    private var captured: [BoardLogEvent] = []

    func record(_ event: BoardLogEvent) {
        captured.append(event)
    }

    func events() -> [BoardLogEvent] {
        captured
    }
}

actor Phase5BoardGate {
    private var isSuspended = false
    private var suspensionWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []

    func suspend() async {
        isSuspended = true
        let waiters = suspensionWaiters
        suspensionWaiters.removeAll()
        for waiter in waiters {
            waiter.resume()
        }
        await withCheckedContinuation { continuation in
            releaseWaiters.append(continuation)
        }
    }

    func waitUntilSuspended() async {
        guard !isSuspended else {
            return
        }
        await withCheckedContinuation { continuation in
            suspensionWaiters.append(continuation)
        }
    }

    func release() {
        let waiters = releaseWaiters
        releaseWaiters.removeAll()
        for waiter in waiters {
            waiter.resume()
        }
    }
}

actor Phase5BoardBlockingLogSink: BoardLogSink {
    private let gate: Phase5BoardGate
    private var captured: [BoardLogEvent] = []

    init(gate: Phase5BoardGate) {
        self.gate = gate
    }

    func record(_ event: BoardLogEvent) async {
        captured.append(event)
        await gate.suspend()
    }

    func events() -> [BoardLogEvent] {
        captured
    }
}

actor Phase5BoardCancellationTransport: ClientTransport {
    private var started = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    func waitUntilStarted() async {
        guard !started else {
            return
        }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func send(
        _: HTTPRequest,
        body _: HTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        started = true
        let waiters = startWaiters
        startWaiters.removeAll()
        for waiter in waiters {
            waiter.resume()
        }
        try await Task<Never, Never>.sleep(
            nanoseconds: 60_000_000_000
        )
        throw CancellationError()
    }
}

actor Phase5BoardUUIDSource: UUIDProviding {
    private var values: [UUID]
    private var count = 0

    init(_ values: [UUID]) {
        self.values = values
    }

    func next() async -> UUID {
        guard !values.isEmpty else {
            preconditionFailure("Unexpected UUID request")
        }
        count += 1
        return values.removeFirst()
    }

    func requestCount() -> Int {
        count
    }
}

actor Phase5BoardRepositoryFake: BoardRepository {
    private var calls: [String] = []
    private var statusValue = Phase5BoardFixture.status()
    private var feedValue = BoardFeedPage(posts: [], next: nil)
    private var paginatedFeedValue = BoardFeedPage(posts: [], next: nil)
    private var paginatedFeedGate: Phase5BoardGate?
    private var createFailure: BoardError?

    func setStatus(_ value: BoardStatus) {
        statusValue = value
    }

    func setFeed(_ value: BoardFeedPage) {
        feedValue = value
    }

    func setPaginatedFeed(
        _ value: BoardFeedPage,
        gate: Phase5BoardGate
    ) {
        paginatedFeedValue = value
        paginatedFeedGate = gate
    }

    func failCreate(with error: BoardError) {
        createFailure = error
    }

    func recordedCalls() -> [String] {
        calls
    }

    func status() async throws -> BoardStatus {
        calls.append("status")
        return statusValue
    }

    func feed(page: BoardPageRequest) async throws -> BoardFeedPage {
        calls.append("feed:\(page.cursor?.rawValue ?? "nil"):\(page.limit)")
        if page.cursor != nil {
            let value = paginatedFeedValue
            if let paginatedFeedGate {
                await paginatedFeedGate.suspend()
            }
            return value
        }
        return feedValue
    }

    func thread(
        postID: UUID,
        page _: BoardPageRequest
    ) async throws -> BoardThreadPage {
        throw Phase5BoardTestFailure.unexpectedCall(
            "thread:\(postID)"
        )
    }

    func ownContent(
        page _: BoardPageRequest
    ) async throws -> BoardOwnContentPage {
        throw Phase5BoardTestFailure.unexpectedCall("ownContent")
    }

    func createPost(
        _ command: BoardCreatePostCommand
    ) async throws -> BoardCreatePostResult {
        calls.append(
            "create:\(command.clientRequestID.uuidString.lowercased())"
        )
        if let createFailure {
            throw createFailure
        }
        return BoardCreatePostResult(
            postID: Phase5BoardFixture.postID,
            revision: 1,
            replayed: false
        )
    }

    func editPost(
        id _: UUID,
        command _: BoardEditPostCommand
    ) async throws -> BoardPostMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("editPost")
    }

    func deletePost(
        id _: UUID,
        expectedRevision _: Int
    ) async throws -> BoardPostMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("deletePost")
    }

    func createComment(
        _ command: BoardCreateCommentCommand
    ) async throws -> BoardCreateCommentResult {
        throw Phase5BoardTestFailure.unexpectedCall("createComment")
    }

    func editComment(
        id _: UUID,
        expectedRevision _: Int,
        body _: String
    ) async throws -> BoardCommentMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("editComment")
    }

    func deleteComment(
        id _: UUID,
        expectedRevision _: Int
    ) async throws -> BoardCommentMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("deleteComment")
    }

    func setVote(
        target _: BoardContentTarget,
        value _: BoardVoteValue
    ) async throws -> BoardVoteResult {
        throw Phase5BoardTestFailure.unexpectedCall("setVote")
    }

    func report(
        target _: BoardContentTarget,
        reason _: BoardReportReason,
        detail _: String?
    ) async throws -> BoardReportResult {
        throw Phase5BoardTestFailure.unexpectedCall("report")
    }

    func appealContent(
        _ command: BoardContentAppealCommand
    ) async throws -> BoardAppealResult {
        throw Phase5BoardTestFailure.unexpectedCall("appealContent")
    }

    func appealBan(
        _ command: BoardBanAppealCommand
    ) async throws -> BoardAppealResult {
        throw Phase5BoardTestFailure.unexpectedCall("appealBan")
    }
}

actor Phase5BoardModerationRepositoryFake:
    BoardModerationRepository
{
    private var calls: [String] = []
    private var failure: BoardError?

    func fail(with error: BoardError) {
        failure = error
    }

    func recordedCalls() -> [String] {
        calls
    }

    func moderationQueue(
        page _: BoardPageRequest
    ) async throws -> BoardModerationQueuePage {
        calls.append("moderation.queue")
        if let failure {
            throw failure
        }
        return BoardModerationQueuePage(items: [], next: nil)
    }

    func decideContent(
        _ command: BoardModerationDecisionCommand
    ) async throws -> BoardModerationDecisionResult {
        throw Phase5BoardTestFailure.unexpectedCall("decideContent")
    }

    func createBan(
        _ command: BoardCreateBanCommand
    ) async throws -> BoardBanResult {
        throw Phase5BoardTestFailure.unexpectedCall("createBan")
    }

    func revokeBan(
        _ command: BoardRevokeBanCommand
    ) async throws -> BoardBanRevokeResult {
        throw Phase5BoardTestFailure.unexpectedCall("revokeBan")
    }

    func decideAppeal(
        _ command: BoardAppealDecisionCommand
    ) async throws -> BoardAppealDecisionResult {
        throw Phase5BoardTestFailure.unexpectedCall("decideAppeal")
    }
}

actor Phase5BoardOwnerRepositoryFake: BoardOwnerRepository {
    private var calls: [String] = []
    private var failure: BoardError?

    func fail(with error: BoardError) {
        failure = error
    }

    func recordedCalls() -> [String] {
        calls
    }

    func config() async throws -> BoardConfig {
        calls.append("owner.config")
        if let failure {
            throw failure
        }
        return BoardConfig(
            enabled: true,
            autoHideThreshold: 3,
            updatedAt: Phase5BoardFixture.baseDate
        )
    }

    func updateConfig(
        _ command: BoardConfigUpdateCommand
    ) async throws -> BoardConfigMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("updateConfig")
    }

    func moderators(
        page _: BoardPageRequest
    ) async throws -> BoardModeratorPage {
        throw Phase5BoardTestFailure.unexpectedCall("moderators")
    }

    func upsertModerator(
        _ command: BoardModeratorUpsertCommand
    ) async throws -> BoardModeratorMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("upsertModerator")
    }

    func removeModerator(
        userID _: UUID
    ) async throws -> BoardModeratorMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("removeModerator")
    }
}

enum Phase5BoardFixture {
    static let actorID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000001"
    )!
    static let postID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000002"
    )!
    static let commentID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000003"
    )!
    static let banID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000004"
    )!
    static let appealID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000005"
    )!
    static let requestID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000006"
    )!
    static let moderatorID = UUID(
        uuidString: "51000000-0000-4000-8000-000000000007"
    )!
    static let baseDate = Date(timeIntervalSince1970: 1_785_456_000)
    static let cursor =
        "WyIyMDI2LTA3LTMwVDE4OjAwOjAwLjAwMFoiLCI1MTAwMDAwMC0wMDAw"
        + "LTQwMDAtODAwMC0wMDAwMDAwMDAwMDIiXQ"

    static let privacyNotice =
        "Posts are pseudonymous, not untraceable. BrownSync stores a stable anonymous identifier so it can enforce bans, rate limits, and abuse controls. The board database does not store your BrownSync account ID with your posts. Your posts can be linked to each other, and someone who obtained both BrownSync’s private board secret and a list of Brown account IDs could reconstruct that link. Board moderators do not see your name or email through the moderation tools."

    static let edgeNotice =
        "Cloudflare processes normal edge request metadata, including IP addresses, to deliver and protect the service."

    static func status(
        enabled: Bool = true,
        banned: Bool = false
    ) -> BoardStatus {
        BoardStatus(
            enabled: enabled,
            authorAlias: "Anonymous Otter 4F2A",
            ban: banned
                ? BoardBanSummary(
                    id: banID,
                    until: baseDate.addingTimeInterval(3_600),
                    reason: "Safety"
                )
                : nil,
            pendingAppeals: 0,
            privacyNotice: privacyNotice,
            edgeMetadataNotice: edgeNotice
        )
    }

    static func post(
        id: UUID = postID,
        body: String = "What should BrownSync build?"
    ) -> BoardPost {
        BoardPost(
            id: id,
            title: "Question",
            body: body,
            visibility: .visible,
            moderationEpoch: 0,
            score: 4,
            revision: 2,
            authorAlias: "Anonymous Otter 4F2A",
            isMine: true,
            commentCount: 1,
            myVote: .up,
            createdAt: baseDate,
            updatedAt: baseDate.addingTimeInterval(60)
        )
    }

    static func ownContentItem() -> BoardOwnContentItem {
        BoardOwnContentItem(
            contentType: .post,
            id: postID,
            postID: postID,
            parentCommentID: nil,
            title: nil,
            body: nil,
            visibility: .authorDeleted,
            moderationEpoch: 0,
            score: 0,
            revision: 3,
            authorAlias: "Anonymous Otter 4F2A",
            isMine: true,
            createdAt: baseDate,
            updatedAt: baseDate.addingTimeInterval(120)
        )
    }

    static let statusJSON =
        """
        {
          "enabled":true,
          "authorAlias":"Anonymous Otter 4F2A",
          "banned":false,
          "banId":null,
          "bannedUntil":null,
          "banReason":null,
          "pendingAppeals":0,
          "privacyNotice":"\(privacyNotice)",
          "edgeMetadataNotice":"\(edgeNotice)"
        }
        """

    static let feedJSON =
        """
        {
          "posts":[{
            "id":"\(postID.uuidString.lowercased())",
            "title":"Question",
            "body":"What should BrownSync build?",
            "visibility":"visible",
            "moderationEpoch":0,
            "score":4,
            "revision":2,
            "authorAlias":"Anonymous Otter 4F2A",
            "isMine":true,
            "commentCount":1,
            "myVote":1,
            "createdAt":"2026-07-30T18:00:00.000Z",
            "updatedAt":"2026-07-30T18:01:00.000Z"
          }],
          "nextCursor":null
        }
        """

    static let threadJSON =
        """
        {
          "post":{
            "id":"\(postID.uuidString.lowercased())",
            "title":"Question",
            "body":"What should BrownSync build?",
            "visibility":"visible",
            "moderationEpoch":0,
            "score":4,
            "revision":2,
            "authorAlias":"Anonymous Otter 4F2A",
            "isMine":true,
            "myVote":1,
            "createdAt":"2026-07-30T18:00:00.000Z",
            "updatedAt":"2026-07-30T18:01:00.000Z"
          },
          "comments":[],
          "nextCursor":null
        }
        """

    static let ownJSON =
        """
        {
          "items":[{
            "contentType":"post",
            "id":"\(postID.uuidString.lowercased())",
            "postId":"\(postID.uuidString.lowercased())",
            "parentCommentId":null,
            "title":null,
            "body":null,
            "visibility":"author_deleted",
            "moderationEpoch":0,
            "score":0,
            "revision":3,
            "authorAlias":"Anonymous Otter 4F2A",
            "isMine":true,
            "createdAt":"2026-07-30T18:00:00.000Z",
            "updatedAt":"2026-07-30T18:02:00.000Z"
          }],
          "nextCursor":null
        }
        """
}

func phase5BoardJSONObject(
    _ data: Data
) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
}
