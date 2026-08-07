import SwiftUI

struct SearchView: View {
    @StateObject private var model: SearchViewModel
    @State private var query = ""

    init(
        events: any EventRepository,
        places: any PlaceRepository,
        organizations: any OrganizationRepository
    ) {
        _model = StateObject(
            wrappedValue: SearchViewModel(
                events: events,
                places: places,
                organizations: organizations
            )
        )
    }

    var body: some View {
        List {
            if let source = model.source {
                PublicSourceLabel(source: source)
            }
            if model.isLoading {
                ProgressView("Searching")
            }
            if let partialResultsMessage = model.partialResultsMessage {
                Label(
                    partialResultsMessage,
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Text(error)
                    .foregroundStyle(.secondary)
            } else if query.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .font(.title)
                        .foregroundStyle(.secondary)
                    Text("Search events, places, and organizations")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else if !model.isLoading && model.results.isEmpty {
                Text("No results found.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.results) { result in
                    NavigationLink(value: result.route) {
                        HStack(spacing: 12) {
                            Image(systemName: symbol(for: result.kind))
                                .frame(width: 24)
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(result.title)
                                    .font(.headline)
                                if let subtitle = result.subtitle {
                                    Text(subtitle)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Search")
        .searchable(
            text: Binding(
                get: { query },
                set: {
                    query = $0
                    model.updateQuery($0)
                }
            ),
            prompt: "Events, places, organizations"
        )
    }

    private func symbol(for kind: PublicSearchResultKind) -> String {
        switch kind {
        case .event:
            return "calendar"
        case .place:
            return "mappin.and.ellipse"
        case .organization:
            return "person.3"
        }
    }
}
