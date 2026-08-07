import Foundation

struct SocialDependencies: Sendable {
    let repository: any SocialRepository
    let cache: SensitiveCache
    let writeCoordinator: PresenceWriteCoordinator
    let realtimeCoordinator: PresenceRealtimeCoordinator
    let timeSource: any PresenceTimeProviding
    let locationProvider: any LocationProviding
    let placeSnapper: CampusPlaceSnapper
}
