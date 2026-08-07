import SwiftUI

@main
struct BrownSyncApp: App {
    private enum Bootstrap {
        case ready(AppContainer)
        case configurationUnavailable
    }

    private let bootstrap: Bootstrap

    init() {
        do {
            bootstrap = .ready(try AppContainer.production())
        } catch {
            bootstrap = .configurationUnavailable
        }
    }

    var body: some Scene {
        WindowGroup {
            switch bootstrap {
            case .ready(let container):
                ConfiguredRootView(container: container)
            case .configurationUnavailable:
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title)
                    Text("BrownSync is unavailable")
                        .font(.headline)
                    Text("This build is missing required app configuration.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding()
            }
        }
    }
}

private struct ConfiguredRootView: View {
    let container: AppContainer

    @ViewBuilder
    var body: some View {
        if let socialDependencies = container.socialDependencies {
            RootView(
                dependencies: container.publicShellDependencies,
                socialDependencies: socialDependencies,
                organizationAdminModel:
                    container.organizationAdminModel,
                boardDependencies: container.boardDependencies,
                authCoordinator: container.authCoordinator,
                deepLinkCoordinator: container.deepLinkCoordinator,
                navigator: container.navigator
            )
            .task {
                container.authCoordinator.start()
                try? await container.authCoordinator
                    .configureIdentityProvider()
            }
        } else {
            Text("BrownSync social configuration is unavailable.")
        }
    }
}
