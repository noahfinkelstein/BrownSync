import SwiftUI

struct MapScreen: View {
    @StateObject private var model: MapScreenModel
    @State private var mapStatus: MapLoadStatus = .loading
    private let onSelectRoute: (AppRoute) -> Void

    init(
        events: any EventRepository,
        onSelectRoute: @escaping (AppRoute) -> Void
    ) {
        _model = StateObject(
            wrappedValue: MapScreenModel(events: events)
        )
        self.onSelectRoute = onSelectRoute
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .bottom) {
                MapViewRepresentable(
                    markers: model.mapMarkers,
                    status: $mapStatus,
                    onSelect: onSelectRoute
                )
                    .accessibilityLabel("Brown campus map")

                Text(mapStatus.message)
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(.regularMaterial, in: Capsule())
                    .padding(10)
                    .accessibilityIdentifier(
                        mapStatus.accessibilityIdentifier
                    )
            }
            .frame(minHeight: 260)

            List {
                if let source = model.source {
                    PublicSourceLabel(source: source)
                }
                Section("Events on the Map") {
                    if model.isLoading && model.events.isEmpty {
                        ProgressView("Loading campus events")
                    } else if let error = model.errorMessage,
                              model.events.isEmpty
                    {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(error)
                            Button("Try Again") {
                                Task {
                                    await model.load(policy: .reload)
                                }
                            }
                        }
                    } else if model.accessibleItems.isEmpty {
                        Text("No mapped events in the next seven days.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.accessibleItems) { item in
                            NavigationLink(value: item.route) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.title)
                                        .font(.headline)
                                    Text(
                                        item.start,
                                        format: .dateTime
                                            .weekday(.abbreviated)
                                            .hour()
                                            .minute()
                                    )
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    if let placeName = item.placeName {
                                        Text(placeName)
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .frame(minHeight: 210)
            .refreshable {
                await model.load(policy: .reload)
            }
        }
        .navigationTitle("Map")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model.events.isEmpty else { return }
            await model.load()
        }
    }
}
