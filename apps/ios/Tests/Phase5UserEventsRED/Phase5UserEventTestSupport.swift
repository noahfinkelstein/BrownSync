import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime

@testable import BrownSync

enum Phase5UserEventTestFailure: Error, Equatable, Sendable {
    case unexpectedOperation(String)
    case exhaustedUUIDs
}

actor Phase5UserEventTransport: ClientTransport {
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
            throw Phase5UserEventTestFailure.unexpectedOperation(operationID)
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

actor Phase5UUIDSequence: UUIDProviding {
    private let values: [UUID]
    private var index = 0

    init(_ values: [UUID]) {
        self.values = values
    }

    func next() async -> UUID {
        precondition(index < values.count, "Phase 5 UUID fixture exhausted")
        defer { index += 1 }
        return values[index]
    }

    func requestCount() -> Int {
        index
    }
}

enum Phase5UserEventFixture {
    static let actorID = UUID(
        uuidString: "30000000-0000-4000-8000-000000000001"
    )!
    static let eventID = UUID(
        uuidString: "40000000-0000-4000-8000-000000000001"
    )!
    static let secondEventID = UUID(
        uuidString: "40000000-0000-4000-8000-000000000002"
    )!
    static let requestID = UUID(
        uuidString: "50000000-0000-4000-8000-000000000001"
    )!
    static let secondRequestID = UUID(
        uuidString: "50000000-0000-4000-8000-000000000002"
    )!
    static let start = Date(timeIntervalSince1970: 1_789_507_600)
    static let end = Date(timeIntervalSince1970: 1_789_513_000)
    static let laterEnd = Date(timeIntervalSince1970: 1_789_516_600)
    static let updatedAt = Date(timeIntervalSince1970: 1_785_427_260)

    static let baselineEvent = managedEvent()

    static func managedEvent(
        title: String = "Campus software study break",
        description: String? = "Original description",
        start: Date = Phase5UserEventFixture.start,
        end: Date? = Phase5UserEventFixture.end,
        url: URL? = URL(
            string: "https://example.edu/study-break"
        ),
        status: UserEventStatus = .published,
        revision: Int = 2,
        deletedAt: Date? = nil,
        updatedAt: Date = Phase5UserEventFixture.updatedAt
    ) -> ManagedUserEvent {
        ManagedUserEvent(
            id: eventID,
            owner: .personal,
            title: title,
            description: description,
            start: start,
            end: end,
            canonicalPlaceID: "salomon-center",
            placeName: "Salomon Center",
            category: .social,
            url: url,
            status: status,
            moderationState: .active,
            revision: revision,
            deletedAt: deletedAt,
            createdAt: Date(timeIntervalSince1970: 1_785_427_200),
            updatedAt: updatedAt
        )
    }

    static func personalDraft() -> UserEventCreateDraft {
        UserEventCreateDraft(
            owner: .personal,
            title: "Campus software study break",
            description: nil,
            start: start,
            end: nil,
            category: .social,
            url: nil,
            canonicalPlaceID: "salomon-center"
        )
    }

    static func organizationDraft() -> UserEventCreateDraft {
        UserEventCreateDraft(
            owner: .organization(
                id: "brown-band",
                name: "Brown Band"
            ),
            title: "Brown Band rehearsal",
            description: "Open rehearsal.",
            start: start,
            end: end,
            category: .arts,
            url: URL(string: "https://example.edu/band"),
            canonicalPlaceID: "sayles-hall"
        )
    }

    static func createResultJSON(replayed: Bool) -> String {
        """
        {
          "eventId":"\(eventID.uuidString.lowercased())",
          "revision":0,
          "replayed":\(replayed)
        }
        """
    }

    static func mutationResultJSON(
        revision: Int,
        changed: Bool
    ) -> String {
        """
        {
          "eventId":"\(eventID.uuidString.lowercased())",
          "revision":\(revision),
          "changed":\(changed)
        }
        """
    }

    static func managementJSON(
        id: UUID = eventID,
        organizationID: String? = nil,
        organizationName: String? = nil,
        title: String = "Campus software study break",
        description: String? = "Original description",
        end: String? = "2026-09-15T23:30:00.000Z",
        url: String? = "https://example.edu/study-break",
        revision: Int = 2,
        updatedAt: String = "2026-07-30T16:01:00.000Z"
    ) -> String {
        let organizationIDJSON = organizationID.map { "\"\($0)\"" } ?? "null"
        let organizationNameJSON =
            organizationName.map { "\"\($0)\"" } ?? "null"
        let descriptionJSON = description.map { "\"\($0)\"" } ?? "null"
        let endJSON = end.map { "\"\($0)\"" } ?? "null"
        let urlJSON = url.map { "\"\($0)\"" } ?? "null"
        return
            """
            {
              "id":"\(id.uuidString.lowercased())",
              "organizationId":\(organizationIDJSON),
              "organizationName":\(organizationNameJSON),
              "title":"\(title)",
              "description":\(descriptionJSON),
              "start":"2026-09-15T22:00:00.000Z",
              "end":\(endJSON),
              "placeId":"salomon-center",
              "placeName":"Salomon Center",
              "locationRaw":null,
              "category":"social",
              "url":\(urlJSON),
              "status":"published",
              "moderationState":"active",
              "revision":\(revision),
              "deletedAt":null,
              "createdAt":"2026-07-30T16:00:00.000Z",
              "updatedAt":"\(updatedAt)"
            }
            """
    }

    static func pageJSON(
        events: [String],
        next: (String, UUID)?
    ) -> String {
        let nextJSON: String
        if let next {
            nextJSON =
                """
                {
                  "beforeUpdatedAt":"\(next.0)",
                  "beforeEventId":"\(next.1.uuidString.lowercased())"
                }
                """
        } else {
            nextJSON = "null"
        }
        return
            """
            {"events":[\(events.joined(separator: ","))],"next":\(nextJSON)}
            """
    }

    static let conflictJSON =
        """
        {"error":{"code":"conflict","message":"Event state changed."}}
        """

    static let forbiddenJSON =
        """
        {"error":{"code":"forbidden","message":"Event authority required."}}
        """

    static let rateLimitedJSON =
        """
        {"error":{"code":"rate_limited","message":"Too many requests."}}
        """

    static let unauthorizedJSON =
        """
        {"error":{"code":"unauthorized","message":"Session expired."}}
        """
}

func phase5UserEventJSONObject(_ data: Data) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
}

func phase5UserEventAllJSONKeys(_ value: Any) -> Set<String> {
    if let dictionary = value as? [String: Any] {
        return Set(dictionary.keys).union(
            dictionary.values.reduce(into: Set<String>()) {
                $0.formUnion(phase5UserEventAllJSONKeys($1))
            }
        )
    }
    if let array = value as? [Any] {
        return array.reduce(into: Set<String>()) {
            $0.formUnion(phase5UserEventAllJSONKeys($1))
        }
    }
    return []
}
