import Combine
import Foundation

struct FeedContent: Equatable, Sendable {
    let live: [PublicEvent]
    let chronological: [PublicEvent]
}

@MainActor
final class FeedViewModel: ObservableObject {
    @Published private(set) var content: FeedContent?
    @Published private(set) var source: PublicDataSource?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isLoading = false

    private let events: any EventRepository

    init(events: any EventRepository) {
        self.events = events
    }

    func load(policy: PublicLoadPolicy = .useCache) async {
        isLoading = true
        errorMessage = nil
        do {
            async let listed = events.events(
                query: EventQuery(),
                policy: policy
            )
            async let live = events.now(policy: policy)
            let loaded = try await (listed, live)
            content = FeedContent(
                live: loaded.1.value.sorted(by: Self.chronological),
                chronological: loaded.0.value.sorted(
                    by: Self.chronological
                )
            )
            source = loaded.0.source.combined(with: loaded.1.source)
            isLoading = false
        } catch is CancellationError {
            isLoading = false
        } catch {
            isLoading = false
            errorMessage = "Events are temporarily unavailable."
        }
    }

    private static func chronological(
        _ lhs: PublicEvent,
        _ rhs: PublicEvent
    ) -> Bool {
        if lhs.start != rhs.start {
            return lhs.start < rhs.start
        }
        return lhs.title.localizedStandardCompare(rhs.title)
            == .orderedAscending
    }
}
