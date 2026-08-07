import SwiftUI

struct FeedView: View {
    @StateObject private var model: FeedViewModel

    init(events: any EventRepository) {
        _model = StateObject(
            wrappedValue: FeedViewModel(events: events)
        )
    }

    var body: some View {
        Group {
            if let content = model.content {
                List {
                    if let source = model.source {
                        PublicSourceLabel(source: source)
                    }
                    if !content.live.isEmpty {
                        Section("Happening Now") {
                            ForEach(content.live) { event in
                                NavigationLink(value: AppRoute.event(event.id)) {
                                    PublicEventRow(event: event)
                                }
                            }
                        }
                    }
                    Section("Upcoming") {
                        if content.chronological.isEmpty {
                            Text("No upcoming events found.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(content.chronological) { event in
                                NavigationLink(value: AppRoute.event(event.id)) {
                                    PublicEventRow(event: event)
                                }
                            }
                        }
                    }
                }
                .refreshable {
                    await model.load(policy: .reload)
                }
            } else if let error = model.errorMessage {
                PublicErrorView(message: error) {
                    Task { await model.load(policy: .reload) }
                }
            } else {
                PublicLoadingView(title: "Loading events")
            }
        }
        .navigationTitle("Feed")
        .task {
            guard model.content == nil else { return }
            await model.load()
        }
    }
}
