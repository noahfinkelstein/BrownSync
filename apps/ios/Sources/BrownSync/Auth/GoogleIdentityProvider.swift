import Foundation
import GoogleSignIn

enum GoogleIdentityError: Error, Equatable {
    case configurationFailed
    case signInFailed
    case missingIDToken
}

protocol GoogleCallbackHandling: AnyObject {
    @MainActor
    func handle(_ url: URL) -> Bool
}

protocol GoogleIdentityProviding: GoogleCallbackHandling, Sendable {
    func configure() async throws
    func interactiveTokenPair() async throws -> GoogleIdentityTokenPair
    func restoreTokenPair() async throws -> GoogleIdentityTokenPair?
    func signOut() async
}

final class GoogleIdentityProvider:
    GoogleIdentityProviding,
    @unchecked Sendable
{
    private let clientID: String
    private let serverClientID: String
    private let presentationProvider: any PresentationControllerProviding

    init(
        clientID: String,
        serverClientID: String,
        presentationProvider: any PresentationControllerProviding
    ) {
        self.clientID = clientID
        self.serverClientID = serverClientID
        self.presentationProvider = presentationProvider
    }

    func configure() async throws {
        try await withCheckedThrowingContinuation { continuation in
            Task { @MainActor in
                GIDSignIn.sharedInstance.configuration = GIDConfiguration(
                    clientID: clientID,
                    serverClientID: serverClientID,
                    hostedDomain: "brown.edu",
                    openIDRealm: nil
                )
                GIDSignIn.sharedInstance.configure { error in
                    if error == nil {
                        continuation.resume()
                    } else {
                        continuation.resume(
                            throwing: GoogleIdentityError.configurationFailed
                        )
                    }
                }
            }
        }
    }

    func interactiveTokenPair() async throws -> GoogleIdentityTokenPair {
        try await withCheckedThrowingContinuation { continuation in
            Task { @MainActor in
                do {
                    let controller = try presentationProvider
                        .presentationController()
                    GIDSignIn.sharedInstance.signIn(
                        withPresenting: controller,
                        hint: nil,
                        additionalScopes: []
                    ) { result, error in
                        guard error == nil, let user = result?.user else {
                            continuation.resume(
                                throwing: GoogleIdentityError.signInFailed
                            )
                            return
                        }
                        do {
                            continuation.resume(
                                returning: try Self.tokenPair(from: user)
                            )
                        } catch {
                            continuation.resume(throwing: error)
                        }
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func restoreTokenPair() async throws -> GoogleIdentityTokenPair? {
        try await withCheckedThrowingContinuation { continuation in
            Task { @MainActor in
                GIDSignIn.sharedInstance.restorePreviousSignIn {
                    user,
                    error in
                    if let error {
                        continuation.resume(throwing: error)
                        return
                    }
                    guard let user else {
                        continuation.resume(returning: nil)
                        return
                    }
                    do {
                        continuation.resume(
                            returning: try Self.tokenPair(from: user)
                        )
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }

    @MainActor
    func handle(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    func signOut() async {
        await MainActor.run {
            GIDSignIn.sharedInstance.signOut()
        }
    }

    private static func tokenPair(
        from user: GIDGoogleUser
    ) throws -> GoogleIdentityTokenPair {
        guard let idToken = user.idToken?.tokenString else {
            throw GoogleIdentityError.missingIDToken
        }
        return GoogleIdentityTokenPair(
            idToken: idToken,
            accessToken: user.accessToken.tokenString,
            hostedDomain: hostedDomainClaim(from: idToken)
        )
    }

    private static func hostedDomainClaim(from idToken: String) -> String? {
        let segments = idToken.split(separator: ".")
        guard segments.count == 3 else { return nil }
        var encoded = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded.append(
            String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        )
        guard
            let data = Data(base64Encoded: encoded),
            let object = try? JSONSerialization.jsonObject(with: data),
            let claims = object as? [String: Any]
        else {
            return nil
        }
        return claims["hd"] as? String
    }
}
