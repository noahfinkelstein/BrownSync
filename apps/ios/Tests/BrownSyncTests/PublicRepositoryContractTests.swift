import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

@testable import BrownSync

final class PublicRepositoryContractTests: XCTestCase {
    func testEventsUseGeneratedListNowAndDetailOperationsWithCacheFallback()
        async throws
    {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = PublicContractTransport()
        let repository = WorkerEventRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.brownsync.invalid")!,
                transport: transport
            ),
            cache: PublicResponseCache(
                directory: directory,
                schemaVersion: 1
            ),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
        let eventID = UUID(
            uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )!

        let network = try await repository.events(
            query: EventQuery(text: "music"),
            policy: .reload
        )
        let cached = try await repository.events(
            query: EventQuery(text: "music"),
            policy: .useCache
        )
        await transport.failEventListRequests()
        let offline = try await repository.events(
            query: EventQuery(text: "music"),
            policy: .reload
        )
        let live = try await repository.now(policy: .reload)
        let detail = try await repository.event(
            id: eventID,
            policy: .reload
        )

        XCTAssertEqual(network.source, .network)
        XCTAssertEqual(cached.source, .cache)
        XCTAssertEqual(offline.source, .offline(isStale: false))
        XCTAssertEqual(network.value, cached.value)
        XCTAssertEqual(network.value, offline.value)
        XCTAssertEqual(network.value.first?.id, eventID)
        XCTAssertEqual(network.value.first?.title, "Spring Concert")
        XCTAssertEqual(
            network.value.first?.coordinate,
            EventCoordinate(latitude: 41.8268, longitude: -71.4025)
        )
        XCTAssertEqual(live.value.map(\.id), [eventID])
        XCTAssertEqual(detail.value.event.id, eventID)
        XCTAssertEqual(detail.value.event.placeName, "Main Green")

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "get/api/events",
                "get/api/events",
                "get/api/now",
                "get/api/events/{id}",
            ]
        )
        XCTAssertTrue(
            records[0].path.contains("q=music"),
            records[0].path
        )
        XCTAssertEqual(
            records.last?.path,
            "/api/events/\(eventID.uuidString.lowercased())"
        )
    }

    func testPlacesUseGeneratedGazetteerAndActivityOperations() async throws {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = PublicContractTransport()
        let repository = WorkerPlaceRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.brownsync.invalid")!,
                transport: transport
            ),
            cache: PublicResponseCache(
                directory: directory,
                schemaVersion: 1
            ),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        let places = try await repository.places(policy: .reload)
        let activity = try await repository.activity(
            id: "sciences-library",
            at: Date(timeIntervalSince1970: 1_800_000_000),
            policy: .reload
        )

        XCTAssertEqual(places.value.first?.name, "Sciences Library")
        XCTAssertEqual(places.value.first?.aliases, ["SciLi", "Sci-Li"])
        XCTAssertEqual(activity.value.place.id, "sciences-library")
        XCTAssertEqual(activity.value.events.first?.title, "Spring Concert")
        XCTAssertEqual(activity.value.meetingCount, 0)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["get/api/places", "get/api/places/{id}/activity"]
        )
        XCTAssertTrue(
            records[1].path.hasPrefix(
                "/api/places/sciences-library/activity"
            ),
            records[1].path
        )
    }

    func testOrganizationsUseOnlyGeneratedEnrichedProfileOperation()
        async throws
    {
        let directory = uniqueTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = PublicContractTransport()
        let repository = WorkerOrganizationRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.brownsync.invalid")!,
                transport: transport
            ),
            cache: PublicResponseCache(
                directory: directory,
                schemaVersion: 1
            ),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        let organizations = try await repository.organizations(
            policy: .reload
        )
        let profile = try await repository.profile(
            id: "brown-concert-agency",
            at: nil,
            policy: .reload
        )

        XCTAssertEqual(
            organizations.value.first?.name,
            "Brown Concert Agency"
        )
        XCTAssertEqual(profile.value.name, "Brown Concert Agency")
        XCTAssertEqual(profile.value.advisor, "Pat Advisor")
        XCTAssertEqual(profile.value.revision, 4)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["get/api/orgs", "getOrganizationProfile"]
        )
        XCTAssertFalse(
            records.map(\.operationID).contains("get/api/orgs/{id}")
        )
        XCTAssertEqual(
            records.last?.path,
            "/api/orgs/brown-concert-agency/profile"
        )
    }

    private func uniqueTemporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "brownsync-public-repository-tests-\(UUID().uuidString)",
                isDirectory: true
            )
    }
}

private actor PublicContractTransport: ClientTransport {
    struct Record: Sendable {
        let operationID: String
        let path: String
    }

    private var captured: [Record] = []
    private var eventListFails = false

    func failEventListRequests() {
        eventListFails = true
    }

    func records() -> [Record] {
        captured
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        captured.append(
            Record(operationID: operationID, path: request.path ?? "")
        )
        if operationID == "get/api/events", eventListFails {
            throw URLError(.notConnectedToInternet)
        }

        switch operationID {
        case "get/api/events":
            return Self.ok(#"{"events":[\#(Self.eventJSON)]}"#)
        case "get/api/now":
            return Self.ok(
                #"{"events":[\#(Self.eventJSON)],"meetings":[],"countsByCategory":{"academic":0,"class":0,"club":0,"arts":1,"athletics":0,"food":0,"social":0,"career":0,"wellness":0,"admin":0}}"#
            )
        case "get/api/events/{id}":
            return Self.ok(
                String(Self.eventJSON.dropLast())
                    + #","org":null,"place":null}"#
            )
        case "get/api/places":
            return Self.ok(#"{"places":[\#(Self.placeJSON)]}"#)
        case "get/api/places/{id}/activity":
            return Self.ok(
                #"{"place":\#(Self.placeJSON),"events":[\#(Self.eventJSON)],"meetings":[]}"#
            )
        case "get/api/orgs":
            return Self.ok(#"{"orgs":[\#(Self.organizationJSON)]}"#)
        case "getOrganizationProfile":
            return Self.ok(Self.organizationProfileJSON)
        default:
            throw PublicContractTransportError.unexpectedOperation(
                operationID
            )
        }
    }

    private static func ok(
        _ json: some StringProtocol
    ) -> (HTTPResponse, HTTPBody?) {
        var fields = HTTPFields()
        fields[.contentType] = "application/json"
        return (
            HTTPResponse(status: .ok, headerFields: fields),
            HTTPBody(String(json))
        )
    }

    private static let eventJSON =
        #"{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","title":"Spring Concert","description":"Live music on the green.","start":"2027-01-15T19:00:00Z","end":"2027-01-15T21:00:00Z","allDay":false,"lat":41.8268,"lng":-71.4025,"placeId":"main-green","placeName":"Main Green","locationRaw":null,"orgId":"brown-concert-agency","orgName":"Brown Concert Agency","category":"arts","tags":["music"],"url":"https://events.brown.edu/concert","cost":null,"source":"fixture","confidence":1,"isCanceled":false,"mergedSources":[]}"#

    private static let placeJSON =
        #"{"id":"sciences-library","name":"Sciences Library","aliases":["SciLi","Sci-Li"],"kind":"library","lat":41.826,"lng":-71.4,"address":"201 Thayer Street"}"#

    private static let organizationJSON =
        #"{"id":"brown-concert-agency","name":"Brown Concert Agency","kind":"club","category":"arts","description":"Student concerts.","url":"https://example.edu","instagram":"brownconcertagency","defaultPlaceId":"main-green"}"#

    private static let organizationProfileJSON =
        #"{"id":"brown-concert-agency","name":"Brown Concert Agency","kind":"club","category":"arts","description":"Student concerts.","url":"https://example.edu","instagram":"brownconcertagency","defaultPlaceId":"main-green","upcoming":[],"past":[],"advisor":"Pat Advisor","fundingCategory":"UFB","aboutMd":"Concerts for Brown.","meetingInfo":"Wednesdays","links":[{"platform":"website","label":"Website","url":"https://example.edu"}],"avatarUrl":null,"bannerUrl":null,"overriddenFields":["aboutMd"],"revision":4,"updatedAt":"2027-01-01T00:00:00Z"}"#
}

private enum PublicContractTransportError: Error {
    case unexpectedOperation(String)
}
