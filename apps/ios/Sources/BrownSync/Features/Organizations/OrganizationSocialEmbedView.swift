import Foundation
import SwiftUI
import UIKit
import WebKit

@MainActor
final class OrganizationSocialEmbedLoad {
    let request: URLRequest
    let webView: WKWebView
    let navigationDelegate: OrganizationSocialEmbedNavigationDelegate

    init(
        request: URLRequest,
        webView: WKWebView,
        navigationDelegate:
            OrganizationSocialEmbedNavigationDelegate
    ) {
        self.request = request
        self.webView = webView
        self.navigationDelegate = navigationDelegate
    }
}

@MainActor
struct OrganizationSocialEmbedWebViewFactory {
    let policy: OrganizationSocialEmbedPolicy

    func makeLoad(
        for post: OrganizationSocialPost
    ) throws -> OrganizationSocialEmbedLoad {
        guard
            let embedURL = policy.validatedEmbedURL(for: post),
            (try? InstagramPermalink(
                post.permalink.absoluteString
            ).url) == post.permalink
        else {
            throw OrganizationAssetError.unsafeURL
        }

        let configuration = Self.freshConfiguration()
        let webView = WKWebView(
            frame: .zero,
            configuration: configuration
        )
        let navigationDelegate =
            OrganizationSocialEmbedNavigationDelegate(
                policy: OrganizationSocialEmbedNavigationPolicy(
                    embedURL: embedURL
                )
            )
        webView.navigationDelegate = navigationDelegate

        var request = URLRequest(
            url: embedURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        request.httpShouldHandleCookies = false
        webView.load(request)
        return OrganizationSocialEmbedLoad(
            request: request,
            webView: webView,
            navigationDelegate: navigationDelegate
        )
    }

    static func freshConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = WKUserContentController()
        configuration.defaultWebpagePreferences
            .allowsContentJavaScript = false
        return configuration
    }
}

@MainActor
final class OrganizationSocialEmbedNavigationDelegate:
    NSObject,
    WKNavigationDelegate
{
    private var policy: OrganizationSocialEmbedNavigationPolicy
    private let onFailure: () -> Void

    init(
        policy: OrganizationSocialEmbedNavigationPolicy,
        onFailure: @escaping () -> Void = {}
    ) {
        self.policy = policy
        self.onFailure = onFailure
    }

    func update(policy: OrganizationSocialEmbedNavigationPolicy) {
        self.policy = policy
    }

    func decision(
        for destination: URL
    ) -> OrganizationSocialEmbedNavigationDecision {
        policy.decision(for: destination)
    }

    func webView(
        _: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler:
            @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let destination = navigationAction.request.url else {
            decisionHandler(.cancel)
            onFailure()
            return
        }
        switch decision(for: destination) {
        case .allowWorkerDocument:
            decisionHandler(.allow)
        case .cancel:
            decisionHandler(.cancel)
            onFailure()
        }
    }

    func webView(
        _: WKWebView,
        didFail _: WKNavigation!,
        withError _: any Error
    ) {
        onFailure()
    }

    func webView(
        _: WKWebView,
        didFailProvisionalNavigation _: WKNavigation!,
        withError _: any Error
    ) {
        onFailure()
    }
}

struct OrganizationSocialEmbedView: UIViewRepresentable {
    let post: OrganizationSocialPost
    let policy: OrganizationSocialEmbedPolicy
    let onFailure: @MainActor () -> Void

    init(
        post: OrganizationSocialPost,
        policy: OrganizationSocialEmbedPolicy,
        onFailure: @escaping @MainActor () -> Void = {}
    ) {
        self.post = post
        self.policy = policy
        self.onFailure = onFailure
    }

    @MainActor
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    @MainActor
    func makeUIView(context: Context) -> WKWebView {
        do {
            let embedURL = try validatedURL()
            let configuration =
                OrganizationSocialEmbedWebViewFactory
                .freshConfiguration()
            let webView = WKWebView(
                frame: .zero,
                configuration: configuration
            )
            let navigationDelegate =
                OrganizationSocialEmbedNavigationDelegate(
                    policy:
                        OrganizationSocialEmbedNavigationPolicy(
                            embedURL: embedURL
                        ),
                    onFailure: onFailure
                )
            context.coordinator.navigationDelegate =
                navigationDelegate
            webView.navigationDelegate = navigationDelegate
            var request = URLRequest(
                url: embedURL,
                cachePolicy:
                    .reloadIgnoringLocalAndRemoteCacheData,
                timeoutInterval: 30
            )
            request.httpShouldHandleCookies = false
            webView.load(request)
            return webView
        } catch {
            onFailure()
            return WKWebView(
                frame: .zero,
                configuration:
                    OrganizationSocialEmbedWebViewFactory
                    .freshConfiguration()
            )
        }
    }

    @MainActor
    func updateUIView(
        _ webView: WKWebView,
        context: Context
    ) {
        guard let embedURL = try? validatedURL() else {
            onFailure()
            return
        }
        let navigationDelegate =
            OrganizationSocialEmbedNavigationDelegate(
                policy: OrganizationSocialEmbedNavigationPolicy(
                    embedURL: embedURL
                ),
                onFailure: onFailure
            )
        context.coordinator.navigationDelegate = navigationDelegate
        webView.navigationDelegate = navigationDelegate
        guard
            webView.url?.absoluteString != embedURL.absoluteString
        else {
            return
        }
        var request = URLRequest(
            url: embedURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        request.httpShouldHandleCookies = false
        webView.load(request)
    }

    @MainActor
    private func validatedURL() throws -> URL {
        guard let url = policy.validatedEmbedURL(for: post) else {
            throw OrganizationAssetError.unsafeURL
        }
        return url
    }

    @MainActor
    final class Coordinator {
        var navigationDelegate: OrganizationSocialEmbedNavigationDelegate?
    }
}
