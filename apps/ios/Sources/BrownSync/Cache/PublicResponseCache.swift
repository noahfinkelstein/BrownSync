import CryptoKit
import Foundation
import OpenAPIRuntime

enum PublicLoadPolicy: Equatable, Sendable {
    case useCache
    case reload
}

enum PublicDataSource: Equatable, Sendable {
    case network
    case cache
    case offline(isStale: Bool)

    func combined(with other: PublicDataSource) -> PublicDataSource {
        switch (self, other) {
        case (.offline(let lhs), .offline(let rhs)):
            return .offline(isStale: lhs || rhs)
        case (.offline(let stale), _), (_, .offline(let stale)):
            return .offline(isStale: stale)
        case (.cache, _), (_, .cache):
            return .cache
        case (.network, .network):
            return .network
        }
    }
}

struct PublicResource<Value: Sendable>: Sendable {
    let value: Value
    let source: PublicDataSource
}

extension PublicResource: Equatable where Value: Equatable {}

enum PublicCacheFreshness: Equatable, Sendable {
    case fresh
    case stale
}

struct PublicCacheEntry<Value: Sendable>: Sendable {
    let value: Value
    let freshness: PublicCacheFreshness
    let storedAt: Date
}

extension PublicCacheEntry: Equatable where Value: Equatable {}

actor PublicResponseCache {
    private let directory: URL
    private let schemaVersion: Int
    private let fileManager: FileManager
    private var memory: [String: Data] = [:]

    init(
        directory: URL,
        schemaVersion: Int,
        fileManager: FileManager = .default
    ) {
        self.directory = directory.appendingPathComponent(
            "v\(schemaVersion)",
            isDirectory: true
        )
        self.schemaVersion = schemaVersion
        self.fileManager = fileManager
    }

    func store<Value: Codable & Sendable>(
        _ value: Value,
        forKey key: String,
        storedAt: Date
    ) throws {
        let envelope = PublicCacheEnvelope(
            schemaVersion: schemaVersion,
            storedAt: storedAt,
            value: value
        )
        let data = try JSONEncoder().encode(envelope)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try data.write(to: fileURL(forKey: key), options: .atomic)
        memory[key] = data
    }

    func entry<Value: Codable & Sendable>(
        forKey key: String,
        now: Date,
        ttl: TimeInterval
    ) throws -> PublicCacheEntry<Value>? {
        let data: Data
        if let cached = memory[key] {
            data = cached
        } else {
            let url = fileURL(forKey: key)
            guard fileManager.fileExists(atPath: url.path) else {
                return nil
            }
            data = try Data(contentsOf: url)
            memory[key] = data
        }

        guard
            let envelope = try? JSONDecoder().decode(
                PublicCacheEnvelope<Value>.self,
                from: data
            ),
            envelope.schemaVersion == schemaVersion
        else {
            memory.removeValue(forKey: key)
            return nil
        }
        let age = max(0, now.timeIntervalSince(envelope.storedAt))
        return PublicCacheEntry(
            value: envelope.value,
            freshness: age <= ttl ? .fresh : .stale,
            storedAt: envelope.storedAt
        )
    }

    func remove(forKey key: String) {
        memory.removeValue(forKey: key)
        let url = fileURL(forKey: key)
        guard fileManager.fileExists(atPath: url.path) else {
            return
        }
        try? fileManager.removeItem(at: url)
    }

    private func fileURL(forKey key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("\(name).json")
    }
}

private struct PublicCacheEnvelope<Value: Codable>: Codable {
    let schemaVersion: Int
    let storedAt: Date
    let value: Value
}

func loadPublicResource<Value: Codable & Sendable>(
    cache: PublicResponseCache,
    key: String,
    ttl: TimeInterval,
    policy: PublicLoadPolicy,
    now: @Sendable () -> Date,
    network: @Sendable () async throws -> Value
) async throws -> PublicResource<Value> {
    let timestamp = now()
    let cached: PublicCacheEntry<Value>? = try? await cache.entry(
        forKey: key,
        now: timestamp,
        ttl: ttl
    )
    if policy == .useCache,
        let cached,
        cached.freshness == .fresh
    {
        return PublicResource(value: cached.value, source: .cache)
    }

    do {
        let value = try await network()
        try Task.checkCancellation()
        try? await cache.store(value, forKey: key, storedAt: timestamp)
        return PublicResource(value: value, source: .network)
    } catch {
        let normalized = normalizedPublicError(error)
        if let cancellation = normalized as? CancellationError {
            throw cancellation
        }
        guard let cached else { throw normalized }
        return PublicResource(
            value: cached.value,
            source: .offline(isStale: cached.freshness == .stale)
        )
    }
}

private func normalizedPublicError(_ error: any Error) -> any Error {
    var current = error
    while let clientError = current as? ClientError {
        current = clientError.underlyingError
    }
    return current
}
