import Foundation

@testable import BrownSync

enum Phase3TestFailure: Error, Equatable, Sendable {
    case rateLimited
    case offline
    case subscriptionRejected
}

actor Phase3SocialTransportRecorder: SocialDatabaseTransport {
    struct RPCRecord: Sendable {
        let function: SocialRPC
        let payload: Data?
        let parameterType: String?
        let taskWasCancelled: Bool
    }

    private struct RPCWaiter {
        let count: Int
        let continuation: CheckedContinuation<Void, Never>
    }

    private struct SelectionWaiter {
        let count: Int
        let continuation: CheckedContinuation<Bool, Never>
    }

    private var rowFixtures: [SocialTable: Data]
    private var selectedTables: [SocialTable] = []
    private var rpcRecords: [RPCRecord] = []
    private var nextRPCFailure: (SocialRPC, Phase3TestFailure)?
    private var nextSelectFailure: (SocialTable, Phase3TestFailure)?
    private var blockedRPCs: Set<SocialRPC> = []
    private var blockedContinuations:
        [SocialRPC: [CheckedContinuation<Void, Never>]] = [:]
    private var rpcWaiters: [RPCWaiter] = []
    private var selectionWaiters: [UUID: SelectionWaiter] = [:]
    private var blockedSelections: Set<SocialTable> = []
    private var selectionCountsByTable: [SocialTable: Int] = [:]
    private var blockedSelectionOccurrences:
        [SocialTable: Set<Int>] = [:]
    private var blockedSelectionContinuations:
        [SocialTable: [CheckedContinuation<Void, Never>]] = [:]

    init(rows: [SocialTable: String] = [:]) {
        rowFixtures = rows.mapValues { Data($0.utf8) }
    }

    func setRows(_ json: String, for table: SocialTable) {
        rowFixtures[table] = Data(json.utf8)
    }

    func select<Row: Decodable & Sendable>(
        _ table: SocialTable,
        as _: Row.Type
    ) async throws -> [Row] {
        selectedTables.append(table)
        selectionCountsByTable[table, default: 0] += 1
        let tableOccurrence = selectionCountsByTable[table] ?? 0
        resumeSatisfiedSelectionWaiters()
        await blockSelectionIfRequested(
            table,
            occurrence: tableOccurrence
        )
        if let failure = nextSelectFailure, failure.0 == table {
            nextSelectFailure = nil
            throw failure.1
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(
            [Row].self,
            from: rowFixtures[table] ?? Data("[]".utf8)
        )
    }

    func rpc<Parameters: Encodable & Sendable>(
        _ function: SocialRPC,
        parameters: Parameters
    ) async throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        rpcRecords.append(
            RPCRecord(
                function: function,
                payload: try encoder.encode(parameters),
                parameterType: String(reflecting: Parameters.self),
                taskWasCancelled: Task.isCancelled
            )
        )
        resumeSatisfiedRPCWaiters()
        await blockIfRequested(function)
        try throwNextRPCFailureIfNeeded(function)
    }

    func rpc(_ function: SocialRPC) async throws {
        rpcRecords.append(
            RPCRecord(
                function: function,
                payload: nil,
                parameterType: nil,
                taskWasCancelled: Task.isCancelled
            )
        )
        resumeSatisfiedRPCWaiters()
        await blockIfRequested(function)
        try throwNextRPCFailureIfNeeded(function)
    }

    func failNextRPC(
        _ function: SocialRPC,
        with failure: Phase3TestFailure
    ) {
        nextRPCFailure = (function, failure)
    }

    func failNextSelect(
        _ table: SocialTable,
        with failure: Phase3TestFailure
    ) {
        nextSelectFailure = (table, failure)
    }

    func blockNextRPC(_ function: SocialRPC) {
        blockedRPCs.insert(function)
    }

    func releaseRPC(_ function: SocialRPC) {
        let continuations = blockedContinuations.removeValue(
            forKey: function
        ) ?? []
        continuations.forEach { $0.resume() }
    }

    func blockNextSelection(_ table: SocialTable) {
        blockedSelections.insert(table)
    }

    func blockSelection(
        _ table: SocialTable,
        occurrence: Int
    ) {
        blockedSelectionOccurrences[table, default: []]
            .insert(occurrence)
    }

    func releaseSelection(_ table: SocialTable) {
        let continuations = blockedSelectionContinuations.removeValue(
            forKey: table
        ) ?? []
        continuations.forEach { $0.resume() }
    }

    func waitForRPCCount(_ count: Int) async {
        guard rpcRecords.count < count else { return }
        await withCheckedContinuation { continuation in
            rpcWaiters.append(
                RPCWaiter(count: count, continuation: continuation)
            )
        }
    }

    @discardableResult
    func waitForSelectionCount(_ count: Int) async -> Bool {
        await awaitSelectionCount(
            count,
            waiterID: UUID()
        )
    }

    func waitForSelectionCount(
        _ count: Int,
        timeout: Duration
    ) async -> Bool {
        guard selectedTables.count < count else { return true }
        let waiterID = UUID()
        return await withTaskGroup(of: Bool.self) { group in
            group.addTask { [weak self] in
                guard let self else { return false }
                return await self.awaitSelectionCount(
                    count,
                    waiterID: waiterID
                )
            }
            group.addTask {
                do {
                    try await Task.sleep(for: timeout)
                    return false
                } catch {
                    return false
                }
            }

            let reachedCount = await group.next() ?? false
            group.cancelAll()
            while await group.next() != nil {}
            return reachedCount
        }
    }

    func selections() -> [SocialTable] {
        selectedTables
    }

    func records() -> [RPCRecord] {
        rpcRecords
    }

    private func blockIfRequested(_ function: SocialRPC) async {
        guard blockedRPCs.remove(function) != nil else { return }
        await withCheckedContinuation { continuation in
            blockedContinuations[function, default: []].append(continuation)
        }
    }

    private func blockSelectionIfRequested(
        _ table: SocialTable,
        occurrence: Int
    ) async {
        let isBlockedNext = blockedSelections.remove(table) != nil
        let isBlockedOccurrence =
            blockedSelectionOccurrences[table]?.remove(occurrence)
                != nil
        guard isBlockedNext || isBlockedOccurrence else { return }
        await withCheckedContinuation { continuation in
            blockedSelectionContinuations[table, default: []].append(
                continuation
            )
        }
    }

    private func throwNextRPCFailureIfNeeded(
        _ function: SocialRPC
    ) throws {
        guard let failure = nextRPCFailure, failure.0 == function else {
            return
        }
        nextRPCFailure = nil
        throw failure.1
    }

    private func resumeSatisfiedRPCWaiters() {
        var remaining: [RPCWaiter] = []
        for waiter in rpcWaiters {
            if rpcRecords.count >= waiter.count {
                waiter.continuation.resume()
            } else {
                remaining.append(waiter)
            }
        }
        rpcWaiters = remaining
    }

    private func resumeSatisfiedSelectionWaiters() {
        let matchingWaiterIDs = selectionWaiters.compactMap {
            waiterID, waiter in
            selectedTables.count >= waiter.count ? waiterID : nil
        }
        for waiterID in matchingWaiterIDs {
            selectionWaiters
                .removeValue(forKey: waiterID)?
                .continuation
                .resume(returning: true)
        }
    }

    private func awaitSelectionCount(
        _ count: Int,
        waiterID: UUID
    ) async -> Bool {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if selectedTables.count >= count {
                    continuation.resume(returning: true)
                } else if Task.isCancelled {
                    continuation.resume(returning: false)
                } else {
                    selectionWaiters[waiterID] = SelectionWaiter(
                        count: count,
                        continuation: continuation
                    )
                }
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelSelectionWaiter(
                    waiterID: waiterID
                )
            }
        }
    }

    private func cancelSelectionWaiter(waiterID: UUID) {
        selectionWaiters
            .removeValue(forKey: waiterID)?
            .continuation
            .resume(returning: false)
    }
}

actor Phase3ManualTimeSource: PresenceTimeProviding {
    private var current: PresenceTime

    init(
        wallClock: Date = Phase3Fixture.baseDate,
        monotonic: Duration = .zero
    ) {
        current = PresenceTime(
            wallClock: wallClock,
            monotonic: monotonic
        )
    }

    func now() -> PresenceTime {
        current
    }

    func advance(seconds: Int) {
        current = PresenceTime(
            wallClock: current.wallClock.addingTimeInterval(
                TimeInterval(seconds)
            ),
            monotonic: current.monotonic + .seconds(seconds)
        )
    }
}

actor Phase3GatedTimeSource: PresenceTimeProviding {
    private var current: PresenceTime
    private var shouldBlockNextNow = false
    private var nowCallCount = 0
    private var blockedNowContinuation:
        CheckedContinuation<Void, Never>?
    private var countWaiters:
        [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    init(
        wallClock: Date = Phase3Fixture.baseDate,
        monotonic: Duration = .zero
    ) {
        current = PresenceTime(
            wallClock: wallClock,
            monotonic: monotonic
        )
    }

    func blockNextNow() {
        shouldBlockNextNow = true
    }

    func now() async -> PresenceTime {
        nowCallCount += 1
        resumeSatisfiedCountWaiters()
        guard shouldBlockNextNow else { return current }
        shouldBlockNextNow = false
        await withCheckedContinuation { continuation in
            blockedNowContinuation = continuation
        }
        return current
    }

    func waitForNowCount(_ count: Int) async {
        guard nowCallCount < count else { return }
        await withCheckedContinuation { continuation in
            countWaiters.append(
                (count: count, continuation: continuation)
            )
        }
    }

    func releaseNow() {
        blockedNowContinuation?.resume()
        blockedNowContinuation = nil
    }

    private func resumeSatisfiedCountWaiters() {
        var remaining:
            [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []
        for waiter in countWaiters {
            if nowCallCount >= waiter.count {
                waiter.continuation.resume()
            } else {
                remaining.append(waiter)
            }
        }
        countWaiters = remaining
    }
}

actor Phase3ContinuousTimeSource: PresenceTimeProviding {
    private let clock = ContinuousClock()
    private let origin: ContinuousClock.Instant

    init() {
        origin = clock.now
    }

    func now() -> PresenceTime {
        PresenceTime(
            wallClock: Date(),
            monotonic: origin.duration(to: clock.now)
        )
    }
}

actor Phase3PresenceWriteSleeperFake: PresenceWriteSleeping {
    private var requestedDurations: [Duration] = []
    private var sleepContinuations:
        [CheckedContinuation<Void, Never>] = []
    private var countWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []

    func sleep(for duration: Duration) async throws {
        requestedDurations.append(duration)
        resumeSatisfiedCountWaiters()
        await withCheckedContinuation { continuation in
            sleepContinuations.append(continuation)
        }
    }

    func waitForSleepCount(_ count: Int) async {
        guard requestedDurations.count < count else { return }
        await withCheckedContinuation { continuation in
            countWaiters.append((count, continuation))
        }
    }

    func durations() -> [Duration] {
        requestedDurations
    }

    func releaseNextSleep() {
        guard !sleepContinuations.isEmpty else { return }
        sleepContinuations.removeFirst().resume()
    }

    private func resumeSatisfiedCountWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in countWaiters {
            if requestedDurations.count >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        countWaiters = remaining
    }
}

actor Phase3CallLog {
    private var entries: [String] = []

    func append(_ entry: String) {
        entries.append(entry)
    }

    func values() -> [String] {
        entries
    }
}

actor Phase3AsyncGate {
    private var isOpen = false
    private var continuations:
        [CheckedContinuation<Void, Never>] = []
    private var countWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
            resumeSatisfiedCountWaiters()
        }
    }

    func waitForWaiterCount(_ count: Int) async {
        guard continuations.count < count else { return }
        await withCheckedContinuation { continuation in
            countWaiters.append((count, continuation))
        }
    }

    func releaseAll() {
        isOpen = true
        let waiting = continuations
        continuations.removeAll()
        waiting.forEach { $0.resume() }
    }

    private func resumeSatisfiedCountWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in countWaiters {
            if continuations.count >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        countWaiters = remaining
    }
}

actor Phase3RealtimeChannelFake: PresenceRealtimeChannel {
    private struct FailureStreamTerminationWaiter {
        let streamIndex: Int
        let continuation: CheckedContinuation<Bool, Never>
    }

    private let log: Phase3CallLog
    private let stream: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation
    private var subscribeFailure: Phase3TestFailure?
    private var blocksNextSubscription = false
    private var blockedSubscriptions:
        [CheckedContinuation<Void, Never>] = []
    private var subscribeCount = 0
    private var subscribeWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []
    private var blocksNextRemoval = false
    private var blockedRemovals:
        [CheckedContinuation<Void, Never>] = []
    private var terminatedFailureStreamIndices: Set<Int> = []
    private var failureStreamTerminationWaiters:
        [UUID: FailureStreamTerminationWaiter] = [:]
    private var removeCount = 0
    private var removeWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []
    private var failureContinuations:
        [AsyncStream<Void>.Continuation] = []

    init(log: Phase3CallLog) {
        self.log = log
        var storedContinuation: AsyncStream<Void>.Continuation?
        stream = AsyncStream { storedContinuation = $0 }
        continuation = storedContinuation!
    }

    func failSubscription(with failure: Phase3TestFailure) {
        subscribeFailure = failure
    }

    func anyActionInvalidations() async -> AsyncStream<Void> {
        await log.append("channel.any-action-stream")
        return stream
    }

    func connectionFailures() async -> AsyncStream<Void> {
        let streamIndex = failureContinuations.count
        var storedContinuation: AsyncStream<Void>.Continuation?
        let stream = AsyncStream<Void> { continuation in
            continuation.onTermination = { [weak self] _ in
                Task {
                    await self?.recordFailureStreamTermination(
                        streamAt: streamIndex
                    )
                }
            }
            storedContinuation = continuation
        }
        failureContinuations.append(storedContinuation!)
        return stream
    }

    func subscribeWithError() async throws {
        await log.append("channel.subscribe")
        subscribeCount += 1
        resumeSatisfiedSubscribeWaiters()
        if blocksNextSubscription {
            blocksNextSubscription = false
            await withCheckedContinuation { continuation in
                blockedSubscriptions.append(continuation)
            }
        }
        if let subscribeFailure {
            throw subscribeFailure
        }
    }

    func remove() async {
        await log.append("channel.remove")
        removeCount += 1
        resumeSatisfiedRemoveWaiters()
        if blocksNextRemoval {
            blocksNextRemoval = false
            await withCheckedContinuation { continuation in
                blockedRemovals.append(continuation)
            }
        }
    }

    func emitAnyAction() {
        continuation.yield(())
    }

    @discardableResult
    func emitConnectionFailure(streamAt index: Int) -> Bool {
        guard failureContinuations.indices.contains(index) else {
            return false
        }
        switch failureContinuations[index].yield(()) {
        case .enqueued(_), .dropped(_):
            return true
        case .terminated:
            return false
        @unknown default:
            return false
        }
    }

    func waitForConnectionFailureStreamTermination(
        streamAt index: Int,
        timeout: Duration = .seconds(1)
    ) async -> Bool {
        let waiterID = UUID()
        return await withTaskGroup(of: Bool.self) { group in
            group.addTask { [weak self] in
                guard let self else { return false }
                return await self.awaitConnectionFailureStreamTermination(
                    streamAt: index,
                    waiterID: waiterID
                )
            }
            group.addTask {
                do {
                    try await Task.sleep(for: timeout)
                    return false
                } catch {
                    return false
                }
            }

            let didTerminate = await group.next() ?? false
            group.cancelAll()
            while await group.next() != nil {}
            return didTerminate
        }
    }

    func blockNextSubscribe() {
        blocksNextSubscription = true
    }

    func blockNextRemove() {
        blocksNextRemoval = true
    }

    func releaseSubscribe() {
        let continuations = blockedSubscriptions
        blockedSubscriptions.removeAll()
        continuations.forEach { $0.resume() }
    }

    func releaseRemove() {
        let continuations = blockedRemovals
        blockedRemovals.removeAll()
        continuations.forEach { $0.resume() }
    }

    func waitForSubscribeCount(_ count: Int) async {
        guard subscribeCount < count else { return }
        await withCheckedContinuation { continuation in
            subscribeWaiters.append((count, continuation))
        }
    }

    func numberOfSubscriptions() -> Int {
        subscribeCount
    }

    func waitForRemoveCount(_ count: Int) async {
        guard removeCount < count else { return }
        await withCheckedContinuation { continuation in
            removeWaiters.append((count, continuation))
        }
    }

    func finish() {
        continuation.finish()
    }

    private func resumeSatisfiedSubscribeWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in subscribeWaiters {
            if subscribeCount >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        subscribeWaiters = remaining
    }

    private func resumeSatisfiedRemoveWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in removeWaiters {
            if removeCount >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        removeWaiters = remaining
    }

    private func recordFailureStreamTermination(streamAt index: Int) {
        terminatedFailureStreamIndices.insert(index)
        let matchingWaiterIDs =
            failureStreamTerminationWaiters.compactMap {
                waiterID, waiter in
                waiter.streamIndex == index ? waiterID : nil
            }
        for waiterID in matchingWaiterIDs {
            failureStreamTerminationWaiters
                .removeValue(forKey: waiterID)?
                .continuation
                .resume(returning: true)
        }
    }

    private func awaitConnectionFailureStreamTermination(
        streamAt index: Int,
        waiterID: UUID
    ) async -> Bool {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if terminatedFailureStreamIndices.contains(index) {
                    continuation.resume(returning: true)
                } else if Task.isCancelled {
                    continuation.resume(returning: false)
                } else {
                    failureStreamTerminationWaiters[waiterID] =
                        FailureStreamTerminationWaiter(
                            streamIndex: index,
                            continuation: continuation
                        )
                }
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelFailureStreamTerminationWaiter(
                    waiterID: waiterID
                )
            }
        }
    }

    private func cancelFailureStreamTerminationWaiter(
        waiterID: UUID
    ) {
        failureStreamTerminationWaiters
            .removeValue(forKey: waiterID)?
            .continuation
            .resume(returning: false)
    }
}

actor Phase3ReconciliationTickerFake: PresenceReconciliationTicking {
    private let stream: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation

    init() {
        var storedContinuation: AsyncStream<Void>.Continuation?
        stream = AsyncStream { storedContinuation = $0 }
        continuation = storedContinuation!
    }

    func ticks() -> AsyncStream<Void> {
        stream
    }

    func tick() {
        continuation.yield(())
    }

    func finish() {
        continuation.finish()
    }
}

enum Phase3Fixture {
    static let me = UUID(
        uuidString: "00000000-0000-4000-8000-000000000001"
    )!
    static let friend = UUID(
        uuidString: "00000000-0000-4000-8000-000000000002"
    )!
    static let other = UUID(
        uuidString: "00000000-0000-4000-8000-000000000003"
    )!
    static let baseDate = Date(timeIntervalSince1970: 1_800_000_000)

    static func profile(
        id: UUID = friend,
        handle: String = "bruno"
    ) -> SocialProfile {
        SocialProfile(
            id: id,
            handle: handle,
            displayName: "Bruno Bear",
            avatarURL: URL(string: "https://example.invalid/bruno.png"),
            classYear: 2027,
            concentration: "Computer Science",
            bio: "On College Hill.",
            createdAt: baseDate,
            updatedAt: baseDate
        )
    }

    static func friendship(
        requesterID: UUID = me,
        addresseeID: UUID = friend,
        status: FriendshipStatus = .accepted
    ) -> Friendship {
        Friendship(
            requesterID: requesterID,
            addresseeID: addresseeID,
            status: status,
            blockedByID: nil,
            createdAt: baseDate,
            respondedAt: baseDate
        )
    }

    static func share(
        ownerID: UUID = me,
        viewerID: UUID = friend
    ) -> PresenceShare {
        PresenceShare(
            ownerID: ownerID,
            viewerID: viewerID,
            expiresAt: baseDate.addingTimeInterval(3_600),
            createdAt: baseDate
        )
    }

    static func presence(
        userID: UUID = friend,
        placeID: String = "rockefeller-library",
        expiresIn: TimeInterval = 300,
        ghost: Bool = false
    ) -> PresenceState {
        PresenceState(
            userID: userID,
            placeID: placeID,
            status: .studying,
            note: "Third floor",
            ghost: ghost,
            updatedAt: baseDate,
            expiresAt: baseDate.addingTimeInterval(expiresIn)
        )
    }

    static func snapshot(
        presence: [PresenceState] = [Phase3Fixture.presence()]
    ) -> SocialSnapshot {
        SocialSnapshot(
            profiles: [profile()],
            friendships: [friendship()],
            shares: [share()],
            presence: presence
        )
    }
}

struct Phase3PlaceRepositoryFake: PlaceRepository {
    let listedPlaces: [PublicPlace]

    init(listedPlaces: [PublicPlace] = []) {
        self.listedPlaces = listedPlaces
    }

    func places(
        policy _: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicPlace]> {
        PublicResource(value: listedPlaces, source: .cache)
    }

    func activity(
        id: String,
        at _: Date?,
        policy _: PublicLoadPolicy
    ) async throws -> PublicResource<PublicPlaceActivity> {
        guard let place = listedPlaces.first(where: { $0.id == id }) else {
            throw Phase3TestFailure.offline
        }
        return PublicResource(
            value: PublicPlaceActivity(
                place: place,
                events: [],
                meetingCount: 0
            ),
            source: .cache
        )
    }
}

func phase3JSONObject(_ data: Data?) throws -> [String: Any] {
    guard let data else { return [:] }
    return try JSONSerialization.jsonObject(with: data) as? [String: Any]
        ?? [:]
}

func phase3AllJSONKeys(in value: Any) -> Set<String> {
    if let object = value as? [String: Any] {
        return object.reduce(into: Set(object.keys)) { result, entry in
            result.formUnion(phase3AllJSONKeys(in: entry.value))
        }
    }
    if let array = value as? [Any] {
        return array.reduce(into: []) { result, element in
            result.formUnion(phase3AllJSONKeys(in: element))
        }
    }
    return []
}
