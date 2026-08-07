import Foundation

struct CompositeSensitiveCachePurger: SensitiveCachePurging {
    private let caches: [any SensitiveCachePurging]

    init(caches: [any SensitiveCachePurging]) {
        self.caches = caches
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        for cache in caches {
            await cache.purge(reason: reason)
        }
    }
}

struct CompositeProtectedTaskCanceller:
    ProtectedTaskCancelling,
    ProtectedTaskActivating
{
    private let tasks: [any ProtectedTaskCancelling]

    init(tasks: [any ProtectedTaskCancelling]) {
        self.tasks = tasks
    }

    func cancelProtectedTasks() async {
        for task in tasks {
            await task.cancelProtectedTasks()
        }
    }

    func activateProtectedSession(userID: UUID) async {
        for task in tasks {
            guard
                let activating =
                    task as? any ProtectedTaskActivating
            else {
                continue
            }
            await activating.activateProtectedSession(userID: userID)
        }
    }
}
