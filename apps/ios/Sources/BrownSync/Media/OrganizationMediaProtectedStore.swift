import Foundation
import OpenAPIRuntime

protocol OrganizationMediaProtectedStore: Sendable {
    func stage(
        _ bytes: Data,
        contentType: OrganizationMediaContentType
    ) async throws -> PreparedOrganizationImage

    func body(
        for prepared: PreparedOrganizationImage
    ) async throws -> HTTPBody

    @discardableResult
    func purge(
        _ handle: ProtectedOrganizationMediaHandle,
        reason: OrganizationMediaPurgeReason
    ) async -> Bool

    @discardableResult
    func purgeAll(reason: SensitiveCachePurgeReason) async -> Bool
}

private final class ProtectedMediaSessionRegistry:
    @unchecked Sendable
{
    static let shared = ProtectedMediaSessionRegistry()

    private let lock = NSLock()
    private var activePaths: Set<String> = []

    func register(_ url: URL) {
        lock.lock()
        activePaths.insert(url.standardizedFileURL.path)
        lock.unlock()
    }

    func unregister(_ url: URL) {
        lock.lock()
        activePaths.remove(url.standardizedFileURL.path)
        lock.unlock()
    }

    func isActive(_ url: URL) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return activePaths.contains(url.standardizedFileURL.path)
    }
}

private actor ProtectedFileBodyReader {
    private let handle: FileHandle
    private let byteCount: Int
    private let chunkSize: Int
    private var bytesRead = 0
    private var isClosed = false

    init(
        url: URL,
        byteCount: Int,
        chunkSize: Int
    ) throws {
        handle = try FileHandle(forReadingFrom: url)
        self.byteCount = byteCount
        self.chunkSize = chunkSize
    }

    deinit {
        try? handle.close()
    }

    func next() throws -> HTTPBody.ByteChunk? {
        do {
            try Task.checkCancellation()
            guard !isClosed else { return nil }
            guard bytesRead < byteCount else {
                try close()
                return nil
            }
            let requested = min(
                chunkSize,
                byteCount - bytesRead
            )
            guard
                let data = try handle.read(upToCount: requested),
                !data.isEmpty
            else {
                throw OrganizationAssetError.invalidSelection
            }
            bytesRead += data.count
            guard bytesRead <= byteCount else {
                throw OrganizationAssetError.invalidSelection
            }
            if bytesRead == byteCount {
                try close()
            }
            return ArraySlice(data)
        } catch is CancellationError {
            try? close()
            throw CancellationError()
        } catch let error as OrganizationAssetError {
            try? close()
            throw error
        } catch {
            try? close()
            throw OrganizationAssetError.unavailable
        }
    }

    private func close() throws {
        guard !isClosed else { return }
        try handle.close()
        isClosed = true
    }
}

private struct ProtectedFileBodySequence:
    AsyncSequence,
    Sendable
{
    typealias Element = HTTPBody.ByteChunk

    struct AsyncIterator: AsyncIteratorProtocol {
        private let reader: ProtectedFileBodyReader

        init(reader: ProtectedFileBodyReader) {
            self.reader = reader
        }

        mutating func next() async throws -> HTTPBody.ByteChunk? {
            try await reader.next()
        }
    }

    private let reader: ProtectedFileBodyReader

    init(
        url: URL,
        byteCount: Int,
        chunkSize: Int
    ) throws {
        reader = try ProtectedFileBodyReader(
            url: url,
            byteCount: byteCount,
            chunkSize: chunkSize
        )
    }

    func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator(reader: reader)
    }
}

actor FileBackedOrganizationMediaProtectedStore:
    OrganizationMediaProtectedStore
{
    private enum Entry {
        case memory(
            bytes: Data,
            contentType: OrganizationMediaContentType
        )
        case file(
            url: URL,
            byteCount: Int,
            contentType: OrganizationMediaContentType
        )

        var byteCount: Int {
            switch self {
            case .memory(let bytes, _):
                return bytes.count
            case .file(_, let byteCount, _):
                return byteCount
            }
        }

        var contentType: OrganizationMediaContentType {
            switch self {
            case .memory(_, let contentType),
                .file(_, _, let contentType):
                return contentType
            }
        }
    }

    private let rootDirectory: URL
    private let sessionDirectory: URL
    private let memoryThreshold: Int
    private let fileManager: FileManager
    private let sessionRegistry: ProtectedMediaSessionRegistry
    private let streamChunkSize = 64 * 1_024
    private var entries: [ProtectedOrganizationMediaHandle: Entry] = [:]

    init(
        rootDirectory: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "BrownSyncOrganizationMedia",
                isDirectory: true
            ),
        memoryThreshold: Int = 256 * 1_024,
        fileManager: FileManager = .default,
        staleSessionAge: TimeInterval = 24 * 60 * 60,
        now: Date = Date()
    ) {
        self.rootDirectory = rootDirectory
        self.memoryThreshold = max(0, memoryThreshold)
        self.fileManager = fileManager
        sessionRegistry = .shared
        sessionDirectory = rootDirectory.appendingPathComponent(
            UUID().uuidString.lowercased(),
            isDirectory: true
        )
        sessionRegistry.register(sessionDirectory)

        try? fileManager.createDirectory(
            at: rootDirectory,
            withIntermediateDirectories: true
        )
        if let abandoned = try? fileManager.contentsOfDirectory(
            at: rootDirectory,
            includingPropertiesForKeys: [
                .contentModificationDateKey,
                .isDirectoryKey,
            ]
        ) {
            for url in abandoned {
                guard
                    url != sessionDirectory,
                    !sessionRegistry.isActive(url),
                    let values = try? url.resourceValues(
                        forKeys: [
                            .contentModificationDateKey,
                            .isDirectoryKey,
                        ]
                    ),
                    values.isDirectory == true,
                    let modifiedAt = values.contentModificationDate,
                    now.timeIntervalSince(modifiedAt) >= staleSessionAge
                else {
                    continue
                }
                try? fileManager.removeItem(at: url)
            }
        }
        var rootValues = URLResourceValues()
        rootValues.isExcludedFromBackup = true
        var mutableRoot = rootDirectory
        try? mutableRoot.setResourceValues(rootValues)
    }

    deinit {
        sessionRegistry.unregister(sessionDirectory)
    }

    func stage(
        _ bytes: Data,
        contentType: OrganizationMediaContentType
    ) async throws -> PreparedOrganizationImage {
        try Task.checkCancellation()
        guard
            !bytes.isEmpty,
            bytes.count <= 8_388_608
        else {
            throw OrganizationAssetError.invalidSelection
        }
        let handle = uniqueHandle()
        let entry: Entry
        if bytes.count <= memoryThreshold {
            entry = .memory(
                bytes: bytes,
                contentType: contentType
            )
        } else {
            try fileManager.createDirectory(
                at: sessionDirectory,
                withIntermediateDirectories: true
            )
            var sessionValues = URLResourceValues()
            sessionValues.isExcludedFromBackup = true
            var mutableSession = sessionDirectory
            try mutableSession.setResourceValues(sessionValues)

            let url = sessionDirectory.appendingPathComponent(
                UUID().uuidString.lowercased(),
                isDirectory: false
            )
            do {
                try bytes.write(
                    to: url,
                    options: [.atomic, .completeFileProtection]
                )
                var fileValues = URLResourceValues()
                fileValues.isExcludedFromBackup = true
                var mutableURL = url
                try mutableURL.setResourceValues(fileValues)
            } catch {
                try? fileManager.removeItem(at: url)
                removeSessionDirectoryIfEmpty()
                throw OrganizationAssetError.unavailable
            }
            entry = .file(
                url: url,
                byteCount: bytes.count,
                contentType: contentType
            )
        }
        entries[handle] = entry
        return PreparedOrganizationImage(
            handle: handle,
            contentType: contentType,
            byteCount: bytes.count
        )
    }

    func body(
        for prepared: PreparedOrganizationImage
    ) async throws -> HTTPBody {
        try Task.checkCancellation()
        guard
            let entry = entries[prepared.handle],
            entry.byteCount == prepared.byteCount,
            entry.contentType == prepared.contentType
        else {
            throw OrganizationAssetError.invalidSelection
        }
        switch entry {
        case .memory(let value, _):
            try Task.checkCancellation()
            return HTTPBody(value)
        case .file(let url, let byteCount, _):
            guard
                let values = try? url.resourceValues(
                    forKeys: [.fileSizeKey]
                ),
                values.fileSize == byteCount
            else {
                throw OrganizationAssetError.invalidSelection
            }
            let sequence = try ProtectedFileBodySequence(
                url: url,
                byteCount: byteCount,
                chunkSize: streamChunkSize
            )
            try Task.checkCancellation()
            return HTTPBody(
                sequence,
                length: .known(Int64(byteCount)),
                iterationBehavior: .single
            )
        }
    }

    @discardableResult
    func purge(
        _ handle: ProtectedOrganizationMediaHandle,
        reason _: OrganizationMediaPurgeReason
    ) async -> Bool {
        guard let entry = entries[handle] else {
            return true
        }
        if case .file(let url, _, _) = entry {
            do {
                if fileManager.fileExists(atPath: url.path) {
                    try fileManager.removeItem(at: url)
                }
            } catch {
                return false
            }
            guard !fileManager.fileExists(atPath: url.path) else {
                return false
            }
        }
        entries.removeValue(forKey: handle)
        removeSessionDirectoryIfEmpty()
        return true
    }

    @discardableResult
    func purgeAll(reason _: SensitiveCachePurgeReason) async -> Bool {
        do {
            if fileManager.fileExists(atPath: sessionDirectory.path) {
                try fileManager.removeItem(at: sessionDirectory)
            }
        } catch {
            return false
        }
        guard
            !fileManager.fileExists(atPath: sessionDirectory.path)
        else {
            return false
        }
        entries.removeAll(keepingCapacity: false)
        return true
    }

    private func uniqueHandle() -> ProtectedOrganizationMediaHandle {
        while true {
            let handle = ProtectedOrganizationMediaHandle(id: UUID())
            if entries[handle] == nil {
                return handle
            }
        }
    }

    private func removeSessionDirectoryIfEmpty() {
        guard
            let contents = try? fileManager.contentsOfDirectory(
                atPath: sessionDirectory.path
            ),
            contents.isEmpty
        else {
            return
        }
        try? fileManager.removeItem(at: sessionDirectory)
    }
}

struct OrganizationMediaProtectedLifecycle: Sendable {
    private let store: any OrganizationMediaProtectedStore

    init(store: any OrganizationMediaProtectedStore) {
        self.store = store
    }

    @discardableResult
    func finish(
        _ prepared: PreparedOrganizationImage,
        reason: OrganizationMediaPurgeReason
    ) async -> Bool {
        await store.purge(prepared.handle, reason: reason)
    }
}

struct OrganizationMediaSensitiveCachePurger:
    SensitiveCachePurging,
    Sendable
{
    private let store: any OrganizationMediaProtectedStore
    private let logger: any OrganizationAssetLogSink

    init(
        store: any OrganizationMediaProtectedStore,
        logger: any OrganizationAssetLogSink =
            NullOrganizationAssetLogSink()
    ) {
        self.store = store
        self.logger = logger
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        _ = await purgeConfirmed(reason: reason)
    }

    @discardableResult
    func purgeConfirmed(
        reason: SensitiveCachePurgeReason
    ) async -> Bool {
        guard await store.purgeAll(reason: reason) else {
            return false
        }
        await logger.record(
            .protectedBytesPurged(reason: Self.safeReason(reason))
        )
        return true
    }

    private static func safeReason(
        _ reason: SensitiveCachePurgeReason
    ) -> SafePurgeReason {
        switch reason {
        case .sceneBackgrounded:
            return .sceneBackgrounded
        case .authExpired:
            return .authExpired
        case .signedOut:
            return .signedOut
        case .accountDeleted:
            return .accountDeleted
        case .shareRevoked, .ghostEnabled, .presenceCleared,
            .presenceExpired:
            return .other
        }
    }
}

private struct OrganizationMediaAuthLease: Equatable, Sendable {
    let userID: UUID
    let epoch: UInt64
}

private enum OrganizationMediaLifecycleEvent: Sendable {
    case authActivated(userID: UUID)
    case authInvalidated(reason: SensitiveCachePurgeReason)
    case sceneBackgrounded
    case sceneBecameActive(userID: UUID)
}

private actor OrganizationMediaLifecycleState {
    private let tasks: any ProtectedTaskCancelling
    private let purger: OrganizationMediaSensitiveCachePurger
    private var authEpoch: UInt64 = 0
    private var admittedLease: OrganizationMediaAuthLease?
    private var isSceneActive: Bool
    private var cleanupConfirmed = true
    private var pendingCleanupReason: SensitiveCachePurgeReason?

    init(
        tasks: any ProtectedTaskCancelling,
        purger: OrganizationMediaSensitiveCachePurger,
        initiallySceneActive: Bool
    ) {
        self.tasks = tasks
        self.purger = purger
        isSceneActive = initiallySceneActive
    }

    func handle(_ event: OrganizationMediaLifecycleEvent) async {
        switch event {
        case .authActivated(let userID):
            let previousLease = admittedLease
            authEpoch &+= 1
            let lease = OrganizationMediaAuthLease(
                userID: userID,
                epoch: authEpoch
            )
            admittedLease = lease
            if let previousLease,
                previousLease.userID != userID
            {
                await closeAndPurge(reason: .authExpired)
            }
            await reopenIfAllowed(lease: lease)
        case .authInvalidated(let reason):
            authEpoch &+= 1
            admittedLease = nil
            await closeAndPurge(reason: reason)
        case .sceneBackgrounded:
            isSceneActive = false
            await closeAndPurge(reason: .sceneBackgrounded)
        case .sceneBecameActive(let userID):
            isSceneActive = true
            guard
                let lease = admittedLease,
                lease.userID == userID
            else {
                return
            }
            await reopenIfAllowed(lease: lease)
        }
    }

    private func closeAndPurge(
        reason: SensitiveCachePurgeReason
    ) async {
        cleanupConfirmed = false
        pendingCleanupReason = reason
        await tasks.cancelProtectedTasks()
        let didPurge = await purger.purgeConfirmed(reason: reason)
        cleanupConfirmed = didPurge
        if didPurge {
            pendingCleanupReason = nil
        }
    }

    private func reopenIfAllowed(
        lease: OrganizationMediaAuthLease
    ) async {
        guard
            isSceneActive,
            admittedLease == lease
        else {
            return
        }
        if !cleanupConfirmed {
            guard let reason = pendingCleanupReason else {
                return
            }
            let didPurge = await purger.purgeConfirmed(reason: reason)
            cleanupConfirmed = didPurge
            if didPurge {
                pendingCleanupReason = nil
            }
        }
        guard
            cleanupConfirmed,
            isSceneActive,
            admittedLease == lease,
            let activating =
                tasks as? any ProtectedTaskActivating
        else {
            return
        }
        await activating.activateProtectedSession(
            userID: lease.userID
        )
    }
}

final class OrganizationMediaSceneLifecycle:
    ProtectedSessionInvalidating,
    @unchecked Sendable
{
    private let state: OrganizationMediaLifecycleState
    private let queueLock = NSLock()
    private var tail: Task<Void, Never>?

    init(
        tasks: any ProtectedTaskCancelling,
        purger: OrganizationMediaSensitiveCachePurger,
        initiallySceneActive: Bool = true
    ) {
        state = OrganizationMediaLifecycleState(
            tasks: tasks,
            purger: purger,
            initiallySceneActive: initiallySceneActive
        )
    }

    func enqueueSceneBackground() {
        _ = enqueue(.sceneBackgrounded)
    }

    func enqueueSceneActive(userID: UUID) {
        _ = enqueue(.sceneBecameActive(userID: userID))
    }

    func didEnterBackground() async {
        await enqueue(.sceneBackgrounded).value
    }

    func didBecomeActive(userID: UUID) async {
        await enqueue(.sceneBecameActive(userID: userID)).value
    }

    func activate(userID: UUID) async {
        await enqueue(.authActivated(userID: userID)).value
    }

    func invalidate(reason: SensitiveCachePurgeReason) async {
        await enqueue(.authInvalidated(reason: reason)).value
    }

    func waitForIdle() async {
        await currentTail()?.value
    }

    private func enqueue(
        _ event: OrganizationMediaLifecycleEvent
    ) -> Task<Void, Never> {
        queueLock.lock()
        let previous = tail
        let state = state
        let operation = Task {
            await previous?.value
            await state.handle(event)
        }
        tail = operation
        queueLock.unlock()
        return operation
    }

    private func currentTail() -> Task<Void, Never>? {
        queueLock.lock()
        defer { queueLock.unlock() }
        return tail
    }
}
