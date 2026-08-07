import BrownSyncAPI
import Foundation

protocol UUIDProviding: Sendable {
    func next() async -> UUID
}

struct SystemUUIDProvider: UUIDProviding {
    func next() async -> UUID {
        UUID()
    }
}

enum UserEventOwner: Equatable, Hashable, Sendable {
    case personal
    case organization(id: String, name: String)
}

enum UserEventCategory:
    String,
    CaseIterable,
    Equatable,
    Hashable,
    Sendable
{
    case academic
    case `class`
    case club
    case arts
    case athletics
    case food
    case social
    case career
    case wellness
    case admin
}

enum UserEventStatus: Equatable, Sendable {
    case draft
    case published
    case canceled
}

enum UserEventModerationState: Equatable, Sendable {
    case active
    case hidden
}

struct UserEventCreateDraft: Equatable, Sendable {
    let owner: UserEventOwner
    let title: String
    let description: String?
    let start: Date
    let end: Date?
    let category: UserEventCategory
    let url: URL?
    let canonicalPlaceID: String
}

struct UserEventCreateSubmission: Equatable, Sendable {
    let requestID: UUID
    let draft: UserEventCreateDraft
}

enum UserEventHTTPSURL {
    static func parse(_ rawValue: String) -> URL? {
        guard
            rawValue.utf16.count <= 2_048,
            rawValue.hasPrefix("https://"),
            let components = URLComponents(string: rawValue),
            components.scheme == "https",
            let host = components.host,
            !host.isEmpty,
            let url = components.url
        else {
            return nil
        }
        return url
    }

    static func isValid(_ url: URL) -> Bool {
        parse(url.absoluteString) != nil
    }
}

enum UserEventCreateOutcome: Equatable, Sendable {
    case created(eventID: UUID, revision: Int)
    case replayed(eventID: UUID, revision: Int)
}

struct ManagedUserEvent: Equatable, Identifiable, Sendable {
    let id: UUID
    let owner: UserEventOwner
    let title: String
    let description: String?
    let start: Date
    let end: Date?
    let canonicalPlaceID: String
    let placeName: String
    let category: UserEventCategory
    let url: URL?
    let status: UserEventStatus
    let moderationState: UserEventModerationState
    let revision: Int
    let deletedAt: Date?
    let createdAt: Date
    let updatedAt: Date
}

extension ManagedUserEvent {
    var isEditable: Bool {
        status != .canceled && deletedAt == nil
    }
}

struct UserEventMutationOutcome: Equatable, Sendable {
    let eventID: UUID
    let revision: Int
    let changed: Bool
}

struct UserEventManagementCursor: Equatable, Hashable, Sendable {
    let beforeUpdatedAt: Date
    let beforeEventID: UUID
}

struct UserEventManagementPage: Equatable, Sendable {
    let events: [ManagedUserEvent]
    let next: UserEventManagementCursor?
}

enum UserEventSetIntent<Value: Equatable & Sendable>:
    Equatable,
    Sendable
{
    case unchanged
    case set(Value)
}

enum UserEventNullableEditIntent<Value: Equatable & Sendable>:
    Equatable,
    Sendable
{
    case unchanged
    case set(Value)
    case clear
}

struct UserEventEditPatchIntent: Equatable, Sendable {
    let title: UserEventSetIntent<String>
    let description: UserEventNullableEditIntent<String>
    let start: UserEventSetIntent<Date>
    let end: UserEventNullableEditIntent<Date>
    let category: UserEventSetIntent<UserEventCategory>
    let url: UserEventNullableEditIntent<URL>
    let canonicalPlaceID: UserEventSetIntent<String>
}

enum UserEventEditField: Equatable, Sendable {
    case title
    case description
    case start
    case end
    case category
    case url
    case canonicalPlaceID
}

enum UserEventEditComparisonValue: Equatable, Sendable {
    case none
    case text(String)
    case date(Date)
    case category(UserEventCategory)
}

struct UserEventEditFieldComparison: Equatable, Sendable {
    let field: UserEventEditField
    let baseline: UserEventEditComparisonValue
    let submitted: UserEventEditComparisonValue
    let latest: UserEventEditComparisonValue
}

struct UserEventEditConflictReview: Equatable, Sendable {
    let eventID: UUID
    let expectedRevision: Int
    let latestRevision: Int
    let latestEvent: ManagedUserEvent
    let fields: [UserEventEditFieldComparison]
}

enum UserEventEditOutcome: Equatable, Sendable {
    case updated(UserEventMutationOutcome)
    case conflict(UserEventEditConflictReview)
}

enum UserEventRepositoryError: Error, Equatable, Sendable {
    case emptyEditPatch
    case eventNoLongerEditable
    case invalidInput
    case invalidTimeRange
    case invalidPageSize
    case eligibilityOrAuthorityRequired
    case rateLimited
    case requestConflict
    case placeUnresolved
    case unavailable
    case invalidResponse
}

protocol UserEventRepository: Sendable {
    func prepareCreate(
        _ draft: UserEventCreateDraft
    ) async -> UserEventCreateSubmission

    func create(
        _ submission: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome

    func update(
        eventID: UUID,
        baseline: ManagedUserEvent,
        expectedRevision: Int,
        patch: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome

    func cancel(
        eventID: UUID
    ) async throws -> UserEventMutationOutcome

    func page(
        before cursor: UserEventManagementCursor?,
        limit: Int
    ) async throws -> UserEventManagementPage

    func allManageableEvents(
        pageSize: Int
    ) async throws -> [ManagedUserEvent]

    func detail(
        eventID: UUID
    ) async throws -> ManagedUserEvent
}

extension UserEventRepository {
    func allManageableEvents() async throws -> [ManagedUserEvent] {
        try await allManageableEvents(pageSize: 50)
    }
}

struct WorkerUserEventRepository: UserEventRepository, Sendable {
    private let client: BrownSyncAPI.Client
    private let retrier: WorkerRequestRetrier
    private let uuidProvider: any UUIDProviding

    init(
        client: BrownSyncAPI.Client,
        retrier: WorkerRequestRetrier,
        uuidProvider: any UUIDProviding
    ) {
        self.client = client
        self.retrier = retrier
        self.uuidProvider = uuidProvider
    }

    func prepareCreate(
        _ draft: UserEventCreateDraft
    ) async -> UserEventCreateSubmission {
        UserEventCreateSubmission(
            requestID: await uuidProvider.next(),
            draft: draft
        )
    }

    func create(
        _ submission: UserEventCreateSubmission
    ) async throws -> UserEventCreateOutcome {
        let draft = submission.draft
        guard draft.url.map(UserEventHTTPSURL.isValid) ?? true else {
            throw UserEventRepositoryError.invalidInput
        }
        let organizationID: String?
        switch draft.owner {
        case .personal:
            organizationID = nil
        case .organization(let id, _):
            organizationID = id
        }

        let output = try await retrier.run(
            method: .mutation
        ) { [client] in
            try await client.createUserEvent(
                .init(
                    body: .json(
                        .init(
                            clientRequestId:
                                submission.requestID.uuidString.lowercased(),
                            organizationId: organizationID,
                            title: draft.title,
                            description: draft.description,
                            start: draft.start,
                            end: draft.end,
                            category: draft.category.generated,
                            url: draft.url?.absoluteString,
                            placeId: draft.canonicalPlaceID
                        )
                    )
                )
            )
        }

        switch output {
        case .created(let response):
            switch response.body {
            case .json(let payload):
                guard
                    let eventID = UUID(uuidString: payload.eventId),
                    payload.revision >= 0
                else {
                    throw UserEventRepositoryError.invalidResponse
                }
                if payload.replayed {
                    return .replayed(
                        eventID: eventID,
                        revision: payload.revision
                    )
                }
                return .created(
                    eventID: eventID,
                    revision: payload.revision
                )
            }
        case .badRequest:
            throw UserEventRepositoryError.invalidInput
        case .notFound:
            throw UserEventRepositoryError.invalidResponse
        case .unauthorized:
            throw APIError.unauthorized
        case .forbidden:
            throw UserEventRepositoryError
                .eligibilityOrAuthorityRequired
        case .conflict:
            throw UserEventRepositoryError.requestConflict
        case .unprocessableContent:
            throw UserEventRepositoryError.placeUnresolved
        case .tooManyRequests:
            throw UserEventRepositoryError.rateLimited
        case .serviceUnavailable:
            throw UserEventRepositoryError.unavailable
        case .undocumented(let status, _):
            throw APIError.server(status: status, code: nil)
        }
    }

    func update(
        eventID: UUID,
        baseline: ManagedUserEvent,
        expectedRevision: Int,
        patch: UserEventEditPatchIntent
    ) async throws -> UserEventEditOutcome {
        guard baseline.isEditable else {
            throw UserEventRepositoryError.eventNoLongerEditable
        }
        guard !patch.isEmpty else {
            throw UserEventRepositoryError.emptyEditPatch
        }
        guard patch.hasValidURL else {
            throw UserEventRepositoryError.invalidInput
        }
        guard patch.hasValidEffectiveSchedule(against: baseline) else {
            throw UserEventRepositoryError.invalidTimeRange
        }

        let output = try await retrier.run(
            method: .mutation
        ) { [client] in
            try await client.updateUserEvent(
                .init(
                    path: .init(
                        id: eventID.uuidString.lowercased()
                    ),
                    body: .json(
                        .init(
                            value2: .init(
                                version: 2,
                                expectedRevision: expectedRevision,
                                patch: .init(
                                    title: patch.title.generated,
                                    description:
                                        patch.description
                                        .generatedDescription,
                                    start: patch.start.generated,
                                    end: patch.end.generatedEnd,
                                    category:
                                        patch.category.generatedCategory,
                                    url: patch.url.generatedURL,
                                    placeId:
                                        patch.canonicalPlaceID.generated
                                )
                            )
                        )
                    )
                )
            )
        }

        switch output {
        case .ok(let response):
            switch response.body {
            case .json(let payload):
                return .updated(
                    try Self.mutation(
                        payload,
                        expectedEventID: eventID
                    )
                )
            }
        case .badRequest:
            throw UserEventRepositoryError.invalidInput
        case .notFound:
            throw UserEventRepositoryError.invalidResponse
        case .unauthorized:
            throw APIError.unauthorized
        case .forbidden:
            throw UserEventRepositoryError
                .eligibilityOrAuthorityRequired
        case .conflict:
            let latest = try await detail(eventID: eventID)
            guard
                latest.id == eventID,
                latest.revision >= 0
            else {
                throw UserEventRepositoryError.invalidResponse
            }
            return .conflict(
                UserEventEditConflictReview(
                    eventID: eventID,
                    expectedRevision: expectedRevision,
                    latestRevision: latest.revision,
                    latestEvent: latest,
                    fields: patch.conflictFields(
                        baseline: baseline,
                        latest: latest
                    )
                )
            )
        case .unprocessableContent:
            throw UserEventRepositoryError.placeUnresolved
        case .tooManyRequests:
            throw UserEventRepositoryError.rateLimited
        case .serviceUnavailable:
            throw UserEventRepositoryError.unavailable
        case .undocumented(let status, _):
            throw APIError.server(status: status, code: nil)
        }
    }

    func cancel(
        eventID: UUID
    ) async throws -> UserEventMutationOutcome {
        let output = try await retrier.run(
            method: .mutation
        ) { [client] in
            try await client.deleteUserEvent(
                .init(
                    path: .init(
                        id: eventID.uuidString.lowercased()
                    )
                )
            )
        }

        switch output {
        case .ok(let response):
            switch response.body {
            case .json(let payload):
                return try Self.mutation(
                    payload,
                    expectedEventID: eventID
                )
            }
        case .badRequest, .notFound:
            throw UserEventRepositoryError.invalidResponse
        case .unauthorized:
            throw APIError.unauthorized
        case .forbidden:
            throw UserEventRepositoryError
                .eligibilityOrAuthorityRequired
        case .tooManyRequests:
            throw UserEventRepositoryError.rateLimited
        case .serviceUnavailable:
            throw UserEventRepositoryError.unavailable
        case .undocumented(let status, _):
            throw APIError.server(status: status, code: nil)
        }
    }

    func page(
        before cursor: UserEventManagementCursor?,
        limit: Int
    ) async throws -> UserEventManagementPage {
        guard limit > 0 else {
            throw UserEventRepositoryError.invalidPageSize
        }
        let boundedLimit = min(limit, 100)
        return try await retrier.run(
            method: .get
        ) { [client] in
            let output = try await client.listMyUserEvents(
                .init(
                    query: .init(
                        beforeUpdatedAt: cursor?.beforeUpdatedAt,
                        beforeEventId:
                            cursor?.beforeEventID.uuidString.lowercased(),
                        limit: boundedLimit
                    )
                )
            )

            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    return UserEventManagementPage(
                        events: try payload.events.map(Self.managedEvent),
                        next: try payload.next.map(Self.cursor)
                    )
                }
            case .badRequest:
                throw UserEventRepositoryError.invalidResponse
            case .unauthorized:
                throw APIError.unauthorized
            case .forbidden:
                throw UserEventRepositoryError
                    .eligibilityOrAuthorityRequired
            case .tooManyRequests:
                throw UserEventRepositoryError.rateLimited
            case .serviceUnavailable:
                throw UserEventRepositoryError.unavailable
            case .undocumented(let status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    func allManageableEvents(
        pageSize: Int
    ) async throws -> [ManagedUserEvent] {
        guard pageSize > 0 else {
            throw UserEventRepositoryError.invalidPageSize
        }

        let limit = min(pageSize, 100)
        var events: [ManagedUserEvent] = []
        var cursor: UserEventManagementCursor?
        var seenCursors: Set<UserEventManagementCursor> = []

        while true {
            let nextPage = try await page(
                before: cursor,
                limit: limit
            )
            events.append(contentsOf: nextPage.events)
            guard let next = nextPage.next else {
                return events
            }
            guard seenCursors.insert(next).inserted else {
                throw UserEventRepositoryError.invalidResponse
            }
            cursor = next
        }
    }

    func detail(
        eventID: UUID
    ) async throws -> ManagedUserEvent {
        return try await retrier.run(
            method: .get
        ) { [client] in
            let output = try await client.getMyUserEvent(
                .init(
                    path: .init(
                        id: eventID.uuidString.lowercased()
                    )
                )
            )

            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    let event = try Self.managedEvent(payload)
                    guard event.id == eventID else {
                        throw UserEventRepositoryError.invalidResponse
                    }
                    return event
                }
            case .badRequest, .notFound:
                throw UserEventRepositoryError.invalidResponse
            case .unauthorized:
                throw APIError.unauthorized
            case .forbidden:
                throw UserEventRepositoryError
                    .eligibilityOrAuthorityRequired
            case .tooManyRequests:
                throw UserEventRepositoryError.rateLimited
            case .serviceUnavailable:
                throw UserEventRepositoryError.unavailable
            case .undocumented(let status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    private static func mutation(
        _ payload: Components.Schemas.UserEventMutationResult,
        expectedEventID: UUID
    ) throws -> UserEventMutationOutcome {
        guard
            let eventID = UUID(uuidString: payload.eventId),
            eventID == expectedEventID,
            payload.revision >= 0
        else {
            throw UserEventRepositoryError.invalidResponse
        }
        return UserEventMutationOutcome(
            eventID: eventID,
            revision: payload.revision,
            changed: payload.changed
        )
    }

    private static func managedEvent(
        _ payload: Components.Schemas.UserEventManagement
    ) throws -> ManagedUserEvent {
        guard
            let id = UUID(uuidString: payload.id),
            payload.revision >= 0
        else {
            throw UserEventRepositoryError.invalidResponse
        }

        let owner: UserEventOwner
        switch (
            payload.organizationId,
            payload.organizationName
        ) {
        case (nil, nil):
            owner = .personal
        case (.some(let id), .some(let name)):
            owner = .organization(id: id, name: name)
        case (.some, nil), (nil, .some):
            throw UserEventRepositoryError.invalidResponse
        }

        let url: URL?
        if let rawURL = payload.url {
            guard let parsedURL = UserEventHTTPSURL.parse(rawURL) else {
                throw UserEventRepositoryError.invalidResponse
            }
            url = parsedURL
        } else {
            url = nil
        }

        return ManagedUserEvent(
            id: id,
            owner: owner,
            title: payload.title,
            description: payload.description,
            start: payload.start,
            end: payload.end,
            canonicalPlaceID: payload.placeId,
            placeName: payload.placeName,
            category: payload.category.domain,
            url: url,
            status: payload.status.domain,
            moderationState: payload.moderationState.domain,
            revision: payload.revision,
            deletedAt: payload.deletedAt,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt
        )
    }

    private static func cursor(
        _ payload: Components.Schemas.UserEventManagementCursor
    ) throws -> UserEventManagementCursor {
        guard let eventID = UUID(uuidString: payload.beforeEventId) else {
            throw UserEventRepositoryError.invalidResponse
        }
        return UserEventManagementCursor(
            beforeUpdatedAt: payload.beforeUpdatedAt,
            beforeEventID: eventID
        )
    }
}

extension UserEventCategory {
    fileprivate var generated: Components.Schemas.Category {
        switch self {
        case .academic:
            return .academic
        case .class:
            return ._class
        case .club:
            return .club
        case .arts:
            return .arts
        case .athletics:
            return .athletics
        case .food:
            return .food
        case .social:
            return .social
        case .career:
            return .career
        case .wellness:
            return .wellness
        case .admin:
            return .admin
        }
    }
}

extension Components.Schemas.Category {
    fileprivate var domain: UserEventCategory {
        switch self {
        case .academic:
            return .academic
        case ._class:
            return .class
        case .club:
            return .club
        case .arts:
            return .arts
        case .athletics:
            return .athletics
        case .food:
            return .food
        case .social:
            return .social
        case .career:
            return .career
        case .wellness:
            return .wellness
        case .admin:
            return .admin
        }
    }
}

extension Components.Schemas.UserEventManagement.StatusPayload {
    fileprivate var domain: UserEventStatus {
        switch self {
        case .draft:
            return .draft
        case .published:
            return .published
        case .canceled:
            return .canceled
        }
    }
}

extension Components.Schemas.UserEventManagement
    .ModerationStatePayload
{
    fileprivate var domain: UserEventModerationState {
        switch self {
        case .active:
            return .active
        case .hidden:
            return .hidden
        }
    }
}

extension UserEventEditPatchIntent {
    fileprivate var hasValidURL: Bool {
        switch url {
        case .unchanged, .clear:
            return true
        case .set(let value):
            return UserEventHTTPSURL.isValid(value)
        }
    }

    func hasValidEffectiveSchedule(
        against baseline: ManagedUserEvent
    ) -> Bool {
        let effectiveStart: Date
        switch start {
        case .unchanged:
            effectiveStart = baseline.start
        case .set(let value):
            effectiveStart = value
        }

        let effectiveEnd: Date?
        switch end {
        case .unchanged:
            effectiveEnd = baseline.end
        case .set(let value):
            effectiveEnd = value
        case .clear:
            effectiveEnd = nil
        }

        guard let effectiveEnd else { return true }
        return effectiveEnd > effectiveStart
    }
}

extension UserEventEditPatchIntent {
    fileprivate var isEmpty: Bool {
        title.isUnchanged
            && description.isUnchanged
            && start.isUnchanged
            && end.isUnchanged
            && category.isUnchanged
            && url.isUnchanged
            && canonicalPlaceID.isUnchanged
    }

    fileprivate func conflictFields(
        baseline: ManagedUserEvent,
        latest: ManagedUserEvent
    ) -> [UserEventEditFieldComparison] {
        var fields: [UserEventEditFieldComparison] = []

        if case .set(let value) = title {
            fields.append(
                .init(
                    field: .title,
                    baseline: .text(baseline.title),
                    submitted: .text(value),
                    latest: .text(latest.title)
                )
            )
        }
        if !description.isUnchanged {
            fields.append(
                .init(
                    field: .description,
                    baseline: .optionalText(baseline.description),
                    submitted: description.comparisonValue,
                    latest: .optionalText(latest.description)
                )
            )
        }
        if case .set(let value) = start {
            fields.append(
                .init(
                    field: .start,
                    baseline: .date(baseline.start),
                    submitted: .date(value),
                    latest: .date(latest.start)
                )
            )
        }
        if !end.isUnchanged {
            fields.append(
                .init(
                    field: .end,
                    baseline: .optionalDate(baseline.end),
                    submitted: end.comparisonValue,
                    latest: .optionalDate(latest.end)
                )
            )
        }
        if case .set(let value) = category {
            fields.append(
                .init(
                    field: .category,
                    baseline: .category(baseline.category),
                    submitted: .category(value),
                    latest: .category(latest.category)
                )
            )
        }
        if !url.isUnchanged {
            fields.append(
                .init(
                    field: .url,
                    baseline: .optionalURL(baseline.url),
                    submitted: url.comparisonValue,
                    latest: .optionalURL(latest.url)
                )
            )
        }
        if case .set(let value) = canonicalPlaceID {
            fields.append(
                .init(
                    field: .canonicalPlaceID,
                    baseline: .text(baseline.canonicalPlaceID),
                    submitted: .text(value),
                    latest: .text(latest.canonicalPlaceID)
                )
            )
        }

        return fields
    }
}

extension UserEventSetIntent {
    fileprivate var isUnchanged: Bool {
        if case .unchanged = self {
            return true
        }
        return false
    }
}

extension UserEventNullableEditIntent {
    fileprivate var isUnchanged: Bool {
        if case .unchanged = self {
            return true
        }
        return false
    }
}

extension UserEventSetIntent where Value == String {
    fileprivate var generated: String? {
        switch self {
        case .unchanged:
            return nil
        case .set(let value):
            return value
        }
    }
}

extension UserEventSetIntent where Value == Date {
    fileprivate var generated: Date? {
        switch self {
        case .unchanged:
            return nil
        case .set(let value):
            return value
        }
    }
}

extension UserEventSetIntent
where Value == UserEventCategory {
    fileprivate var generatedCategory: Components.Schemas.Category? {
        switch self {
        case .unchanged:
            return nil
        case .set(let value):
            return value.generated
        }
    }
}

extension UserEventNullableEditIntent where Value == String {
    fileprivate var generatedDescription: Components.Schemas.UserEventEditDescriptionCommand? {
        switch self {
        case .unchanged:
            return nil
        case .set(let value):
            return .init(action: .set, value: value)
        case .clear:
            return .init(action: .clear)
        }
    }

    fileprivate var comparisonValue: UserEventEditComparisonValue {
        switch self {
        case .unchanged, .clear:
            return .none
        case .set(let value):
            return .text(value)
        }
    }
}

extension UserEventNullableEditIntent where Value == Date {
    fileprivate var generatedEnd: Components.Schemas.UserEventEditEndCommand? {
        switch self {
        case .unchanged:
            return nil
        case .set(let value):
            return .init(action: .set, value: value)
        case .clear:
            return .init(action: .clear)
        }
    }

    fileprivate var comparisonValue: UserEventEditComparisonValue {
        switch self {
        case .unchanged, .clear:
            return .none
        case .set(let value):
            return .date(value)
        }
    }
}

extension UserEventNullableEditIntent where Value == URL {
    fileprivate var generatedURL: Components.Schemas.UserEventEditUrlCommand? {
        switch self {
        case .unchanged:
            return nil
        case .set(let value):
            return .init(action: .set, value: value.absoluteString)
        case .clear:
            return .init(action: .clear)
        }
    }

    fileprivate var comparisonValue: UserEventEditComparisonValue {
        switch self {
        case .unchanged, .clear:
            return .none
        case .set(let value):
            return .text(value.absoluteString)
        }
    }
}

extension UserEventEditComparisonValue {
    fileprivate static func optionalText(_ value: String?)
        -> UserEventEditComparisonValue
    {
        value.map(UserEventEditComparisonValue.text) ?? .none
    }

    fileprivate static func optionalDate(_ value: Date?)
        -> UserEventEditComparisonValue
    {
        value.map(UserEventEditComparisonValue.date) ?? .none
    }

    fileprivate static func optionalURL(_ value: URL?)
        -> UserEventEditComparisonValue
    {
        value.map {
            UserEventEditComparisonValue.text($0.absoluteString)
        } ?? .none
    }
}
