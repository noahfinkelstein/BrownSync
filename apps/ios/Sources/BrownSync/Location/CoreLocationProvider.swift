@preconcurrency import CoreLocation
import Foundation

enum CampusLocationPrecision: Equatable, Sendable {
    case full
    case reduced
}

struct CampusLocationReading: Equatable, Sendable {
    let coordinate: CampusCoordinate
    let horizontalAccuracy: Double
    let precision: CampusLocationPrecision
}

enum CoreLocationProviderError: Error, Equatable {
    case anotherRequestInProgress
    case denied
    case restricted
    case locationUnavailable
}

@MainActor
protocol LocationProviding: Sendable {
    func requestCurrentLocation() async throws -> CampusLocationReading
}

@MainActor
final class CoreLocationProvider: NSObject, LocationProviding,
    @preconcurrency CLLocationManagerDelegate
{
    private let manager: CLLocationManager
    private var continuation:
        CheckedContinuation<CampusLocationReading, Error>?

    override init() {
        manager = CLLocationManager()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.allowsBackgroundLocationUpdates = false
    }

    func requestCurrentLocation() async throws -> CampusLocationReading {
        guard continuation == nil else {
            throw CoreLocationProviderError.anotherRequestInProgress
        }

        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation {
                continuation = $0
                continueForCurrentAuthorization()
            }
        } onCancel: { [weak self] in
            Task { @MainActor in
                self?.cancelCurrentRequest()
            }
        }
    }

    func locationManagerDidChangeAuthorization(
        _: CLLocationManager
    ) {
        guard continuation != nil else { return }
        continueForCurrentAuthorization()
    }

    func locationManager(
        _: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard
            let location = locations.last,
            location.horizontalAccuracy >= 0
        else {
            finish(throwing: .locationUnavailable)
            return
        }
        finish(
            returning: CampusLocationReading(
                coordinate: CampusCoordinate(
                    latitude: location.coordinate.latitude,
                    longitude: location.coordinate.longitude
                ),
                horizontalAccuracy: location.horizontalAccuracy,
                precision: manager.accuracyAuthorization == .fullAccuracy
                    ? .full
                    : .reduced
            )
        )
    }

    func locationManager(
        _: CLLocationManager,
        didFailWithError _: Error
    ) {
        finish(throwing: .locationUnavailable)
    }

    private func continueForCurrentAuthorization() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .restricted:
            finish(throwing: .restricted)
        case .denied:
            finish(throwing: .denied)
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        @unknown default:
            finish(throwing: .locationUnavailable)
        }
    }

    private func finish(returning reading: CampusLocationReading) {
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(returning: reading)
    }

    private func finish(throwing error: CoreLocationProviderError) {
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(throwing: error)
    }

    private func cancelCurrentRequest() {
        manager.stopUpdatingLocation()
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(throwing: CancellationError())
    }
}
