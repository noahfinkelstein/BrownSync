import Foundation
import XCTest

@testable import BrownSync

final class PublicResponseCacheTests: XCTestCase {
    func testFreshValueSurvivesASecondCacheInstance() async throws {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let storedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let fixture = CacheFixture(id: "event-1", title: "Campus Concert")
        let cache = PublicResponseCache(
            directory: directory,
            schemaVersion: 7
        )

        try await cache.store(
            fixture,
            forKey: "events:week",
            storedAt: storedAt
        )
        let diskBackedCache = PublicResponseCache(
            directory: directory,
            schemaVersion: 7
        )
        let hit: PublicCacheEntry<CacheFixture>? = try await diskBackedCache
            .entry(
                forKey: "events:week",
                now: storedAt.addingTimeInterval(59),
                ttl: 60
            )

        XCTAssertEqual(hit?.value, fixture)
        XCTAssertEqual(hit?.freshness, .fresh)
        XCTAssertEqual(hit?.storedAt, storedAt)
    }

    func testExpiredValueIsReturnedAsStaleForOfflineFallback() async throws {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let storedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let cache = PublicResponseCache(
            directory: directory,
            schemaVersion: 3
        )
        try await cache.store(
            CacheFixture(id: "place-1", title: "The SciLi"),
            forKey: "places",
            storedAt: storedAt
        )

        let hit: PublicCacheEntry<CacheFixture>? = try await cache.entry(
            forKey: "places",
            now: storedAt.addingTimeInterval(61),
            ttl: 60
        )

        XCTAssertEqual(hit?.freshness, .stale)
        XCTAssertEqual(hit?.value.id, "place-1")
    }

    func testDifferentSchemaVersionCannotReadOldPublicPayload() async throws {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let oldCache = PublicResponseCache(
            directory: directory,
            schemaVersion: 1
        )
        try await oldCache.store(
            CacheFixture(id: "org-1", title: "Outdated"),
            forKey: "organizations",
            storedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let newCache = PublicResponseCache(
            directory: directory,
            schemaVersion: 2
        )

        let hit: PublicCacheEntry<CacheFixture>? = try await newCache.entry(
            forKey: "organizations",
            now: Date(timeIntervalSince1970: 1_800_000_001),
            ttl: 60
        )

        XCTAssertNil(hit)
    }

    private func uniqueTemporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "brownsync-public-cache-tests-\(UUID().uuidString)",
                isDirectory: true
            )
    }
}

private struct CacheFixture: Codable, Equatable, Sendable {
    let id: String
    let title: String
}
