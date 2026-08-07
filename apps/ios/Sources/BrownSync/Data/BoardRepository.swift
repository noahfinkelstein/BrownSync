import BrownSyncAPI
import Foundation

final class WorkerBoardRepository:
    BoardRepository,
    BoardModerationRepository,
    BoardOwnerRepository,
    Sendable
{
    let client: BrownSyncAPI.Client
    let cache: BoardMemoryCache
    let logger: any BoardLogSink
    let lease: BoardSessionLease?

    init(
        client: BrownSyncAPI.Client,
        cache: BoardMemoryCache,
        logger: any BoardLogSink,
        lease: BoardSessionLease? = nil
    ) {
        self.client = client
        self.cache = cache
        self.logger = logger
        self.lease = lease
    }

    func status() async throws -> BoardStatus {
        let token = await cache.writeToken(for: .member)
        let value = try await run(operation: .status) { [client] in
            let output = try await client.getBoardStatus()
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.status(from: payload)
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
        await cache.replaceStatus(value, ifCurrent: token)
        return value
    }

    func feed(page: BoardPageRequest) async throws -> BoardFeedPage {
        let token = await cache.writeToken(for: .member)
        let value = try await run(operation: .feed) { [client] in
            let output = try await client.getBoardFeed(
                .init(
                    query: .init(
                        cursor: page.cursor?.rawValue,
                        limit: page.limit
                    )
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.feed(from: payload)
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
        await cache.replaceFeed(value, ifCurrent: token)
        return value
    }

    func thread(
        postID: UUID,
        page: BoardPageRequest
    ) async throws -> BoardThreadPage {
        let token = await cache.writeToken(for: .member)
        let value = try await run(operation: .thread) { [client] in
            let output = try await client.getBoardThread(
                .init(
                    path: .init(postId: Self.id(postID)),
                    query: .init(
                        cursor: page.cursor?.rawValue,
                        limit: page.limit
                    )
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    let result = try Self.thread(from: payload)
                    guard result.post.id == postID else {
                        throw BoardError.invalidResponse
                    }
                    return result
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
        await cache.replaceThread(value, ifCurrent: token)
        return value
    }

    func ownContent(
        page: BoardPageRequest
    ) async throws -> BoardOwnContentPage {
        let token = await cache.writeToken(for: .member)
        let value = try await run(operation: .ownContent) { [client] in
            let output = try await client.getOwnBoardContent(
                .init(
                    query: .init(
                        cursor: page.cursor?.rawValue,
                        limit: page.limit
                    )
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.ownContent(from: payload)
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
        await cache.replaceOwnContent(value, ifCurrent: token)
        return value
    }

    private func run<Value: Sendable>(
        operation: BoardOperation,
        beforeLogging: (BoardError?) async -> Void = { _ in },
        work: () async throws -> Value
    ) async throws -> Value {
        do {
            let leaseToken = try requireCurrentLease()
            let value = try await work()
            try validateCurrentLease(leaseToken)
            await beforeLogging(nil)
            await logger.record(
                BoardLogEvent(operation: operation, outcome: .succeeded)
            )
            try validateCurrentLease(leaseToken)
            return value
        } catch is CancellationError {
            await beforeLogging(nil)
            throw CancellationError()
        } catch {
            let normalized = Self.normalized(error)
            await beforeLogging(normalized)
            await logger.record(
                BoardLogEvent(
                    operation: operation,
                    outcome: .failed(Self.logFailure(for: normalized))
                )
            )
            throw normalized
        }
    }

    private func requireCurrentLease() throws
        -> BoardSessionLeaseToken?
    {
        guard let lease else {
            return nil
        }
        guard
            let token = BoardSessionLeaseScope.token,
            lease.isCurrent(token)
        else {
            throw BoardError.authenticationRequired
        }
        return token
    }

    private func validateCurrentLease(
        _ token: BoardSessionLeaseToken?
    ) throws {
        guard let lease else {
            return
        }
        guard
            let token,
            lease.isCurrent(token)
        else {
            throw BoardError.authenticationRequired
        }
    }

    private func runMutation<Value: Sendable>(
        kind: BoardMutationKind,
        operation: BoardOperation,
        _ work: () async throws -> Value
    ) async throws -> Value {
        try await run(
            operation: operation,
            beforeLogging: { _ in
                await cache.purge(reason: .mutation(kind))
            },
            work: work
        )
    }

    private static func normalized(_ error: Error) -> BoardError {
        if let value = error as? BoardError {
            return value
        }
        if error is URLError {
            return .unavailable
        }
        return .invalidResponse
    }

    private static func logFailure(
        for error: BoardError
    ) -> BoardLogFailure {
        switch error {
        case .invalidPage, .invalidRequest:
            return .invalidRequest
        case .authenticationRequired:
            return .authenticationRequired
        case .brownMembershipRequired:
            return .brownMembershipRequired
        case .authorityRequired:
            return .authorityRequired
        case .banned:
            return .banned
        case .notFound:
            return .notFound
        case .conflict:
            return .conflict
        case .quotaLimited:
            return .quotaLimited
        case .disabled, .unavailable:
            return .unavailable
        case .invalidResponse:
            return .invalidResponse
        }
    }

    private static func error(
        status: Int,
        envelope: Components.Schemas.ErrorEnvelope
    ) -> BoardError {
        error(status: status, code: envelope.error.code)
    }

    private static func error(
        status: Int,
        code: String?
    ) -> BoardError {
        switch (status, code) {
        case (400, _):
            return .invalidRequest
        case (401, _):
            return .authenticationRequired
        case (403, "brown_membership_required"):
            return .brownMembershipRequired
        case (403, "board_banned"):
            return .banned
        case (403, "board_forbidden"):
            return .authorityRequired
        case (403, _):
            return .authorityRequired
        case (404, _):
            return .notFound
        case (409, _):
            return .conflict
        case (429, _):
            return .quotaLimited
        case (503, _):
            return .unavailable
        default:
            return .invalidResponse
        }
    }

    private static func id(_ value: UUID) -> String {
        value.uuidString.lowercased()
    }
}

extension WorkerBoardRepository {
    func createPost(
        _ command: BoardCreatePostCommand
    ) async throws -> BoardCreatePostResult {
        try await runMutation(
            kind: .createPost,
            operation: .createPost
        ) { [client] in
            guard
                Self.isValidTitle(command.title),
                Self.isValidBody(command.body)
            else {
                throw BoardError.invalidRequest
            }
            let output = try await client.createBoardPost(
                .init(
                    body: .json(
                        .init(
                            clientRequestId: Self.id(
                                command.clientRequestID
                            ),
                            title: command.title,
                            body: command.body
                        )
                    )
                )
            )
            switch output {
            case .created(let response):
                switch response.body {
                case .json(let payload):
                    guard
                        let postID = UUID(uuidString: payload.postId),
                        payload.revision > 0
                    else {
                        throw BoardError.invalidResponse
                    }
                    return BoardCreatePostResult(
                        postID: postID,
                        revision: payload.revision,
                        replayed: payload.replayed
                    )
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func editPost(
        id: UUID,
        command: BoardEditPostCommand
    ) async throws -> BoardPostMutationResult {
        try await runMutation(kind: .editPost, operation: .editPost) {
            [client] in
            let title = try Self.generatedTitle(command.title)
            let body = try Self.generatedBody(command.body)
            let request = Components.Schemas.BoardEditPostRequest(
                value2: .init(
                    version: 2,
                    expectedRevision: command.expectedRevision,
                    patch: .init(title: title, body: body)
                )
            )
            let output = try await client.editBoardPost(
                .init(
                    path: .init(postId: Self.id(id)),
                    body: .json(request)
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.postMutation(
                        from: payload,
                        expectedID: id
                    )
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func deletePost(
        id: UUID,
        expectedRevision: Int
    ) async throws -> BoardPostMutationResult {
        try await runMutation(
            kind: .deletePost,
            operation: .deletePost
        ) { [client] in
            guard expectedRevision > 0 else {
                throw BoardError.invalidRequest
            }
            let output = try await client.deleteBoardPost(
                .init(
                    path: .init(postId: Self.id(id)),
                    body: .json(
                        .init(expectedRevision: expectedRevision)
                    )
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.postMutation(
                        from: payload,
                        expectedID: id
                    )
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func createComment(
        _ command: BoardCreateCommentCommand
    ) async throws -> BoardCreateCommentResult {
        try await runMutation(
            kind: .createComment,
            operation: .createComment
        ) { [client] in
            guard Self.isValidCommentBody(command.body) else {
                throw BoardError.invalidRequest
            }
            let output = try await client.createBoardComment(
                .init(
                    path: .init(postId: Self.id(command.postID)),
                    body: .json(
                        .init(
                            clientRequestId: Self.id(
                                command.clientRequestID
                            ),
                            parentCommentId: command.parentCommentID.map(
                                Self.id
                            ),
                            body: command.body
                        )
                    )
                )
            )
            switch output {
            case .created(let response):
                switch response.body {
                case .json(let payload):
                    guard
                        let commentID = UUID(
                            uuidString: payload.commentId
                        ),
                        let postID = UUID(uuidString: payload.postId),
                        postID == command.postID,
                        payload.revision > 0
                    else {
                        throw BoardError.invalidResponse
                    }
                    return BoardCreateCommentResult(
                        commentID: commentID,
                        postID: postID,
                        revision: payload.revision,
                        replayed: payload.replayed
                    )
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func editComment(
        id: UUID,
        expectedRevision: Int,
        body: String
    ) async throws -> BoardCommentMutationResult {
        try await runMutation(
            kind: .editComment,
            operation: .editComment
        ) { [client] in
            guard
                expectedRevision > 0,
                Self.isValidCommentBody(body)
            else {
                throw BoardError.invalidRequest
            }
            let output = try await client.editBoardComment(
                .init(
                    path: .init(commentId: Self.id(id)),
                    body: .json(
                        .init(
                            expectedRevision: expectedRevision,
                            body: body
                        )
                    )
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.commentMutation(
                        from: payload,
                        expectedID: id
                    )
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func deleteComment(
        id: UUID,
        expectedRevision: Int
    ) async throws -> BoardCommentMutationResult {
        try await runMutation(
            kind: .deleteComment,
            operation: .deleteComment
        ) { [client] in
            guard expectedRevision > 0 else {
                throw BoardError.invalidRequest
            }
            let output = try await client.deleteBoardComment(
                .init(
                    path: .init(commentId: Self.id(id)),
                    body: .json(
                        .init(expectedRevision: expectedRevision)
                    )
                )
            )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return try Self.commentMutation(
                        from: payload,
                        expectedID: id
                    )
                }
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func setVote(
        target: BoardContentTarget,
        value: BoardVoteValue
    ) async throws -> BoardVoteResult {
        try await runMutation(kind: .vote, operation: .vote) {
            [client] in
            let request = Components.Schemas.BoardVoteRequest(
                value: .init(value1: Double(value.rawValue))
            )
            let payload: Components.Schemas.BoardVoteResult
            switch target {
            case .post(let postID):
                let output = try await client.setBoardPostVote(
                    .init(
                        path: .init(postId: Self.id(postID)),
                        body: .json(request)
                    )
                )
                payload = try Self.votePayload(from: output)
            case .comment(let commentID):
                let output = try await client.setBoardCommentVote(
                    .init(
                        path: .init(commentId: Self.id(commentID)),
                        body: .json(request)
                    )
                )
                payload = try Self.votePayload(from: output)
            }
            return try Self.voteResult(
                from: payload,
                expectedTarget: target
            )
        }
    }

    func report(
        target: BoardContentTarget,
        reason: BoardReportReason,
        detail: String?
    ) async throws -> BoardReportResult {
        try await runMutation(kind: .report, operation: .report) {
            [client] in
            guard
                detail.map(Self.isValidReportDetail) ?? true
            else {
                throw BoardError.invalidRequest
            }
            let request = Components.Schemas.BoardReportRequest(
                reason: Self.generated(reason),
                detail: detail
            )
            let payload: Components.Schemas.BoardReportResult
            switch target {
            case .post(let postID):
                let output = try await client.reportBoardPost(
                    .init(
                        path: .init(postId: Self.id(postID)),
                        body: .json(request)
                    )
                )
                payload = try Self.reportPayload(from: output)
            case .comment(let commentID):
                let output = try await client.reportBoardComment(
                    .init(
                        path: .init(commentId: Self.id(commentID)),
                        body: .json(request)
                    )
                )
                payload = try Self.reportPayload(from: output)
            }
            guard
                let reportID = UUID(uuidString: payload.reportId),
                payload.targetEpoch >= 0,
                payload.revision > 0
            else {
                throw BoardError.invalidResponse
            }
            return BoardReportResult(
                reportID: reportID,
                targetEpoch: payload.targetEpoch,
                visibility: Self.visibility(from: payload.visibility),
                revision: payload.revision,
                autoHidden: payload.autoHidden,
                replayed: payload.replayed
            )
        }
    }

    func appealContent(
        _ command: BoardContentAppealCommand
    ) async throws -> BoardAppealResult {
        try await runMutation(
            kind: .appealContent,
            operation: .appealContent
        ) { [client] in
            guard
                command.targetEpoch >= 0,
                Self.isValidAppealBody(command.body)
            else {
                throw BoardError.invalidRequest
            }
            let request = Components.Schemas.BoardContentAppealRequest(
                clientRequestId: Self.id(command.clientRequestID),
                targetEpoch: command.targetEpoch,
                body: command.body
            )
            let payload: Components.Schemas.BoardAppealResult
            switch command.target {
            case .post(let postID):
                let output = try await client.appealBoardPost(
                    .init(
                        path: .init(postId: Self.id(postID)),
                        body: .json(request)
                    )
                )
                payload = try Self.appealPayload(from: output)
            case .comment(let commentID):
                let output = try await client.appealBoardComment(
                    .init(
                        path: .init(commentId: Self.id(commentID)),
                        body: .json(request)
                    )
                )
                payload = try Self.appealPayload(from: output)
            }
            return try Self.appealResult(from: payload)
        }
    }

    func appealBan(
        _ command: BoardBanAppealCommand
    ) async throws -> BoardAppealResult {
        try await runMutation(
            kind: .appealBan,
            operation: .appealBan
        ) { [client] in
            guard Self.isValidAppealBody(command.body) else {
                throw BoardError.invalidRequest
            }
            let output = try await client.appealBoardBan(
                .init(
                    path: .init(banId: Self.id(command.banID)),
                    body: .json(
                        .init(
                            clientRequestId: Self.id(
                                command.clientRequestID
                            ),
                            body: command.body
                        )
                    )
                )
            )
            return try Self.appealResult(
                from: Self.appealPayload(from: output)
            )
        }
    }
}

extension WorkerBoardRepository {
    func moderationQueue(
        page: BoardPageRequest
    ) async throws -> BoardModerationQueuePage {
        let token = await cache.writeToken(for: .moderation)
        let value = try await run(
            operation: .moderationQueue,
            beforeLogging: { error in
                guard error == .authorityRequired else {
                    return
                }
                await cache.purgeModerationPartition()
            },
            work: { [client] in
                let output = try await client.getBoardModerationQueue(
                    .init(
                        query: .init(
                            cursor: page.cursor?.rawValue,
                            limit: page.limit
                        )
                    )
                )
                switch output {
                case .ok(let response):
                    return try Self.moderationQueue(
                        from: response.body.json
                    )
                case .badRequest(let response):
                    throw Self.error(
                        status: 400,
                        envelope: try response.body.json
                    )
                case .unauthorized(let response):
                    throw Self.error(
                        status: 401,
                        envelope: try response.body.json
                    )
                case .forbidden(let response):
                    throw Self.error(
                        status: 403,
                        envelope: try response.body.json
                    )
                case .notFound(let response):
                    throw Self.error(
                        status: 404,
                        envelope: try response.body.json
                    )
                case .conflict(let response):
                    throw Self.error(
                        status: 409,
                        envelope: try response.body.json
                    )
                case .tooManyRequests(let response):
                    throw Self.error(
                        status: 429,
                        envelope: try response.body.json
                    )
                case .serviceUnavailable(let response):
                    throw Self.error(
                        status: 503,
                        envelope: try response.body.json
                    )
                case .undocumented(let status, _):
                    throw Self.error(status: status, code: nil)
                }
            })
        await cache.replaceModerationQueue(value, ifCurrent: token)
        return value
    }

    func decideContent(
        _ command: BoardModerationDecisionCommand
    ) async throws -> BoardModerationDecisionResult {
        try await runMutation(
            kind: .moderationDecision,
            operation: .moderationDecision
        ) { [client] in
            guard
                command.expectedEpoch >= 0,
                Self.isValidModeratorReason(command.reason)
            else {
                throw BoardError.invalidRequest
            }
            let request =
                Components.Schemas.BoardModerationDecisionRequest(
                    clientRequestId: Self.id(command.clientRequestID),
                    expectedEpoch: command.expectedEpoch,
                    action: Self.generated(command.action),
                    reason: command.reason
                )
            let payload: Components.Schemas.BoardModerationDecisionResult
            switch command.target {
            case .post(let postID):
                let output = try await client.decideBoardPost(
                    .init(
                        path: .init(postId: Self.id(postID)),
                        body: .json(request)
                    )
                )
                payload = try Self.moderationDecisionPayload(
                    from: output
                )
            case .comment(let commentID):
                let output = try await client.decideBoardComment(
                    .init(
                        path: .init(commentId: Self.id(commentID)),
                        body: .json(request)
                    )
                )
                payload = try Self.moderationDecisionPayload(
                    from: output
                )
            }
            return try Self.moderationDecisionResult(
                from: payload,
                expectedTarget: command.target
            )
        }
    }

    func createBan(
        _ command: BoardCreateBanCommand
    ) async throws -> BoardBanResult {
        try await runMutation(
            kind: .createBan,
            operation: .createBan
        ) { [client] in
            guard
                (300...31_536_000).contains(command.durationSeconds),
                Self.isValidModeratorReason(command.reason),
                command.note.map(Self.isValidModeratorNote) ?? true
            else {
                throw BoardError.invalidRequest
            }
            let request = Components.Schemas.BoardBanRequest(
                clientRequestId: Self.id(command.clientRequestID),
                durationSeconds: command.durationSeconds,
                reason: command.reason,
                note: command.note
            )
            let payload: Components.Schemas.BoardBanResult
            switch command.target {
            case .post(let postID):
                let output = try await client.createBoardPostBan(
                    .init(
                        path: .init(postId: Self.id(postID)),
                        body: .json(request)
                    )
                )
                payload = try Self.banPayload(from: output)
            case .comment(let commentID):
                let output = try await client.createBoardCommentBan(
                    .init(
                        path: .init(commentId: Self.id(commentID)),
                        body: .json(request)
                    )
                )
                payload = try Self.banPayload(from: output)
            }
            guard let id = UUID(uuidString: payload.banId) else {
                throw BoardError.invalidResponse
            }
            return BoardBanResult(
                id: id,
                expiresAt: payload.expiresAt,
                replayed: payload.replayed
            )
        }
    }

    func revokeBan(
        _ command: BoardRevokeBanCommand
    ) async throws -> BoardBanRevokeResult {
        try await runMutation(
            kind: .revokeBan,
            operation: .revokeBan
        ) { [client] in
            guard Self.isValidModeratorReason(command.reason) else {
                throw BoardError.invalidRequest
            }
            let output = try await client.revokeBoardBan(
                .init(
                    path: .init(banId: Self.id(command.banID)),
                    body: .json(
                        .init(
                            clientRequestId: Self.id(
                                command.clientRequestID
                            ),
                            reason: command.reason
                        )
                    )
                )
            )
            let payload = try Self.banRevokePayload(from: output)
            guard UUID(uuidString: payload.banId) == command.banID else {
                throw BoardError.invalidResponse
            }
            return BoardBanRevokeResult(
                id: command.banID,
                revokedAt: payload.revokedAt,
                changed: payload.changed,
                replayed: payload.replayed
            )
        }
    }

    func decideAppeal(
        _ command: BoardAppealDecisionCommand
    ) async throws -> BoardAppealDecisionResult {
        try await runMutation(
            kind: .appealDecision,
            operation: .appealDecision
        ) { [client] in
            guard Self.isValidModeratorReason(command.reason) else {
                throw BoardError.invalidRequest
            }
            let output = try await client.decideBoardAppeal(
                .init(
                    path: .init(
                        appealId: Self.id(command.appealID)
                    ),
                    body: .json(
                        .init(
                            clientRequestId: Self.id(
                                command.clientRequestID
                            ),
                            decision: Self.generated(command.decision),
                            reason: command.reason
                        )
                    )
                )
            )
            let payload = try Self.appealDecisionPayload(from: output)
            guard
                UUID(uuidString: payload.appealId) == command.appealID,
                let targetID = UUID(uuidString: payload.targetId)
            else {
                throw BoardError.invalidResponse
            }
            let target: BoardModerationTarget
            switch payload.targetType {
            case .post:
                target = .post(targetID)
            case .comment:
                target = .comment(targetID)
            case .ban:
                target = .ban(targetID)
            }
            return BoardAppealDecisionResult(
                appealID: command.appealID,
                state: Self.appealState(from: payload.state),
                target: target,
                changed: payload.changed,
                replayed: payload.replayed
            )
        }
    }
}

extension WorkerBoardRepository {
    func config() async throws -> BoardConfig {
        let token = await cache.writeToken(for: .owner)
        let value = try await run(
            operation: .config,
            beforeLogging: { error in
                guard error == .authorityRequired else {
                    return
                }
                await cache.purgeOwnerPartition()
            },
            work: { [client] in
                let output = try await client.getBoardConfig()
                switch output {
                case .ok(let response):
                    return try Self.config(from: response.body.json)
                case .badRequest(let response):
                    throw Self.error(
                        status: 400,
                        envelope: try response.body.json
                    )
                case .unauthorized(let response):
                    throw Self.error(
                        status: 401,
                        envelope: try response.body.json
                    )
                case .forbidden(let response):
                    throw Self.error(
                        status: 403,
                        envelope: try response.body.json
                    )
                case .notFound(let response):
                    throw Self.error(
                        status: 404,
                        envelope: try response.body.json
                    )
                case .conflict(let response):
                    throw Self.error(
                        status: 409,
                        envelope: try response.body.json
                    )
                case .tooManyRequests(let response):
                    throw Self.error(
                        status: 429,
                        envelope: try response.body.json
                    )
                case .serviceUnavailable(let response):
                    throw Self.error(
                        status: 503,
                        envelope: try response.body.json
                    )
                case .undocumented(let status, _):
                    throw Self.error(status: status, code: nil)
                }
            })
        await cache.replaceConfig(value, ifCurrent: token)
        return value
    }

    func updateConfig(
        _ command: BoardConfigUpdateCommand
    ) async throws -> BoardConfigMutationResult {
        try await runMutation(
            kind: .updateConfig,
            operation: .updateConfig
        ) { [client] in
            guard (2...10).contains(command.autoHideThreshold) else {
                throw BoardError.invalidRequest
            }
            let output = try await client.updateBoardConfig(
                .init(
                    body: .json(
                        .init(
                            enabled: command.enabled,
                            autoHideThreshold: command.autoHideThreshold
                        )
                    )
                )
            )
            switch output {
            case .ok(let response):
                let payload = try response.body.json
                guard (2...10).contains(payload.autoHideThreshold) else {
                    throw BoardError.invalidResponse
                }
                return BoardConfigMutationResult(
                    enabled: payload.enabled,
                    autoHideThreshold: payload.autoHideThreshold,
                    updatedAt: payload.updatedAt,
                    changed: payload.changed
                )
            case .badRequest(let response):
                throw Self.error(
                    status: 400,
                    envelope: try response.body.json
                )
            case .unauthorized(let response):
                throw Self.error(
                    status: 401,
                    envelope: try response.body.json
                )
            case .forbidden(let response):
                throw Self.error(
                    status: 403,
                    envelope: try response.body.json
                )
            case .notFound(let response):
                throw Self.error(
                    status: 404,
                    envelope: try response.body.json
                )
            case .conflict(let response):
                throw Self.error(
                    status: 409,
                    envelope: try response.body.json
                )
            case .tooManyRequests(let response):
                throw Self.error(
                    status: 429,
                    envelope: try response.body.json
                )
            case .serviceUnavailable(let response):
                throw Self.error(
                    status: 503,
                    envelope: try response.body.json
                )
            case .undocumented(let status, _):
                throw Self.error(status: status, code: nil)
            }
        }
    }

    func moderators(
        page: BoardPageRequest
    ) async throws -> BoardModeratorPage {
        let token = await cache.writeToken(for: .owner)
        let value = try await run(
            operation: .moderators,
            beforeLogging: { error in
                guard error == .authorityRequired else {
                    return
                }
                await cache.purgeOwnerPartition()
            },
            work: { [client] in
                let output = try await client.listBoardModerators(
                    .init(
                        query: .init(
                            cursor: page.cursor?.rawValue,
                            limit: page.limit
                        )
                    )
                )
                switch output {
                case .ok(let response):
                    return try Self.moderators(
                        from: response.body.json
                    )
                case .badRequest(let response):
                    throw Self.error(
                        status: 400,
                        envelope: try response.body.json
                    )
                case .unauthorized(let response):
                    throw Self.error(
                        status: 401,
                        envelope: try response.body.json
                    )
                case .forbidden(let response):
                    throw Self.error(
                        status: 403,
                        envelope: try response.body.json
                    )
                case .notFound(let response):
                    throw Self.error(
                        status: 404,
                        envelope: try response.body.json
                    )
                case .conflict(let response):
                    throw Self.error(
                        status: 409,
                        envelope: try response.body.json
                    )
                case .tooManyRequests(let response):
                    throw Self.error(
                        status: 429,
                        envelope: try response.body.json
                    )
                case .serviceUnavailable(let response):
                    throw Self.error(
                        status: 503,
                        envelope: try response.body.json
                    )
                case .undocumented(let status, _):
                    throw Self.error(status: status, code: nil)
                }
            })
        await cache.replaceModerators(value, ifCurrent: token)
        return value
    }

    func upsertModerator(
        _ command: BoardModeratorUpsertCommand
    ) async throws -> BoardModeratorMutationResult {
        try await runMutation(
            kind: .upsertModerator,
            operation: .upsertModerator
        ) { [client] in
            let output = try await client.addBoardModerator(
                .init(
                    path: .init(userId: Self.id(command.userID)),
                    body: .json(
                        .init(role: Self.generated(command.role))
                    )
                )
            )
            return try Self.moderatorMutation(
                from: Self.moderatorMutationPayload(from: output),
                expectedUserID: command.userID
            )
        }
    }

    func removeModerator(
        userID: UUID
    ) async throws -> BoardModeratorMutationResult {
        try await runMutation(
            kind: .removeModerator,
            operation: .removeModerator
        ) { [client] in
            let output = try await client.removeBoardModerator(
                .init(path: .init(userId: Self.id(userID)))
            )
            return try Self.moderatorMutation(
                from: Self.moderatorMutationPayload(from: output),
                expectedUserID: userID
            )
        }
    }
}

extension WorkerBoardRepository {
    fileprivate static func config(
        from value: Components.Schemas.BoardConfig
    ) throws -> BoardConfig {
        guard (2...10).contains(value.autoHideThreshold) else {
            throw BoardError.invalidResponse
        }
        return BoardConfig(
            enabled: value.enabled,
            autoHideThreshold: value.autoHideThreshold,
            updatedAt: value.updatedAt
        )
    }

    fileprivate static func moderators(
        from value: Components.Schemas.BoardModerators
    ) throws -> BoardModeratorPage {
        guard value.moderators.count <= 50 else {
            throw BoardError.invalidResponse
        }
        return BoardModeratorPage(
            moderators: try value.moderators.map(moderator(from:)),
            next: try cursor(from: value.nextCursor)
        )
    }

    fileprivate static func moderator(
        from value: Components.Schemas.BoardModerator
    ) throws -> BoardModeratorMembership {
        let grantedBy = try optionalUUID(value.grantedBy)
        guard
            let userID = UUID(uuidString: value.userId)
        else {
            throw BoardError.invalidResponse
        }
        return BoardModeratorMembership(
            userID: userID,
            role: moderatorRole(from: value.role),
            grantedBy: grantedBy,
            grantedAt: value.grantedAt
        )
    }

    fileprivate static func moderatorRole(
        from value: Components.Schemas.BoardModeratorRole
    ) -> BoardModeratorRole {
        switch value {
        case .moderator:
            return .moderator
        case .owner:
            return .owner
        }
    }

    fileprivate static func generated(
        _ value: BoardModeratorRole
    ) -> Components.Schemas.BoardModeratorRole {
        switch value {
        case .moderator:
            return .moderator
        case .owner:
            return .owner
        }
    }

    fileprivate static func moderatorMutation(
        from value: Components.Schemas.BoardModeratorMutationResult,
        expectedUserID: UUID
    ) throws -> BoardModeratorMutationResult {
        guard UUID(uuidString: value.userId) == expectedUserID else {
            throw BoardError.invalidResponse
        }
        return BoardModeratorMutationResult(
            userID: expectedUserID,
            role: value.role.map(moderatorRole(from:)),
            changed: value.changed
        )
    }

    fileprivate static func moderatorMutationPayload(
        from output: Operations.AddBoardModerator.Output
    ) throws -> Components.Schemas.BoardModeratorMutationResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func moderatorMutationPayload(
        from output: Operations.RemoveBoardModerator.Output
    ) throws -> Components.Schemas.BoardModeratorMutationResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func generated(
        _ value: BoardModerationAction
    ) -> Components.Schemas.BoardModerationAction {
        switch value {
        case .hide:
            return .hide
        case .remove:
            return .remove
        case .restore:
            return .restore
        case .dismiss:
            return .dismiss
        }
    }

    fileprivate static func generated(
        _ value: BoardAppealDecision
    ) -> Components.Schemas.BoardAppealDecision {
        switch value {
        case .approved:
            return .approved
        case .denied:
            return .denied
        }
    }

    fileprivate static func moderationQueue(
        from value: Components.Schemas.BoardModerationQueue
    ) throws -> BoardModerationQueuePage {
        guard value.items.count <= 50 else {
            throw BoardError.invalidResponse
        }
        return BoardModerationQueuePage(
            items: try value.items.map(moderationQueueItem(from:)),
            next: try cursor(from: value.nextCursor)
        )
    }

    fileprivate static func moderationQueueItem(
        from value: Components.Schemas.BoardModerationQueueItem
    ) throws -> BoardModerationQueueItem {
        let postID = try optionalUUID(value.postId)
        let parentID = try optionalUUID(value.parentCommentId)
        let resolvedVisibility = value.visibility.map {
            visibility(from: $0.value1)
        }
        guard
            let queueID = UUID(uuidString: value.queueId),
            let targetID = UUID(uuidString: value.targetId),
            value.openReportCount >= 0,
            value.moderationEpoch.map({ $0 >= 0 }) ?? true,
            value.reportReasons.count <= 7,
            isValidTitle(value.title),
            value.appealBody.map(isValidAppealBody) ?? true
        else {
            throw BoardError.invalidResponse
        }

        let kind: BoardModerationQueueKind
        switch value.queueKind {
        case .report:
            kind = .report
        case .appeal:
            kind = .appeal
        }
        switch kind {
        case .report:
            guard value.appealBody == nil else {
                throw BoardError.invalidResponse
            }
        case .appeal:
            guard value.appealBody != nil else {
                throw BoardError.invalidResponse
            }
        }

        let target: BoardModerationTarget
        switch value.targetType {
        case .post:
            target = .post(targetID)
        case .comment:
            target = .comment(targetID)
        case .ban:
            target = .ban(targetID)
        }
        switch target {
        case .ban:
            guard
                kind == .appeal,
                postID == nil,
                parentID == nil,
                value.title == nil,
                value.body == nil,
                resolvedVisibility == nil,
                value.moderationEpoch == nil,
                value.score == nil,
                value.openReportCount == 0,
                value.reportReasons.isEmpty
            else {
                throw BoardError.invalidResponse
            }
        case .post, .comment:
            guard
                postID != nil,
                let visibility = resolvedVisibility,
                value.moderationEpoch != nil,
                value.score != nil
            else {
                throw BoardError.invalidResponse
            }
            switch target {
            case .comment:
                guard
                    value.title == nil,
                    value.body.map(isValidCommentBody) ?? true
                else {
                    throw BoardError.invalidResponse
                }
            case .post:
                guard value.body.map(isValidBody) ?? true else {
                    throw BoardError.invalidResponse
                }
            case .ban:
                throw BoardError.invalidResponse
            }
            if isTerminal(visibility) {
                guard value.title == nil, value.body == nil else {
                    throw BoardError.invalidResponse
                }
            } else {
                guard value.body != nil else {
                    throw BoardError.invalidResponse
                }
            }
        }

        return BoardModerationQueueItem(
            queueKind: kind,
            queueID: queueID,
            target: target,
            postID: postID,
            parentCommentID: parentID,
            title: value.title,
            body: value.body,
            visibility: resolvedVisibility,
            moderationEpoch: value.moderationEpoch,
            score: value.score,
            openReportCount: value.openReportCount,
            reportReasons: value.reportReasons.map(reportReason(from:)),
            appealBody: value.appealBody,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt
        )
    }

    fileprivate static func reportReason(
        from value: Components.Schemas.BoardReportReason
    ) -> BoardReportReason {
        switch value {
        case .harassment:
            return .harassment
        case .hate:
            return .hate
        case .threat:
            return .threat
        case .sexual:
            return .sexual
        case .personalInfo:
            return .personalInfo
        case .spam:
            return .spam
        case .other:
            return .other
        }
    }

    fileprivate static func moderationDecisionResult(
        from value: Components.Schemas.BoardModerationDecisionResult,
        expectedTarget: BoardContentTarget
    ) throws -> BoardModerationDecisionResult {
        guard
            let targetID = UUID(uuidString: value.targetId),
            value.moderationEpoch >= 0,
            value.revision > 0
        else {
            throw BoardError.invalidResponse
        }

        let actual: BoardContentTarget
        switch value.targetType {
        case .post:
            actual = .post(targetID)
        case .comment:
            actual = .comment(targetID)
        }
        guard actual == expectedTarget else {
            throw BoardError.invalidResponse
        }
        return BoardModerationDecisionResult(
            target: actual,
            visibility: visibility(from: value.visibility),
            moderationEpoch: value.moderationEpoch,
            revision: value.revision,
            replayed: value.replayed
        )
    }

    fileprivate static func generatedTitle(
        _ field: BoardEditField<String>
    ) throws -> Components.Schemas.BoardEditPostTitleCommand? {
        switch field {
        case .unchanged:
            return nil
        case .set(let value):
            guard isValidTitle(value) else {
                throw BoardError.invalidRequest
            }
            return .init(action: .set, value: value)
        case .clear:
            return .init(action: .clear)
        }
    }

    fileprivate static func generatedBody(
        _ field: BoardEditField<String>
    ) throws -> Components.Schemas.BoardEditPostBodyCommand? {
        switch field {
        case .unchanged:
            return nil
        case .set(let value):
            guard isValidBody(value) else {
                throw BoardError.invalidRequest
            }
            return .init(action: .set, value: value)
        case .clear:
            throw BoardError.invalidRequest
        }
    }

    fileprivate static func postMutation(
        from value: Components.Schemas.BoardPostMutationResult,
        expectedID: UUID
    ) throws -> BoardPostMutationResult {
        guard
            UUID(uuidString: value.postId) == expectedID,
            value.revision > 0
        else {
            throw BoardError.invalidResponse
        }
        return BoardPostMutationResult(
            postID: expectedID,
            revision: value.revision,
            changed: value.changed
        )
    }

    fileprivate static func commentMutation(
        from value: Components.Schemas.BoardCommentMutationResult,
        expectedID: UUID
    ) throws -> BoardCommentMutationResult {
        guard
            UUID(uuidString: value.commentId) == expectedID,
            value.revision > 0
        else {
            throw BoardError.invalidResponse
        }
        return BoardCommentMutationResult(
            commentID: expectedID,
            revision: value.revision,
            changed: value.changed
        )
    }

    fileprivate static func generated(
        _ value: BoardReportReason
    ) -> Components.Schemas.BoardReportReason {
        switch value {
        case .harassment:
            return .harassment
        case .hate:
            return .hate
        case .threat:
            return .threat
        case .sexual:
            return .sexual
        case .personalInfo:
            return .personalInfo
        case .spam:
            return .spam
        case .other:
            return .other
        }
    }

    fileprivate static func vote(
        from value: Components.Schemas.BoardVoteResult.ValuePayload
    ) throws -> BoardVoteValue {
        try vote(values: [value.value1, value.value2, value.value3])
    }

    fileprivate static func voteResult(
        from value: Components.Schemas.BoardVoteResult,
        expectedTarget: BoardContentTarget
    ) throws -> BoardVoteResult {
        let target: BoardContentTarget
        switch expectedTarget {
        case .post(let expectedID):
            guard
                let rawID = value.postId,
                UUID(uuidString: rawID) == expectedID,
                value.commentId == nil
            else {
                throw BoardError.invalidResponse
            }
            target = .post(expectedID)
        case .comment(let expectedID):
            guard
                let rawID = value.commentId,
                UUID(uuidString: rawID) == expectedID,
                value.postId == nil
            else {
                throw BoardError.invalidResponse
            }
            target = .comment(expectedID)
        }
        return BoardVoteResult(
            target: target,
            value: try vote(from: value.value),
            score: value.score,
            changed: value.changed
        )
    }

    fileprivate static func appealResult(
        from value: Components.Schemas.BoardAppealResult
    ) throws -> BoardAppealResult {
        guard let id = UUID(uuidString: value.appealId) else {
            throw BoardError.invalidResponse
        }
        return BoardAppealResult(
            appealID: id,
            state: appealState(from: value.state),
            replayed: value.replayed
        )
    }

    fileprivate static func appealState(
        from value: Components.Schemas.BoardAppealState
    ) -> BoardAppealState {
        switch value {
        case .pending:
            return .pending
        case .approved:
            return .approved
        case .denied:
            return .denied
        }
    }

    fileprivate static func votePayload(
        from output: Operations.SetBoardPostVote.Output
    ) throws -> Components.Schemas.BoardVoteResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func votePayload(
        from output: Operations.SetBoardCommentVote.Output
    ) throws -> Components.Schemas.BoardVoteResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func reportPayload(
        from output: Operations.ReportBoardPost.Output
    ) throws -> Components.Schemas.BoardReportResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func reportPayload(
        from output: Operations.ReportBoardComment.Output
    ) throws -> Components.Schemas.BoardReportResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func appealPayload(
        from output: Operations.AppealBoardPost.Output
    ) throws -> Components.Schemas.BoardAppealResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func appealPayload(
        from output: Operations.AppealBoardComment.Output
    ) throws -> Components.Schemas.BoardAppealResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func appealPayload(
        from output: Operations.AppealBoardBan.Output
    ) throws -> Components.Schemas.BoardAppealResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(
                status: 400,
                envelope: try response.body.json
            )
        case .unauthorized(let response):
            throw error(
                status: 401,
                envelope: try response.body.json
            )
        case .forbidden(let response):
            throw error(
                status: 403,
                envelope: try response.body.json
            )
        case .notFound(let response):
            throw error(
                status: 404,
                envelope: try response.body.json
            )
        case .conflict(let response):
            throw error(
                status: 409,
                envelope: try response.body.json
            )
        case .tooManyRequests(let response):
            throw error(
                status: 429,
                envelope: try response.body.json
            )
        case .serviceUnavailable(let response):
            throw error(
                status: 503,
                envelope: try response.body.json
            )
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func moderationDecisionPayload(
        from output: Operations.DecideBoardPost.Output
    ) throws -> Components.Schemas.BoardModerationDecisionResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func moderationDecisionPayload(
        from output: Operations.DecideBoardComment.Output
    ) throws -> Components.Schemas.BoardModerationDecisionResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func banPayload(
        from output: Operations.CreateBoardPostBan.Output
    ) throws -> Components.Schemas.BoardBanResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func banPayload(
        from output: Operations.CreateBoardCommentBan.Output
    ) throws -> Components.Schemas.BoardBanResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func banRevokePayload(
        from output: Operations.RevokeBoardBan.Output
    ) throws -> Components.Schemas.BoardBanRevokeResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func appealDecisionPayload(
        from output: Operations.DecideBoardAppeal.Output
    ) throws -> Components.Schemas.BoardAppealDecisionResult {
        switch output {
        case .ok(let response):
            return try response.body.json
        case .badRequest(let response):
            throw error(status: 400, envelope: try response.body.json)
        case .unauthorized(let response):
            throw error(status: 401, envelope: try response.body.json)
        case .forbidden(let response):
            throw error(status: 403, envelope: try response.body.json)
        case .notFound(let response):
            throw error(status: 404, envelope: try response.body.json)
        case .conflict(let response):
            throw error(status: 409, envelope: try response.body.json)
        case .tooManyRequests(let response):
            throw error(status: 429, envelope: try response.body.json)
        case .serviceUnavailable(let response):
            throw error(status: 503, envelope: try response.body.json)
        case .undocumented(let status, _):
            throw error(status: status, code: nil)
        }
    }

    fileprivate static func status(
        from value: Components.Schemas.BoardStatus
    ) throws -> BoardStatus {
        guard
            isValidAlias(value.authorAlias),
            value.pendingAppeals >= 0
        else {
            throw BoardError.invalidResponse
        }

        let ban: BoardBanSummary?
        if value.banned {
            guard
                let rawID = value.banId,
                let id = UUID(uuidString: rawID),
                let until = value.bannedUntil,
                let reason = value.banReason,
                isValidModeratorReason(reason)
            else {
                throw BoardError.invalidResponse
            }
            ban = BoardBanSummary(id: id, until: until, reason: reason)
        } else {
            guard
                value.banId == nil,
                value.bannedUntil == nil,
                value.banReason == nil
            else {
                throw BoardError.invalidResponse
            }
            ban = nil
        }

        return BoardStatus(
            enabled: value.enabled,
            authorAlias: value.authorAlias,
            ban: ban,
            pendingAppeals: value.pendingAppeals,
            privacyNotice: value.privacyNotice.rawValue,
            edgeMetadataNotice: value.edgeMetadataNotice.rawValue
        )
    }

    fileprivate static func feed(
        from value: Components.Schemas.BoardFeed
    ) throws -> BoardFeedPage {
        guard value.posts.count <= 50 else {
            throw BoardError.invalidResponse
        }
        return BoardFeedPage(
            posts: try value.posts.map(post(from:)),
            next: try cursor(from: value.nextCursor)
        )
    }

    fileprivate static func thread(
        from value: Components.Schemas.BoardThread
    ) throws -> BoardThreadPage {
        guard value.comments.count <= 50 else {
            throw BoardError.invalidResponse
        }
        let post = try post(from: value.post)
        let comments = try value.comments.map(comment(from:))
        guard comments.allSatisfy({ $0.postID == post.id }) else {
            throw BoardError.invalidResponse
        }
        return BoardThreadPage(
            post: post,
            comments: comments,
            next: try cursor(from: value.nextCursor)
        )
    }

    fileprivate static func ownContent(
        from value: Components.Schemas.BoardOwnContent
    ) throws -> BoardOwnContentPage {
        guard value.items.count <= 50 else {
            throw BoardError.invalidResponse
        }
        return BoardOwnContentPage(
            items: try value.items.map(ownContentItem(from:)),
            next: try cursor(from: value.nextCursor)
        )
    }

    fileprivate static func post(
        from value: Components.Schemas.BoardPost
    ) throws -> BoardPost {
        guard
            let id = UUID(uuidString: value.id),
            isValidAlias(value.authorAlias),
            isValidBody(value.body),
            isValidTitle(value.title),
            value.moderationEpoch >= 0,
            value.revision > 0,
            value.commentCount >= 0
        else {
            throw BoardError.invalidResponse
        }
        return BoardPost(
            id: id,
            title: value.title,
            body: value.body,
            visibility: .visible,
            moderationEpoch: value.moderationEpoch,
            score: value.score,
            revision: value.revision,
            authorAlias: value.authorAlias,
            isMine: value.isMine,
            commentCount: value.commentCount,
            myVote: try vote(from: value.myVote),
            createdAt: value.createdAt,
            updatedAt: value.updatedAt
        )
    }

    fileprivate static func post(
        from value: Components.Schemas.BoardThreadPost
    ) throws -> BoardPost {
        guard
            let id = UUID(uuidString: value.id),
            isValidAlias(value.authorAlias),
            isValidBody(value.body),
            isValidTitle(value.title),
            value.moderationEpoch >= 0,
            value.revision > 0
        else {
            throw BoardError.invalidResponse
        }
        return BoardPost(
            id: id,
            title: value.title,
            body: value.body,
            visibility: .visible,
            moderationEpoch: value.moderationEpoch,
            score: value.score,
            revision: value.revision,
            authorAlias: value.authorAlias,
            isMine: value.isMine,
            commentCount: nil,
            myVote: try vote(from: value.myVote),
            createdAt: value.createdAt,
            updatedAt: value.updatedAt
        )
    }

    fileprivate static func comment(
        from value: Components.Schemas.BoardComment
    ) throws -> BoardComment {
        let parentID = try optionalUUID(value.parentCommentId)
        guard
            let id = UUID(uuidString: value.id),
            let postID = UUID(uuidString: value.postId),
            isValidAlias(value.authorAlias),
            isValidCommentBody(value.body),
            value.moderationEpoch >= 0,
            value.revision > 0
        else {
            throw BoardError.invalidResponse
        }
        return BoardComment(
            id: id,
            postID: postID,
            parentCommentID: parentID,
            body: value.body,
            visibility: .visible,
            moderationEpoch: value.moderationEpoch,
            score: value.score,
            revision: value.revision,
            authorAlias: value.authorAlias,
            isMine: value.isMine,
            myVote: try vote(from: value.myVote),
            createdAt: value.createdAt,
            updatedAt: value.updatedAt
        )
    }

    fileprivate static func ownContentItem(
        from value: Components.Schemas.BoardOwnContentItem
    ) throws -> BoardOwnContentItem {
        let parentID = try optionalUUID(value.parentCommentId)
        guard
            let id = UUID(uuidString: value.id),
            let postID = UUID(uuidString: value.postId),
            isValidAlias(value.authorAlias),
            isValidTitle(value.title),
            value.moderationEpoch >= 0,
            value.revision > 0,
            value.isMine
        else {
            throw BoardError.invalidResponse
        }
        let type: BoardContentType
        switch value.contentType {
        case .post:
            type = .post
            guard id == postID, parentID == nil else {
                throw BoardError.invalidResponse
            }
        case .comment:
            type = .comment
        }
        switch type {
        case .post:
            guard value.body.map(isValidBody) ?? true else {
                throw BoardError.invalidResponse
            }
        case .comment:
            guard
                value.title == nil,
                value.body.map(isValidCommentBody) ?? true
            else {
                throw BoardError.invalidResponse
            }
        }
        let resolvedVisibility = visibility(from: value.visibility)
        if isTerminal(resolvedVisibility) {
            guard value.title == nil, value.body == nil else {
                throw BoardError.invalidResponse
            }
        } else {
            guard value.body != nil else {
                throw BoardError.invalidResponse
            }
        }
        return BoardOwnContentItem(
            contentType: type,
            id: id,
            postID: postID,
            parentCommentID: parentID,
            title: value.title,
            body: value.body,
            visibility: resolvedVisibility,
            moderationEpoch: value.moderationEpoch,
            score: value.score,
            revision: value.revision,
            authorAlias: value.authorAlias,
            isMine: value.isMine,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt
        )
    }

    fileprivate static func cursor(from rawValue: String?) throws -> BoardCursor? {
        guard let rawValue else {
            return nil
        }
        guard let cursor = BoardCursor(rawValue: rawValue) else {
            throw BoardError.invalidResponse
        }
        return cursor
    }

    fileprivate static func optionalUUID(_ rawValue: String?) throws -> UUID? {
        guard let rawValue else {
            return nil
        }
        guard let value = UUID(uuidString: rawValue) else {
            throw BoardError.invalidResponse
        }
        return value
    }

    fileprivate static func visibility(
        from value: Components.Schemas.BoardVisibility
    ) -> BoardVisibility {
        switch value {
        case .visible:
            return .visible
        case .autoHidden:
            return .autoHidden
        case .moderatorHidden:
            return .moderatorHidden
        case .removed:
            return .removed
        case .authorDeleted:
            return .authorDeleted
        case .accountDeleted:
            return .accountDeleted
        }
    }

    fileprivate static func vote(
        values: [Double?]
    ) throws -> BoardVoteValue {
        let concrete = Set(values.compactMap { $0 })
        guard
            concrete.count == 1,
            let raw = concrete.first,
            raw.rounded() == raw,
            let value = BoardVoteValue(rawValue: Int(raw))
        else {
            throw BoardError.invalidResponse
        }
        return value
    }

    fileprivate static func vote(
        from value: Components.Schemas.BoardPost.MyVotePayload
    ) throws -> BoardVoteValue {
        try vote(values: [value.value1, value.value2, value.value3])
    }

    fileprivate static func vote(
        from value: Components.Schemas.BoardThreadPost.MyVotePayload
    ) throws -> BoardVoteValue {
        try vote(values: [value.value1, value.value2, value.value3])
    }

    fileprivate static func vote(
        from value: Components.Schemas.BoardComment.MyVotePayload
    ) throws -> BoardVoteValue {
        try vote(values: [value.value1, value.value2, value.value3])
    }

    fileprivate static func isValidAlias(_ value: String) -> Bool {
        value.range(
            of: #"^Anonymous Otter [0-9A-F]{4}$"#,
            options: .regularExpression
        ) != nil
    }

    fileprivate static func isValidTitle(_ value: String?) -> Bool {
        guard let value else {
            return true
        }
        return isValidBoundedText(value, maximumUTF16Length: 160)
    }

    fileprivate static func isValidBody(_ value: String) -> Bool {
        isValidBoundedText(value, maximumUTF16Length: 5_000)
    }

    fileprivate static func isValidCommentBody(_ value: String) -> Bool {
        isValidBoundedText(value, maximumUTF16Length: 2_000)
    }

    fileprivate static func isValidAppealBody(_ value: String) -> Bool {
        isValidBoundedText(value, maximumUTF16Length: 2_000)
    }

    fileprivate static func isValidReportDetail(_ value: String) -> Bool {
        isValidBoundedText(value, maximumUTF16Length: 1_000)
    }

    fileprivate static func isValidModeratorReason(_ value: String) -> Bool {
        isValidBoundedText(value, maximumUTF16Length: 240)
    }

    fileprivate static func isValidModeratorNote(_ value: String) -> Bool {
        isValidBoundedText(value, maximumUTF16Length: 1_000)
    }

    fileprivate static func isValidBoundedText(
        _ value: String,
        maximumUTF16Length: Int
    ) -> Bool {
        let trimmed = value.trimmingCharacters(
            in: boardTrimCharacters
        )
        return (1...maximumUTF16Length).contains(trimmed.utf16.count)
    }

    fileprivate static let boardTrimCharacters = CharacterSet(
        charactersIn:
            "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}"
            + "\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}"
            + "\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}"
            + "\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}"
            + "\u{FEFF}"
    )

    fileprivate static func isTerminal(_ visibility: BoardVisibility) -> Bool {
        switch visibility {
        case .removed, .authorDeleted, .accountDeleted:
            return true
        case .visible, .autoHidden, .moderatorHidden:
            return false
        }
    }
}
