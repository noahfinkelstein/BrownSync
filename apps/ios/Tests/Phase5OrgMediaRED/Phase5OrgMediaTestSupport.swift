import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime

@testable import BrownSync

enum Phase5OrgMediaTestFailure: Error, Equatable, Sendable {
    case unexpectedOperation(String)
    case unexpectedCall(String)
}

actor Phase5OrgMediaTransport: ClientTransport {
    struct Stub: Sendable {
        let status: Int
        let contentType: String
        let body: String
    }

    struct Record: Sendable {
        let operationID: String
        let method: String
        let path: String
        let contentType: String?
        let authorization: String?
        let body: Data
    }

    private var responses: [String: [Stub]]
    private var captured: [Record] = []

    init(responses: [String: [Stub]] = [:]) {
        self.responses = responses
    }

    func enqueue(
        operationID: String,
        status: Int,
        contentType: String = "application/json",
        body: String
    ) {
        responses[operationID, default: []].append(
            Stub(
                status: status,
                contentType: contentType,
                body: body
            )
        )
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
            bodyData = try await Data(
                collecting: body,
                upTo: 8_388_609
            )
        } else {
            bodyData = Data()
        }
        captured.append(
            Record(
                operationID: operationID,
                method: request.method.rawValue,
                path: request.path ?? "",
                contentType: request.headerFields[.contentType],
                authorization: request.headerFields[.authorization],
                body: bodyData
            )
        )

        guard
            var queue = responses[operationID],
            !queue.isEmpty
        else {
            throw Phase5OrgMediaTestFailure.unexpectedOperation(
                operationID
            )
        }
        let stub = queue.removeFirst()
        responses[operationID] = queue

        var fields = HTTPFields()
        fields[.contentType] = stub.contentType
        return (
            HTTPResponse(
                status: HTTPResponse.Status(code: stub.status),
                headerFields: fields
            ),
            HTTPBody(stub.body)
        )
    }
}

actor Phase5OrgMediaUUIDSource: UUIDProviding {
    private var values: [UUID]
    private var count = 0

    init(_ values: [UUID]) {
        self.values = values
    }

    func next() async -> UUID {
        guard !values.isEmpty else {
            preconditionFailure("Unexpected UUID request")
        }
        count += 1
        return values.removeFirst()
    }

    func requestCount() -> Int {
        count
    }
}

actor Phase5OrgMediaRepositoryFake: OrganizationMediaRepository {
    enum Call: Equatable, Sendable {
        case media(String, PublicLoadPolicy)
        case reserve(String, OrganizationMediaReservationCommand)
        case upload(
            OrganizationMediaReservation,
            PreparedOrganizationImage
        )
        case delete(String, UUID, Int)
        case reorder(String, [UUID], Int)
    }

    private var calls: [Call] = []
    private var mediaValues: [OrganizationMediaCollection] = [
        Phase5OrgMediaFixture.collection()
    ]
    private var reservationValues = [
        Phase5OrgMediaFixture.reservation()
    ]
    private var uploadOutcomes: [Result<OrganizationMediaUploadResult, OrganizationAssetError>] = [
        .success(Phase5OrgMediaFixture.uploadResult())
    ]
    private var deleteValue = Phase5OrgMediaFixture.deleteResult()
    private var reorderValue = OrganizationGalleryReorderResult(
        galleryRevision: 8,
        changed: true
    )
    private var failure: OrganizationAssetError?

    func setMediaValues(_ values: [OrganizationMediaCollection]) {
        mediaValues = values
    }

    func setReservation(_ value: OrganizationMediaReservation) {
        reservationValues = [value]
    }

    func setReservations(_ values: [OrganizationMediaReservation]) {
        reservationValues = values
    }

    func setUploadResult(_ value: OrganizationMediaUploadResult) {
        uploadOutcomes = [.success(value)]
    }

    func setUploadOutcomes(
        _ values:
            [Result<OrganizationMediaUploadResult, OrganizationAssetError>]
    ) {
        uploadOutcomes = values
    }

    func setDeleteResult(_ value: OrganizationMediaMutationResult) {
        deleteValue = value
    }

    func setReorderResult(_ value: OrganizationGalleryReorderResult) {
        reorderValue = value
    }

    func failNext(with error: OrganizationAssetError) {
        failure = error
    }

    func recordedCalls() -> [Call] {
        calls
    }

    func media(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationMediaCollection> {
        calls.append(.media(organizationID, policy))
        if let failure {
            self.failure = nil
            throw failure
        }
        guard !mediaValues.isEmpty else {
            throw Phase5OrgMediaTestFailure.unexpectedCall("media")
        }
        return PublicResource(
            value: mediaValues.removeFirst(),
            source: .network
        )
    }

    func reserveUpload(
        organizationID: String,
        command: OrganizationMediaReservationCommand
    ) async throws -> OrganizationMediaReservation {
        calls.append(.reserve(organizationID, command))
        if let failure {
            self.failure = nil
            throw failure
        }
        guard !reservationValues.isEmpty else {
            throw Phase5OrgMediaTestFailure.unexpectedCall("reserve")
        }
        return reservationValues.removeFirst()
    }

    func uploadReserved(
        _ reservation: OrganizationMediaReservation,
        prepared: PreparedOrganizationImage
    ) async throws -> OrganizationMediaUploadResult {
        calls.append(.upload(reservation, prepared))
        if let failure {
            self.failure = nil
            throw failure
        }
        guard !uploadOutcomes.isEmpty else {
            throw Phase5OrgMediaTestFailure.unexpectedCall("upload")
        }
        return try uploadOutcomes.removeFirst().get()
    }

    func deleteMedia(
        organizationID: String,
        mediaID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationMediaMutationResult {
        calls.append(
            .delete(
                organizationID,
                mediaID,
                expectedRevision
            )
        )
        if let failure {
            self.failure = nil
            throw failure
        }
        return deleteValue
    }

    func reorderGallery(
        organizationID: String,
        mediaIDs: [UUID],
        expectedGalleryRevision: Int
    ) async throws -> OrganizationGalleryReorderResult {
        calls.append(
            .reorder(
                organizationID,
                mediaIDs,
                expectedGalleryRevision
            )
        )
        if let failure {
            self.failure = nil
            throw failure
        }
        return reorderValue
    }
}

actor Phase5OrgSocialRepositoryFake:
    OrganizationSocialPostRepository
{
    enum Call: Equatable, Sendable {
        case posts(String, PublicLoadPolicy)
        case add(String, UUID, URL)
        case refresh(String, UUID)
        case delete(String, UUID, Int)
    }

    private var calls: [Call] = []
    private var collections: [OrganizationSocialPostCollection] = [
        Phase5OrgMediaFixture.socialCollection()
    ]
    private var addValue = OrganizationSocialPostCreateResult(
        post: Phase5OrgMediaFixture.socialPost(),
        replayed: false
    )
    private var refreshValue = OrganizationSocialPostRefreshResult(
        post: Phase5OrgMediaFixture.socialPost(),
        changed: false
    )
    private var deleteValue = OrganizationSocialPostDeleteResult(
        postID: Phase5OrgMediaFixture.postID,
        revision: 3,
        changed: true
    )
    private var failure: OrganizationAssetError?

    func setCollections(
        _ values: [OrganizationSocialPostCollection]
    ) {
        collections = values
    }

    func setAddResult(_ value: OrganizationSocialPostCreateResult) {
        addValue = value
    }

    func setRefreshResult(
        _ value: OrganizationSocialPostRefreshResult
    ) {
        refreshValue = value
    }

    func setDeleteResult(
        _ value: OrganizationSocialPostDeleteResult
    ) {
        deleteValue = value
    }

    func failNext(with error: OrganizationAssetError) {
        failure = error
    }

    func recordedCalls() -> [Call] {
        calls
    }

    func posts(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationSocialPostCollection> {
        calls.append(.posts(organizationID, policy))
        if let failure {
            self.failure = nil
            throw failure
        }
        guard !collections.isEmpty else {
            throw Phase5OrgMediaTestFailure.unexpectedCall("posts")
        }
        return PublicResource(
            value: collections.removeFirst(),
            source: .network
        )
    }

    func add(
        organizationID: String,
        clientRequestID: UUID,
        permalink: URL
    ) async throws -> OrganizationSocialPostCreateResult {
        calls.append(
            .add(
                organizationID,
                clientRequestID,
                permalink
            )
        )
        if let failure {
            self.failure = nil
            throw failure
        }
        return addValue
    }

    func refresh(
        organizationID: String,
        postID: UUID
    ) async throws -> OrganizationSocialPostRefreshResult {
        calls.append(.refresh(organizationID, postID))
        if let failure {
            self.failure = nil
            throw failure
        }
        return refreshValue
    }

    func delete(
        organizationID: String,
        postID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationSocialPostDeleteResult {
        calls.append(
            .delete(
                organizationID,
                postID,
                expectedRevision
            )
        )
        if let failure {
            self.failure = nil
            throw failure
        }
        return deleteValue
    }
}

actor Phase5OrgMediaProtectedStoreFake:
    OrganizationMediaProtectedStore
{
    enum Call: Equatable, Sendable {
        case stage(Int, OrganizationMediaContentType)
        case body(ProtectedOrganizationMediaHandle)
        case purge(
            ProtectedOrganizationMediaHandle,
            OrganizationMediaPurgeReason
        )
        case purgeAll(SensitiveCachePurgeReason)
    }

    private let prepared: PreparedOrganizationImage
    private let bytes: Data
    private var calls: [Call] = []
    private var purgeResults: [Bool]
    private var purgeAllResults: [Bool]

    init(
        prepared: PreparedOrganizationImage =
            Phase5OrgMediaFixture.prepared(),
        bytes: Data = Data([0xFF, 0xD8, 0xFF, 0xD9]),
        purgeResults: [Bool] = [],
        purgeAllResults: [Bool] = []
    ) {
        self.prepared = prepared
        self.bytes = bytes
        self.purgeResults = purgeResults
        self.purgeAllResults = purgeAllResults
    }

    func recordedCalls() -> [Call] {
        calls
    }

    func stage(
        _ bytes: Data,
        contentType: OrganizationMediaContentType
    ) async throws -> PreparedOrganizationImage {
        calls.append(.stage(bytes.count, contentType))
        return prepared
    }

    func body(
        for prepared: PreparedOrganizationImage
    ) async throws -> HTTPBody {
        calls.append(.body(prepared.handle))
        return HTTPBody(bytes)
    }

    func purge(
        _ handle: ProtectedOrganizationMediaHandle,
        reason: OrganizationMediaPurgeReason
    ) async -> Bool {
        calls.append(.purge(handle, reason))
        return purgeResults.isEmpty
            ? true
            : purgeResults.removeFirst()
    }

    func purgeAll(reason: SensitiveCachePurgeReason) async -> Bool {
        calls.append(.purgeAll(reason))
        return purgeAllResults.isEmpty
            ? true
            : purgeAllResults.removeFirst()
    }
}

actor Phase5OrgMediaLogRecorder: OrganizationAssetLogSink {
    private var captured: [OrganizationAssetLogEvent] = []

    func record(_ event: OrganizationAssetLogEvent) {
        captured.append(event)
    }

    func events() -> [OrganizationAssetLogEvent] {
        captured
    }
}

enum Phase5OrgMediaFixture {
    static let organizationID = "brown-student-radio"
    static let avatarID = UUID(
        uuidString: "10000000-0000-4000-8000-000000000001"
    )!
    static let bannerID = UUID(
        uuidString: "10000000-0000-4000-8000-000000000002"
    )!
    static let galleryID = UUID(
        uuidString: "10000000-0000-4000-8000-000000000003"
    )!
    static let secondGalleryID = UUID(
        uuidString: "10000000-0000-4000-8000-000000000004"
    )!
    static let uploadID = UUID(
        uuidString: "20000000-0000-4000-8000-000000000001"
    )!
    static let requestID = UUID(
        uuidString: "30000000-0000-4000-8000-000000000001"
    )!
    static let secondRequestID = UUID(
        uuidString: "30000000-0000-4000-8000-000000000002"
    )!
    static let postID = UUID(
        uuidString: "40000000-0000-4000-8000-000000000001"
    )!
    static let handleID = UUID(
        uuidString: "50000000-0000-4000-8000-000000000001"
    )!
    static let now = Date(timeIntervalSince1970: 1_800_000_000)

    static func asset(
        id: UUID = galleryID,
        kind: OrganizationMediaKind = .gallery,
        position: Int? = 0,
        revision: Int = 1
    ) -> OrganizationMediaAsset {
        OrganizationMediaAsset(
            id: id,
            kind: kind,
            url: URL(
                string: "https://media.brownsync.example/\(id).webp"
            )!,
            width: kind == .banner ? 1_920 : 1_024,
            height: kind == .banner ? 1_080 : 1_024,
            byteSize: 120_000,
            altText: "Students broadcasting from the studio",
            position: position,
            revision: revision
        )
    }

    static func collection(
        organizationRevision: Int = 4,
        galleryRevision: Int = 7,
        gallery: [OrganizationMediaAsset]? = nil
    ) -> OrganizationMediaCollection {
        OrganizationMediaCollection(
            organizationID: organizationID,
            organizationRevision: organizationRevision,
            galleryRevision: galleryRevision,
            avatar: asset(
                id: avatarID,
                kind: .avatar,
                position: nil
            ),
            banner: asset(
                id: bannerID,
                kind: .banner,
                position: nil
            ),
            gallery: gallery ?? [
                asset(),
                asset(
                    id: secondGalleryID,
                    position: 1
                ),
            ]
        )
    }

    static func reservation(
        expiresAt: Date = now.addingTimeInterval(600),
        replayed: Bool = false
    ) -> OrganizationMediaReservation {
        OrganizationMediaReservation(
            organizationID: organizationID,
            uploadID: uploadID,
            kind: .gallery,
            expiresAt: expiresAt,
            replayed: replayed
        )
    }

    static func prepared(
        contentType: OrganizationMediaContentType = .jpeg
    ) -> PreparedOrganizationImage {
        PreparedOrganizationImage(
            handle: ProtectedOrganizationMediaHandle(id: handleID),
            contentType: contentType,
            byteCount: 4
        )
    }

    static func uploadResult() -> OrganizationMediaUploadResult {
        OrganizationMediaUploadResult(
            asset: asset(),
            organizationRevision: nil,
            galleryRevision: 8
        )
    }

    static func deleteResult(
        kind: OrganizationMediaKind = .gallery
    ) -> OrganizationMediaMutationResult {
        OrganizationMediaMutationResult(
            mediaID: kind == .avatar ? avatarID : galleryID,
            kind: kind,
            organizationRevision: kind == .gallery ? nil : 5,
            galleryRevision: kind == .gallery ? 8 : nil,
            changed: true
        )
    }

    static func socialPost(
        id: UUID = postID,
        renderMode: OrganizationSocialRenderMode = .embed,
        revision: Int = 2
    ) -> OrganizationSocialPost {
        OrganizationSocialPost(
            id: id,
            permalink: URL(
                string: "https://www.instagram.com/p/Abc_123-/"
            )!,
            renderMode: renderMode,
            embedURL: renderMode == .embed
                ? URL(
                    string:
                        "https://embeds.brownsync.example/api/social-posts/\(id)/embed"
                )
                : nil,
            attribution: "Instagram",
            revision: revision
        )
    }

    static func socialCollection(
        posts: [OrganizationSocialPost]? = nil
    ) -> OrganizationSocialPostCollection {
        OrganizationSocialPostCollection(
            organizationID: organizationID,
            posts: posts ?? [socialPost()]
        )
    }
}
