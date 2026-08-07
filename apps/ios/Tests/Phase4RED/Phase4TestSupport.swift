import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime

@testable import BrownSync

enum Phase4TestFailure: Error, Equatable, Sendable {
    case unexpectedOperation(String)
}

actor Phase4OrganizationTransport: ClientTransport {
    struct Stub: Sendable {
        let status: Int
        let json: String

        static func json(_ status: Int, _ json: String) -> Stub {
            Stub(status: status, json: json)
        }
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

    func enqueue(_ stub: Stub, for operationID: String) {
        responses[operationID, default: []].append(stub)
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
            bodyData = try await Data(collecting: body, upTo: 1_048_576)
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
            throw Phase4TestFailure.unexpectedOperation(operationID)
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

actor Phase4PublicOrganizationRepositoryFake: OrganizationRepository {
    struct ProfileCall: Equatable, Sendable {
        let id: String
        let at: Date?
        let policy: PublicLoadPolicy
    }

    private var currentProfile: PublicOrganizationProfile
    private var profileCalls: [ProfileCall] = []

    init(profile: PublicOrganizationProfile = Phase4Fixture.latestProfile) {
        currentProfile = profile
    }

    func setProfile(_ profile: PublicOrganizationProfile) {
        currentProfile = profile
    }

    func calls() -> [ProfileCall] {
        profileCalls
    }

    func organizations(
        policy _: PublicLoadPolicy
    ) async throws -> PublicResource<[PublicOrganization]> {
        PublicResource(value: [], source: .network)
    }

    func profile(
        id: String,
        at: Date?,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<PublicOrganizationProfile> {
        profileCalls.append(ProfileCall(id: id, at: at, policy: policy))
        return PublicResource(value: currentProfile, source: .network)
    }
}

actor Phase4OwnershipLogRecorder: OrganizationOwnershipLogSink {
    private var captured: [OrganizationOwnershipLogEvent] = []

    func record(_ event: OrganizationOwnershipLogEvent) {
        captured.append(event)
    }

    func events() -> [OrganizationOwnershipLogEvent] {
        captured
    }
}

enum Phase4Fixture {
    static let actorID = UUID(
        uuidString: "10000000-0000-4000-8000-000000000001"
    )!
    static let claimID = UUID(
        uuidString: "20000000-0000-4000-8000-000000000001"
    )!
    static let nextClaimID = UUID(
        uuidString: "20000000-0000-4000-8000-000000000002"
    )!
    static let organizationID = "brown-lecture-board"
    static let baseDate = Date(timeIntervalSince1970: 1_785_369_660)

    static let baselineProfile = PublicOrganizationProfile(
        id: organizationID,
        name: "Brown Lecture Board",
        kind: "club",
        category: "academic",
        summary: "Original description",
        advisor: "Faculty Advisor",
        fundingCategory: "UFB",
        about: "Original about text",
        meetingInformation: "Mondays at 5",
        links: [],
        avatarURL: nil,
        bannerURL: nil,
        upcoming: [],
        past: [],
        revision: 3
    )

    static let latestProfile = PublicOrganizationProfile(
        id: organizationID,
        name: "Brown Lecture Board",
        kind: "club",
        category: "academic",
        summary: "Someone else's description",
        advisor: "Faculty Advisor",
        fundingCategory: "UFB",
        about: "Original about text",
        meetingInformation: "Tuesdays at 6",
        links: [],
        avatarURL: nil,
        bannerURL: nil,
        upcoming: [],
        past: [],
        revision: 4
    )

    static let myOrganizationsJSON =
        """
        {
          "memberships":[{
            "organizationId":"brown-lecture-board",
            "organizationName":"Brown Lecture Board",
            "role":"owner",
            "grantedAt":"2026-07-30T00:00:00Z"
          }],
          "claims":[{
            "id":"20000000-0000-4000-8000-000000000001",
            "organizationId":"brown-band",
            "organizationName":"Brown Band",
            "status":"pending",
            "createdAt":"2026-07-30T00:01:00Z",
            "reviewedAt":null,
            "reviewNote":null
          }]
        }
        """

    static let createdOrganizationJSON =
        """
        {
          "organizationId":"brownsync-builders",
          "revision":0,
          "role":"owner",
          "disposition":"created"
        }
        """

    static let replayedOrganizationJSON =
        """
        {
          "organizationId":"brownsync-builders",
          "revision":1,
          "role":"owner",
          "disposition":"replayed"
        }
        """

    static func claimJSON(
        disposition: String,
        role: String?,
        claimID: UUID?
    ) -> String {
        let roleJSON = role.map { "\"\($0)\"" } ?? "null"
        let claimJSON = claimID.map {
            "\"\($0.uuidString.lowercased())\""
        } ?? "null"
        return
            """
            {
              "organizationId":"\(organizationID)",
              "disposition":"\(disposition)",
              "role":\(roleJSON),
              "claimId":\(claimJSON)
            }
            """
    }

    static func reviewQueueJSON(
        claims: [(UUID, String, String)],
        next: (Date, UUID)?
    ) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]
        let claimJSON = claims.map { claimID, evidence, createdAt in
            """
            {
              "claimId":"\(claimID.uuidString.lowercased())",
              "organizationId":"\(organizationID)",
              "organizationName":"Brown Lecture Board",
              "claimantDisplayName":"Brown Student",
              "claimantHandle":"student",
              "evidence":"\(evidence)",
              "createdAt":"\(createdAt)"
            }
            """
        }.joined(separator: ",")
        let nextJSON: String
        if let next {
            nextJSON =
                """
                {
                  "afterCreatedAt":"\(formatter.string(from: next.0))",
                  "afterClaimId":"\(next.1.uuidString.lowercased())"
                }
                """
        } else {
            nextJSON = "null"
        }
        return
            """
            {"claims":[\(claimJSON)],"next":\(nextJSON)}
            """
    }

    static func decisionJSON(
        status: String = "approved",
        grantedRole: String? = "editor",
        changed: Bool = true
    ) -> String {
        let roleJSON = grantedRole.map { "\"\($0)\"" } ?? "null"
        return
            """
            {
              "claimId":"20000000-0000-4000-8000-000000000001",
              "status":"\(status)",
              "grantedRole":\(roleJSON),
              "changed":\(changed)
            }
            """
    }

    static func editJSON(
        revision: Int = 4,
        changed: Bool = true
    ) -> String {
        """
        {
          "organizationId":"brown-lecture-board",
          "revision":\(revision),
          "changed":\(changed)
        }
        """
    }

    static let conflictJSON =
        """
        {"error":{"code":"conflict","message":"Revision conflict."}}
        """

    static let unavailableJSON =
        """
        {
          "error":{
            "code":"organization_service_unavailable",
            "message":"Service unavailable."
          }
        }
        """

    static let latestProfileJSON =
        """
        {
          "id":"brown-lecture-board",
          "name":"Brown Lecture Board",
          "kind":"club",
          "category":"academic",
          "description":"Someone else's description",
          "url":null,
          "instagram":null,
          "defaultPlaceId":null,
          "upcoming":[],
          "past":[],
          "advisor":"Faculty Advisor",
          "fundingCategory":"UFB",
          "aboutMd":"Original about text",
          "meetingInfo":"Tuesdays at 6",
          "links":[],
          "avatarUrl":null,
          "bannerUrl":null,
          "overriddenFields":["description","meetingInfo"],
          "revision":4,
          "updatedAt":"2026-07-30T00:02:00Z"
        }
        """
}

func phase4JSONObject(_ data: Data) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
}
