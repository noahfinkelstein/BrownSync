import SwiftUI

enum MapLoadStatus: Equatable {
    case loading
    case ready
    case failed(String)

    var message: String {
        switch self {
        case .loading:
            return "Loading map"
        case .ready:
            return "Map ready"
        case let .failed(message):
            return "Map failed: \(message)"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .loading:
            return "map-status-loading"
        case .ready:
            return "map-status-ready"
        case .failed:
            return "map-status-failed"
        }
    }

    func acceptingFullyRendered() -> MapLoadStatus {
        switch self {
        case .failed:
            return self
        case .loading, .ready:
            return .ready
        }
    }
}

struct RootView: View {
    @State private var mapStatus: MapLoadStatus = .loading

    var body: some View {
        ZStack(alignment: .bottom) {
            MapViewRepresentable(status: $mapStatus)
                .ignoresSafeArea()

            Text(mapStatus.message)
                .font(.footnote.monospaced())
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .padding()
                .accessibilityIdentifier(mapStatus.accessibilityIdentifier)
        }
    }
}
