import Foundation
import WebKit
import XCTest

@testable import BrownSync

final class OrganizationSocialEmbedREDTests: XCTestCase {
    private let isolatedOrigin = URL(
        string: "https://embeds.brownsync.example"
    )!

    func testExactWorkerOriginPathAndPostIDAreAccepted() {
        let policy = OrganizationSocialEmbedPolicy(
            isolatedOrigin: isolatedOrigin
        )
        let post = Phase5OrgMediaFixture.socialPost()

        XCTAssertEqual(
            policy.validatedEmbedURL(for: post),
            post.embedURL
        )
    }

    func testUnsafeEmbedURLCorpusAlwaysFallsBackToLink() {
        let policy = OrganizationSocialEmbedPolicy(
            isolatedOrigin: isolatedOrigin
        )
        let otherID = UUID(
            uuidString: "40000000-0000-4000-8000-000000000099"
        )!
        let unsafe = [
            "http://embeds.brownsync.example/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed",
            "https://embeds.brownsync.example.evil.test/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed",
            "https://user@embeds.brownsync.example/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed",
            "https://embeds.brownsync.example:443/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed",
            "https://embeds.brownsync.example/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed?x=1",
            "https://embeds.brownsync.example/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed#x",
            "https://embeds.brownsync.example/api/social-posts/\(otherID)/embed",
            "https://embeds.brownsync.example/api/social-posts/\(Phase5OrgMediaFixture.postID)/embed/extra",
            "https://www.instagram.com/p/Abc_123-/embed",
        ]

        for value in unsafe {
            let post = OrganizationSocialPost(
                id: Phase5OrgMediaFixture.postID,
                permalink: Phase5OrgMediaFixture.socialPost()
                    .permalink,
                renderMode: .embed,
                embedURL: URL(string: value)!,
                attribution: "Instagram",
                revision: 2
            )

            XCTAssertNil(
                policy.validatedEmbedURL(for: post),
                value
            )
            XCTAssertEqual(
                OrganizationSocialCardPresentation(
                    post: post,
                    embedPolicy: policy
                ).content,
                .link(post.permalink)
            )
        }
    }

    @MainActor
    func testWebViewIsFreshNonpersistentScriptlessAndCookieless()
        throws
    {
        let factory = OrganizationSocialEmbedWebViewFactory(
            policy: OrganizationSocialEmbedPolicy(
                isolatedOrigin: isolatedOrigin
            )
        )

        let load = try factory.makeLoad(
            for: Phase5OrgMediaFixture.socialPost()
        )

        XCTAssertEqual(
            load.request.url,
            Phase5OrgMediaFixture.socialPost().embedURL
        )
        XCTAssertFalse(load.request.httpShouldHandleCookies)
        XCTAssertFalse(
            load.webView.configuration.websiteDataStore
                === WKWebsiteDataStore.default()
        )
        XCTAssertFalse(
            load.webView.configuration.defaultWebpagePreferences
                .allowsContentJavaScript
        )
        XCTAssertTrue(
            load.webView.configuration.userContentController
                .userScripts.isEmpty
        )
    }

    func testNavigationNeverLoadsInstagramOrAnotherOriginInEmbedView() {
        let post = Phase5OrgMediaFixture.socialPost()
        let policy = OrganizationSocialEmbedNavigationPolicy(
            embedURL: post.embedURL!
        )

        XCTAssertEqual(
            policy.decision(for: post.embedURL!),
            .allowWorkerDocument
        )
        XCTAssertEqual(
            policy.decision(for: post.permalink),
            .cancel
        )
        XCTAssertEqual(
            policy.decision(
                for: URL(string: "https://evil.example/redirect")!
            ),
            .cancel
        )
    }

    @MainActor
    func testDelegateRefreshReplacesTheAllowedWorkerDocument() {
        let first = Phase5OrgMediaFixture.socialPost()
        let second = Phase5OrgMediaFixture.socialPost(
            id: UUID(
                uuidString: "40000000-0000-4000-8000-000000000002"
            )!
        )
        let delegate = OrganizationSocialEmbedNavigationDelegate(
            policy: OrganizationSocialEmbedNavigationPolicy(
                embedURL: first.embedURL!
            )
        )

        delegate.update(
            policy: OrganizationSocialEmbedNavigationPolicy(
                embedURL: second.embedURL!
            )
        )

        XCTAssertEqual(
            delegate.decision(for: first.embedURL!),
            .cancel
        )
        XCTAssertEqual(
            delegate.decision(for: second.embedURL!),
            .allowWorkerDocument
        )
    }

    func testLinkModeAndEmbedFailureAlwaysRetainCanonicalFallback() {
        let policy = OrganizationSocialEmbedPolicy(
            isolatedOrigin: isolatedOrigin
        )
        let linkPost = Phase5OrgMediaFixture.socialPost(
            renderMode: .link
        )
        var presentation = OrganizationSocialCardPresentation(
            post: linkPost,
            embedPolicy: policy
        )

        XCTAssertEqual(
            presentation.content,
            .link(linkPost.permalink)
        )

        presentation = OrganizationSocialCardPresentation(
            post: Phase5OrgMediaFixture.socialPost(),
            embedPolicy: policy
        )
        presentation.embedFailed()

        XCTAssertEqual(
            presentation.content,
            .link(
                Phase5OrgMediaFixture.socialPost().permalink
            )
        )
    }

    func testAttributionAltTextAndReorderActionsAreAccessible() {
        let asset = Phase5OrgMediaFixture.asset()
        let media = OrganizationMediaAccessibilityPresentation(
            asset: asset,
            canMoveEarlier: true,
            canMoveLater: true
        )
        let card = OrganizationSocialCardPresentation(
            post: Phase5OrgMediaFixture.socialPost(),
            embedPolicy: OrganizationSocialEmbedPolicy(
                isolatedOrigin: isolatedOrigin
            )
        )

        XCTAssertEqual(media.imageLabel, asset.altText)
        XCTAssertEqual(
            media.reorderActionLabels,
            ["Move image earlier", "Move image later"]
        )
        XCTAssertEqual(card.attributionText, "Instagram")
        XCTAssertEqual(
            card.openActionLabel,
            "Open Instagram post"
        )
        XCTAssertFalse(card.accessibilityLabel.isEmpty)
        XCTAssertTrue(
            card.accessibilityLabel.contains("Instagram")
        )
    }
}
