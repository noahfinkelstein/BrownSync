import Combine
import SwiftUI

@MainActor
private final class PlaceViewModel: ObservableObject {
    @Published private(set) var activity: PublicPlaceActivity?
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var errorMessage: String?

    private let id: String
    private let repository: any PlaceRepository

    init(id: String, repository: any PlaceRepository) {
        self.id = id
        self.repository = repository
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        errorMessage = nil
        do {
            let loaded = try await repository.activity(
                id: id,
                at: nil,
                policy: policy
            )
            activity = loaded.value
            source = loaded.source
        } catch is CancellationError {
            return
        } catch {
            errorMessage = "This place is temporarily unavailable."
        }
    }
}

struct PlaceView: View {
    @StateObject private var model: PlaceViewModel

    init(id: String, places: any PlaceRepository) {
        _model = StateObject(
            wrappedValue: PlaceViewModel(id: id, repository: places)
        )
    }

    var body: some View {
        Group {
            if let activity = model.activity {
                List {
                    if let source = model.source {
                        PublicSourceLabel(source: source)
                    }
                    Section {
                        Text(activity.place.name)
                            .font(.title2.weight(.semibold))
                        if let address = activity.place.address {
                            Label(address, systemImage: "mappin.and.ellipse")
                        }
                        if !activity.place.aliases.isEmpty {
                            Text(
                                "Also known as "
                                    + activity.place.aliases.joined(
                                        separator: ", "
                                    )
                            )
                            .foregroundStyle(.secondary)
                        }
                    }
                    Section("Events") {
                        if activity.events.isEmpty {
                            Text("Nothing scheduled here right now.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(activity.events) { event in
                                NavigationLink(
                                    value: AppRoute.event(event.id)
                                ) {
                                    PublicEventRow(event: event)
                                }
                            }
                        }
                    }
                    if activity.meetingCount > 0 {
                        Section("Classes") {
                            Text(
                                "\(activity.meetingCount) course meetings are in session."
                            )
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
                PublicLoadingView(title: "Loading place")
            }
        }
        .navigationTitle(model.activity?.place.name ?? "Place")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model.activity == nil else { return }
            await model.load()
        }
    }
}
