import Combine
import SwiftUI

@MainActor
private final class EventDetailViewModel: ObservableObject {
    @Published private(set) var detail: PublicEventDetail?
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var errorMessage: String?

    private let id: UUID
    private let repository: any EventRepository

    init(id: UUID, repository: any EventRepository) {
        self.id = id
        self.repository = repository
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        errorMessage = nil
        do {
            let loaded = try await repository.event(
                id: id,
                policy: policy
            )
            detail = loaded.value
            source = loaded.source
        } catch is CancellationError {
            return
        } catch {
            errorMessage = "This event is temporarily unavailable."
        }
    }
}

struct EventDetailView: View {
    @StateObject private var model: EventDetailViewModel

    init(id: UUID, events: any EventRepository) {
        _model = StateObject(
            wrappedValue: EventDetailViewModel(
                id: id,
                repository: events
            )
        )
    }

    var body: some View {
        Group {
            if let detail = model.detail {
                List {
                    if let source = model.source {
                        PublicSourceLabel(source: source)
                    }
                    Section {
                        Text(detail.event.title)
                            .font(.title2.weight(.semibold))
                        Label {
                            Text(
                                detail.event.start,
                                format: .dateTime
                                    .weekday(.wide)
                                    .month(.wide)
                                    .day()
                                    .hour()
                                    .minute()
                            )
                        } icon: {
                            Image(systemName: "calendar")
                        }
                        if let end = detail.event.end {
                            Label {
                                Text(
                                    "Ends \(end.formatted(date: .omitted, time: .shortened))"
                                )
                            } icon: {
                                Image(systemName: "clock")
                            }
                        }
                        if let summary = detail.event.summary {
                            Text(summary)
                        }
                    }
                    if detail.event.placeID != nil
                        || detail.event.organizationID != nil
                    {
                        Section("Details") {
                            if let placeID = detail.event.placeID {
                                NavigationLink(
                                    value: AppRoute.place(placeID)
                                ) {
                                    Label(
                                        detail.event.placeName ?? "Place",
                                        systemImage: "mappin.and.ellipse"
                                    )
                                }
                            }
                            if let organizationID =
                                detail.event.organizationID
                            {
                                NavigationLink(
                                    value: AppRoute.organization(
                                        organizationID
                                    )
                                ) {
                                    Label(
                                        detail.event.organizationName
                                            ?? "Organization",
                                        systemImage: "person.3"
                                    )
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
                PublicLoadingView(title: "Loading event")
            }
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model.detail == nil else { return }
            await model.load()
        }
    }
}
