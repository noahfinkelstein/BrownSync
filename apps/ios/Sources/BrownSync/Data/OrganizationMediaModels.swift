import Foundation

enum Phase5LaunchGates {
    // Hosted Task 5E storage, provider, origin, and canary gates are not met.
    static let organizationMediaAndSocialPresentationEnabled = false
}

enum OrganizationMediaKind: String, Codable, Sendable {
    case avatar
    case banner
    case gallery
}

struct OrganizationMediaAsset: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let kind: OrganizationMediaKind
    let url: URL
    let width: Int
    let height: Int
    let byteSize: Int
    let altText: String
    let position: Int?
    let revision: Int

    init(
        id: UUID,
        kind: OrganizationMediaKind,
        url: URL,
        width: Int,
        height: Int,
        byteSize: Int,
        altText: String,
        position: Int?,
        revision: Int
    ) {
        self.id = id
        self.kind = kind
        self.url = url
        self.width = width
        self.height = height
        self.byteSize = byteSize
        self.altText = altText
        self.position = position
        self.revision = revision
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(UUID.self, forKey: .id),
            kind: try container.decode(
                OrganizationMediaKind.self,
                forKey: .kind
            ),
            url: try container.decode(URL.self, forKey: .url),
            width: try container.decode(Int.self, forKey: .width),
            height: try container.decode(Int.self, forKey: .height),
            byteSize: try container.decode(Int.self, forKey: .byteSize),
            altText: try container.decode(String.self, forKey: .altText),
            position: try container.decodeIfPresent(
                Int.self,
                forKey: .position
            ),
            revision: try container.decode(Int.self, forKey: .revision)
        )
        try validate()
    }

    func validate() throws {
        let trimmedAltText = altText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard
            url.scheme?.lowercased() == "https",
            url.host != nil,
            url.user == nil,
            url.password == nil,
            (1...12_000).contains(width),
            (1...12_000).contains(height),
            (1...2_097_152).contains(byteSize),
            !trimmedAltText.isEmpty,
            trimmedAltText == altText,
            altText.count <= 500,
            revision >= 0
        else {
            throw OrganizationAssetError.invalidResponse
        }

        switch kind {
        case .avatar, .banner:
            guard position == nil else {
                throw OrganizationAssetError.invalidResponse
            }
        case .gallery:
            guard let position, (0...11).contains(position) else {
                throw OrganizationAssetError.invalidResponse
            }
        }
    }
}

struct OrganizationMediaCollection: Codable, Equatable, Sendable {
    let organizationID: String
    let organizationRevision: Int
    let galleryRevision: Int
    let avatar: OrganizationMediaAsset?
    let banner: OrganizationMediaAsset?
    let gallery: [OrganizationMediaAsset]

    init(
        organizationID: String,
        organizationRevision: Int,
        galleryRevision: Int,
        avatar: OrganizationMediaAsset?,
        banner: OrganizationMediaAsset?,
        gallery: [OrganizationMediaAsset]
    ) {
        self.organizationID = organizationID
        self.organizationRevision = organizationRevision
        self.galleryRevision = galleryRevision
        self.avatar = avatar
        self.banner = banner
        self.gallery = gallery
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            organizationID: try container.decode(
                String.self,
                forKey: .organizationID
            ),
            organizationRevision: try container.decode(
                Int.self,
                forKey: .organizationRevision
            ),
            galleryRevision: try container.decode(
                Int.self,
                forKey: .galleryRevision
            ),
            avatar: try container.decodeIfPresent(
                OrganizationMediaAsset.self,
                forKey: .avatar
            ),
            banner: try container.decodeIfPresent(
                OrganizationMediaAsset.self,
                forKey: .banner
            ),
            gallery: try container.decode(
                [OrganizationMediaAsset].self,
                forKey: .gallery
            )
        )
        try validate()
    }

    func validate() throws {
        guard
            !organizationID.isEmpty,
            organizationRevision >= 0,
            galleryRevision >= 0,
            gallery.count <= 12
        else {
            throw OrganizationAssetError.invalidResponse
        }
        var ids = Set<UUID>()
        if let avatar {
            try avatar.validate()
            guard
                avatar.kind == .avatar,
                ids.insert(avatar.id).inserted
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
        if let banner {
            try banner.validate()
            guard
                banner.kind == .banner,
                ids.insert(banner.id).inserted
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }

        for (index, asset) in gallery.enumerated() {
            try asset.validate()
            guard
                asset.kind == .gallery,
                asset.position == index,
                ids.insert(asset.id).inserted
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
    }

    private enum CodingKeys: String, CodingKey {
        case organizationID
        case organizationRevision
        case galleryRevision
        case avatar
        case banner
        case gallery
    }
}

enum OrganizationMediaContentType: String, Sendable {
    case jpeg = "image/jpeg"
    case png = "image/png"
    case webP = "image/webp"
}

struct ProtectedOrganizationMediaHandle:
    Hashable,
    Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    let id: UUID

    var description: String {
        "<redacted protected media handle>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

struct PreparedOrganizationImage:
    Equatable,
    Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    let handle: ProtectedOrganizationMediaHandle
    let contentType: OrganizationMediaContentType
    let byteCount: Int

    var description: String {
        "<redacted prepared organization image>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

struct OrganizationMediaReservationCommand:
    Equatable,
    Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    let clientRequestID: UUID
    let kind: OrganizationMediaKind
    let altText: String
    let expectedOrganizationRevision: Int?
    let expectedGalleryRevision: Int?

    var description: String {
        "<redacted organization media reservation command>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }

    func validate() throws {
        let trimmed = altText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard
            !trimmed.isEmpty,
            trimmed == altText,
            altText.count <= 500
        else {
            throw OrganizationAssetError.invalidAltText
        }

        switch kind {
        case .avatar, .banner:
            guard
                let expectedOrganizationRevision,
                expectedOrganizationRevision >= 0,
                expectedGalleryRevision == nil
            else {
                throw OrganizationAssetError.invalidResponse
            }
        case .gallery:
            guard
                expectedOrganizationRevision == nil,
                let expectedGalleryRevision,
                expectedGalleryRevision >= 0
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
    }
}

struct OrganizationMediaReservation:
    Equatable,
    Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    let organizationID: String
    let uploadID: UUID
    let kind: OrganizationMediaKind
    let expiresAt: Date
    let replayed: Bool

    func validate() throws {
        guard !organizationID.isEmpty else {
            throw OrganizationAssetError.invalidResponse
        }
    }

    var description: String {
        "<redacted organization media reservation>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

struct OrganizationMediaUploadResult: Equatable, Sendable {
    let asset: OrganizationMediaAsset
    let organizationRevision: Int?
    let galleryRevision: Int?

    func validate() throws {
        try asset.validate()
        switch asset.kind {
        case .avatar, .banner:
            guard
                let organizationRevision,
                organizationRevision >= 0,
                galleryRevision == nil
            else {
                throw OrganizationAssetError.invalidResponse
            }
        case .gallery:
            guard
                organizationRevision == nil,
                let galleryRevision,
                galleryRevision >= 0
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
    }
}

struct OrganizationMediaMutationResult: Equatable, Sendable {
    let mediaID: UUID
    let kind: OrganizationMediaKind
    let organizationRevision: Int?
    let galleryRevision: Int?
    let changed: Bool

    func validate() throws {
        switch kind {
        case .avatar, .banner:
            guard
                let organizationRevision,
                organizationRevision >= 0,
                galleryRevision == nil
            else {
                throw OrganizationAssetError.invalidResponse
            }
        case .gallery:
            guard
                organizationRevision == nil,
                let galleryRevision,
                galleryRevision >= 0
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
    }
}

struct OrganizationGalleryReorderResult: Equatable, Sendable {
    let galleryRevision: Int
    let changed: Bool
}

enum OrganizationSocialRenderMode: String, Codable, Sendable {
    case link
    case embed
}

struct OrganizationSocialPost: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let permalink: URL
    let renderMode: OrganizationSocialRenderMode
    let embedURL: URL?
    let attribution: String?
    let revision: Int

    init(
        id: UUID,
        permalink: URL,
        renderMode: OrganizationSocialRenderMode,
        embedURL: URL?,
        attribution: String?,
        revision: Int
    ) {
        self.id = id
        self.permalink = permalink
        self.renderMode = renderMode
        self.embedURL = embedURL
        self.attribution = attribution
        self.revision = revision
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(UUID.self, forKey: .id),
            permalink: try container.decode(URL.self, forKey: .permalink),
            renderMode: try container.decode(
                OrganizationSocialRenderMode.self,
                forKey: .renderMode
            ),
            embedURL: try container.decodeIfPresent(
                URL.self,
                forKey: .embedURL
            ),
            attribution: try container.decodeIfPresent(
                String.self,
                forKey: .attribution
            ),
            revision: try container.decode(Int.self, forKey: .revision)
        )
        try validate()
    }

    func validate() throws {
        guard
            (try? InstagramPermalink(permalink.absoluteString).url)
                == permalink,
            revision >= 0
        else {
            throw OrganizationAssetError.invalidResponse
        }
        if let attribution {
            let trimmed = attribution.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard
                !trimmed.isEmpty,
                trimmed == attribution,
                attribution.count <= 200
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
        switch renderMode {
        case .link:
            guard embedURL == nil else {
                throw OrganizationAssetError.invalidResponse
            }
        case .embed:
            guard
                let embedURL,
                embedURL.scheme?.lowercased() == "https",
                embedURL.host != nil
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case permalink
        case renderMode
        case embedURL
        case attribution
        case revision
    }
}

struct OrganizationSocialPostCollection: Codable, Equatable, Sendable {
    let organizationID: String
    let posts: [OrganizationSocialPost]

    init(
        organizationID: String,
        posts: [OrganizationSocialPost]
    ) {
        self.organizationID = organizationID
        self.posts = posts
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            organizationID: try container.decode(
                String.self,
                forKey: .organizationID
            ),
            posts: try container.decode(
                [OrganizationSocialPost].self,
                forKey: .posts
            )
        )
        try validate()
    }

    func validate() throws {
        guard
            !organizationID.isEmpty,
            posts.count <= 12,
            Set(posts.map(\.id)).count == posts.count
        else {
            throw OrganizationAssetError.invalidResponse
        }
        for post in posts {
            try post.validate()
        }
    }

    private enum CodingKeys: String, CodingKey {
        case organizationID
        case posts
    }
}

struct OrganizationSocialPostCreateResult: Equatable, Sendable {
    let post: OrganizationSocialPost
    let replayed: Bool
}

struct OrganizationSocialPostRefreshResult: Equatable, Sendable {
    let post: OrganizationSocialPost
    let changed: Bool
}

struct OrganizationSocialPostDeleteResult: Equatable, Sendable {
    let postID: UUID
    let revision: Int
    let changed: Bool
}

enum OrganizationAssetError: Error, Equatable, Sendable {
    case invalidSelection
    case invalidAltText
    case invalidGalleryOrder
    case collectionLimitReached
    case unsafeURL
    case authenticationRequired
    case brownMembershipRequired
    case authorityRequired
    case notFound
    case conflict
    case reservationExpired
    case payloadTooLarge
    case unsupportedMedia
    case invalidMedia
    case quotaExceeded
    case unavailable
    case invalidResponse
}

enum OrganizationAdminAccess: Equatable, Sendable {
    case signedOut
    case authenticating
    case admittedNonAdmin
    case admittedAdmin

    func requireOrganizationAssetMutation() throws {
        switch self {
        case .signedOut, .authenticating:
            throw OrganizationAssetError.authenticationRequired
        case .admittedNonAdmin:
            throw OrganizationAssetError.authorityRequired
        case .admittedAdmin:
            return
        }
    }
}

enum OrganizationMediaPurgeReason: Equatable, Sendable {
    case uploaded
    case reservationFailed
    case uploadFailed
    case validationFailed
    case cancelled
    case expired
    case conflict
    case discarded
    case reselected
    case viewTornDown
}

enum OrganizationAssetMutationKind: Equatable, Sendable {
    case mediaReservation
    case mediaUpload
    case mediaDelete
    case galleryReorder
    case socialAdd
    case socialRefresh
    case socialDelete
}

enum SafeOutcome: Equatable, Sendable {
    case succeeded
    case conflict
    case rejected
    case unavailable
    case cancelled
}

enum SafePurgeReason: Equatable, Sendable {
    case sceneBackgrounded
    case authExpired
    case signedOut
    case accountDeleted
    case other
}

enum SafeEmbedFallbackReason: Equatable, Sendable {
    case linkMode
    case invalidURL
    case navigationRejected
    case loadFailed
}

enum OrganizationAssetLogEvent: Equatable, Sendable {
    case publicMediaLoaded(source: PublicDataSource)
    case publicCardsLoaded(source: PublicDataSource)
    case mutationFinished(
        kind: OrganizationAssetMutationKind,
        outcome: SafeOutcome
    )
    case protectedBytesPurged(reason: SafePurgeReason)
    case embedFallback(reason: SafeEmbedFallbackReason)
}

protocol OrganizationAssetLogSink: Sendable {
    func record(_ event: OrganizationAssetLogEvent) async
}

struct NullOrganizationAssetLogSink: OrganizationAssetLogSink {
    func record(_: OrganizationAssetLogEvent) async {}
}
