import Foundation
import XCTest

@testable import BrownSync

final class SupabaseSocialRepositoryREDTests: XCTestCase {
    func testFetchSocialSnapshotMapsExactRLSRowsAndNullability()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles:
                    """
                    [{
                      "id":"00000000-0000-4000-8000-000000000002",
                      "handle":"bruno",
                      "display_name":"Bruno Bear",
                      "avatar_url":"https://example.invalid/bruno.png",
                      "class_year":2027,
                      "concentration":"Computer Science",
                      "bio":null,
                      "created_at":"2027-01-15T08:00:00Z",
                      "updated_at":"2027-01-15T08:00:00Z"
                    }]
                    """,
                .friendships:
                    """
                    [{
                      "requester":"00000000-0000-4000-8000-000000000001",
                      "addressee":"00000000-0000-4000-8000-000000000002",
                      "status":"pending",
                      "blocked_by":null,
                      "created_at":"2027-01-15T08:00:00Z",
                      "responded_at":null
                    }]
                    """,
                .presenceShares:
                    """
                    [{
                      "owner":"00000000-0000-4000-8000-000000000001",
                      "viewer":"00000000-0000-4000-8000-000000000002",
                      "expires_at":"2027-01-15T09:00:00Z",
                      "created_at":"2027-01-15T08:00:00Z"
                    }]
                    """,
                .presenceState:
                    """
                    [{
                      "user_id":"00000000-0000-4000-8000-000000000002",
                      "place_id":null,
                      "status":null,
                      "note":null,
                      "ghost":false,
                      "updated_at":"2027-01-15T08:00:00Z",
                      "expires_at":"2027-01-15T08:05:00Z"
                    }]
                    """,
            ]
        )
        let repository = SupabaseSocialRepository(transport: transport)

        let snapshot = try await repository.fetchSocialSnapshot()

        XCTAssertEqual(snapshot.profiles.count, 1)
        XCTAssertEqual(snapshot.profiles[0].id, Phase3Fixture.friend)
        XCTAssertEqual(snapshot.profiles[0].handle, "bruno")
        XCTAssertEqual(snapshot.profiles[0].displayName, "Bruno Bear")
        XCTAssertEqual(
            snapshot.profiles[0].avatarURL?.absoluteString,
            "https://example.invalid/bruno.png"
        )
        XCTAssertEqual(snapshot.profiles[0].classYear, 2027)
        XCTAssertEqual(
            snapshot.profiles[0].concentration,
            "Computer Science"
        )
        XCTAssertNil(snapshot.profiles[0].bio)

        XCTAssertEqual(snapshot.friendships.count, 1)
        XCTAssertEqual(
            snapshot.friendships[0].requesterID,
            Phase3Fixture.me
        )
        XCTAssertEqual(
            snapshot.friendships[0].addresseeID,
            Phase3Fixture.friend
        )
        XCTAssertEqual(snapshot.friendships[0].status, .pending)
        XCTAssertNil(snapshot.friendships[0].blockedByID)
        XCTAssertNil(snapshot.friendships[0].respondedAt)

        XCTAssertEqual(snapshot.shares.count, 1)
        XCTAssertEqual(snapshot.shares[0].ownerID, Phase3Fixture.me)
        XCTAssertEqual(snapshot.shares[0].viewerID, Phase3Fixture.friend)
        XCTAssertEqual(
            snapshot.shares[0].expiresAt,
            Phase3Fixture.baseDate.addingTimeInterval(3_600)
        )

        XCTAssertEqual(snapshot.presence.count, 1)
        XCTAssertEqual(
            snapshot.presence[0].userID,
            Phase3Fixture.friend
        )
        XCTAssertNil(snapshot.presence[0].placeID)
        XCTAssertNil(snapshot.presence[0].status)
        XCTAssertNil(snapshot.presence[0].note)
        XCTAssertFalse(snapshot.presence[0].ghost)

        let selectedTables = await transport.selections()
        XCTAssertEqual(Set(selectedTables), Set(SocialTable.allCases))
    }

    func testEveryWriteUsesExactMigrationRPCNameAndCodingKeys()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let shareExpiry = Phase3Fixture.baseDate.addingTimeInterval(3_600)

        try await repository.requestFriend(
            addresseeID: Phase3Fixture.friend
        )
        try await repository.respondToFriendRequest(
            requesterID: Phase3Fixture.friend,
            accept: true
        )
        try await repository.removeFriend(
            otherUserID: Phase3Fixture.friend
        )
        try await repository.blockUser(
            otherUserID: Phase3Fixture.friend
        )
        try await repository.unblockUser(
            otherUserID: Phase3Fixture.friend
        )
        try await repository.setPresenceShare(
            viewerID: Phase3Fixture.friend,
            expiresAt: shareExpiry
        )
        try await repository.revokePresenceShare(
            viewerID: Phase3Fixture.friend
        )
        try await repository.setPresence(
            ConfirmedPresence(
                placeID: "rockefeller-library",
                status: .studying,
                note: "Third floor",
                ttlSeconds: 3_600
            )
        )
        try await repository.clearPresence()
        try await repository.setGhost(true)

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.function.rawValue),
            [
                "request_friend",
                "respond_friend",
                "remove_friend",
                "block_user",
                "unblock_user",
                "set_presence_share",
                "revoke_presence_share",
                "set_presence",
                "clear_presence",
                "set_ghost",
            ]
        )
        let expectedKeys: [Set<String>] = [
            ["p_addressee"],
            ["p_requester", "p_accept"],
            ["p_other"],
            ["p_other"],
            ["p_other"],
            ["p_viewer", "p_expires_at"],
            ["p_viewer"],
            ["p_place_id", "p_status", "p_note", "p_ttl"],
            [],
            ["p_ghost"],
        ]
        let actualKeys = try records.map {
            Set(try phase3JSONObject($0.payload).keys)
        }
        XCTAssertEqual(actualKeys, expectedKeys)
        XCTAssertEqual(
            try phase3JSONObject(records[7].payload)["p_ttl"] as? String,
            "3600 seconds"
        )
        XCTAssertTrue(
            records.compactMap(\.parameterType).allSatisfy {
                !$0.contains("Dictionary")
            },
            "Every RPC body must be a typed Encodable parameter struct."
        )
    }

    func testNullablePresenceArgumentsAreEncodedAsExplicitNulls()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)

        try await repository.setPresence(
            ConfirmedPresence(
                placeID: "main-green",
                status: nil,
                note: nil,
                ttlSeconds: 300
            )
        )

        let records = await transport.records()
        let record = try XCTUnwrap(records.first)
        let body = try phase3JSONObject(record.payload)
        XCTAssertTrue(body["p_status"] is NSNull)
        XCTAssertTrue(body["p_note"] is NSNull)
        XCTAssertEqual(body["p_ttl"] as? String, "300 seconds")
    }

    func testDefaultProfileNullabilityAndInvalidAvatarTextCannotPoisonSnapshot()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles:
                    """
                    [{
                      "id":"00000000-0000-4000-8000-000000000001",
                      "handle":"new-bear",
                      "display_name":"New Bear",
                      "avatar_url":"not-an-absolute-avatar-url",
                      "class_year":null,
                      "concentration":null,
                      "bio":null,
                      "created_at":"2027-01-15T08:00:00Z",
                      "updated_at":"2027-01-15T08:00:00Z"
                    }]
                    """
            ]
        )
        let repository = SupabaseSocialRepository(transport: transport)

        let snapshot = try await repository.fetchSocialSnapshot()

        let profile = try XCTUnwrap(snapshot.profiles.first)
        XCTAssertNil(profile.avatarURL)
        XCTAssertNil(profile.classYear)
        XCTAssertNil(profile.concentration)
    }

    func testRecordingTransportRejectsEveryCoordinateShapedEgressKey()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)

        try await repository.setPresence(
            ConfirmedPresence(
                placeID: "andrews-commons",
                status: .eating,
                note: "Lunch",
                ttlSeconds: 900
            )
        )

        let records = await transport.records()
        let keys = try records.reduce(into: Set<String>()) { result, record in
            let json = try phase3JSONObject(record.payload)
            result.formUnion(phase3AllJSONKeys(in: json))
        }
        let normalized = Set(
            keys.map {
                $0.lowercased()
                    .replacingOccurrences(of: "_", with: "")
                    .replacingOccurrences(of: "-", with: "")
            }
        )
        let forbidden: Set<String> = [
            "lat",
            "latitude",
            "lng",
            "lon",
            "longitude",
            "coordinate",
            "coordinates",
            "accuracy",
            "horizontalaccuracy",
            "verticalaccuracy",
            "altitude",
            "speed",
            "course",
        ]

        XCTAssertTrue(
            normalized.isDisjoint(with: forbidden),
            "Coordinate-shaped network keys escaped: "
                + normalized.intersection(forbidden).sorted().joined(
                    separator: ", "
                )
        )
        XCTAssertEqual(
            normalized,
            ["pplaceid", "pstatus", "pnote", "pttl"]
        )
    }

    func testMutationFailureIsSurfacedAfterExactlyOneAttempt() async {
        let transport = Phase3SocialTransportRecorder()
        await transport.failNextRPC(.setPresence, with: .rateLimited)
        let repository = SupabaseSocialRepository(transport: transport)

        do {
            try await repository.setPresence(
                ConfirmedPresence(
                    placeID: "main-green",
                    status: .free,
                    note: nil,
                    ttlSeconds: 300
                )
            )
            XCTFail("Expected the durable database limiter to surface.")
        } catch {
            XCTAssertEqual(error as? Phase3TestFailure, .rateLimited)
        }

        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setPresence])
    }
}
