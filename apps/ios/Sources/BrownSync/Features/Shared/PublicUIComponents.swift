import SwiftUI

struct PublicSourceLabel: View {
    let source: PublicDataSource

    var body: some View {
        switch source {
        case .network:
            EmptyView()
        case .cache:
            Label("Showing saved results", systemImage: "clock.arrow.circlepath")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Showing saved results")
        case let .offline(isStale):
            Label(
                isStale
                    ? "Offline — saved results may be out of date"
                    : "Offline — showing saved results",
                systemImage: "wifi.slash"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

struct PublicEventRow: View {
    let event: PublicEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(event.title)
                .font(.headline)
            Text(
                event.start,
                format: .dateTime
                    .weekday(.abbreviated)
                    .month(.abbreviated)
                    .day()
                    .hour()
                    .minute()
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            if let placeName = event.placeName {
                Label(placeName, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if event.isCanceled {
                Label("Canceled", systemImage: "xmark.circle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 3)
    }
}

struct PublicLoadingView: View {
    let title: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

struct PublicErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(message)
                .multilineTextAlignment(.center)
            Button("Try Again", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
