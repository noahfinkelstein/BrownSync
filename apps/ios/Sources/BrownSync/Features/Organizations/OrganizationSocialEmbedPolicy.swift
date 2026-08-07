import Foundation

struct OrganizationSocialEmbedPolicy: Equatable, Sendable {
    let isolatedOrigin: URL

    func validatedEmbedURL(
        for post: OrganizationSocialPost
    ) -> URL? {
        guard
            post.renderMode == .embed,
            let embedURL = post.embedURL,
            let origin = URLComponents(
                url: isolatedOrigin,
                resolvingAgainstBaseURL: false
            ),
            let candidate = URLComponents(
                url: embedURL,
                resolvingAgainstBaseURL: false
            ),
            origin.scheme == "https",
            origin.host != nil,
            origin.user == nil,
            origin.password == nil,
            origin.port == nil,
            origin.query == nil,
            origin.fragment == nil,
            origin.percentEncodedPath.isEmpty
                || origin.percentEncodedPath == "/",
            candidate.scheme == origin.scheme,
            candidate.host == origin.host,
            candidate.user == nil,
            candidate.password == nil,
            candidate.port == nil,
            candidate.query == nil,
            candidate.fragment == nil,
            !candidate.percentEncodedPath.contains("%"),
            !candidate.percentEncodedPath.contains("\\")
        else {
            return nil
        }

        let components = candidate.percentEncodedPath.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard
            components.count == 5,
            components[0].isEmpty,
            components[1] == "api",
            components[2] == "social-posts",
            let pathID = UUID(uuidString: String(components[3])),
            pathID == post.id,
            components[4] == "embed"
        else {
            return nil
        }
        return embedURL
    }
}

enum OrganizationSocialEmbedNavigationDecision:
    Equatable,
    Sendable
{
    case allowWorkerDocument
    case cancel
}

struct OrganizationSocialEmbedNavigationPolicy:
    Equatable,
    Sendable
{
    let embedURL: URL

    func decision(
        for destination: URL
    ) -> OrganizationSocialEmbedNavigationDecision {
        if destination.absoluteString == embedURL.absoluteString {
            return .allowWorkerDocument
        }
        return .cancel
    }
}

struct OrganizationSocialCardPresentation:
    Equatable,
    Sendable
{
    enum Content: Equatable, Sendable {
        case link(URL)
        case embed(URL)
    }

    let post: OrganizationSocialPost
    private(set) var content: Content

    init(
        post: OrganizationSocialPost,
        embedPolicy: OrganizationSocialEmbedPolicy
    ) {
        self.post = post
        if let embedURL = embedPolicy.validatedEmbedURL(for: post) {
            content = .embed(embedURL)
        } else {
            content = .link(post.permalink)
        }
    }

    var attributionText: String {
        post.attribution ?? "Instagram"
    }

    var openActionLabel: String {
        post.permalink.path.hasPrefix("/reel/")
            ? "Open Instagram reel"
            : "Open Instagram post"
    }

    var accessibilityLabel: String {
        "\(attributionText). \(openActionLabel)."
    }

    mutating func embedFailed() {
        content = .link(post.permalink)
    }
}

struct OrganizationMediaAccessibilityPresentation:
    Equatable,
    Sendable
{
    let imageLabel: String
    let reorderActionLabels: [String]

    init(
        asset: OrganizationMediaAsset,
        canMoveEarlier: Bool,
        canMoveLater: Bool
    ) {
        imageLabel = asset.altText
        var labels: [String] = []
        if canMoveEarlier {
            labels.append("Move image earlier")
        }
        if canMoveLater {
            labels.append("Move image later")
        }
        reorderActionLabels = labels
    }
}
