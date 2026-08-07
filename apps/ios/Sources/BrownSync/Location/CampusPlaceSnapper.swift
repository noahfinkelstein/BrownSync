import Foundation

struct CampusCoordinate: Equatable, Sendable {
    let latitude: Double
    let longitude: Double
}

struct BuildingPlaceCandidate: Equatable, Hashable, Sendable {
    let placeID: String
    let propertyCode: String?
    let label: String?
}

struct RecognizedCampusBuilding: Equatable, Sendable {
    let propertyCode: String?
    let label: String?
}

enum CampusPlaceManualSearchReason: Equatable, Sendable {
    case reducedAccuracy
    case poorHorizontalAccuracy
    case outsidePolygons
    case conflictingCandidates
}

enum CampusPlaceSuggestion: Equatable, Sendable {
    case single(BuildingPlaceCandidate)
    case multiple([BuildingPlaceCandidate])
    case recognizedUnmapped(RecognizedCampusBuilding)
    case manualSearch(CampusPlaceManualSearchReason)
}

struct ConfirmedCampusPlace: Equatable, Sendable {
    let placeID: String
}

enum CampusPlaceConfirmationError: Error, Equatable {
    case unsuggestedPlace
}

struct CampusPlaceSnapper: Sendable {
    private struct BoundingBox: Sendable {
        let minimumLatitude: Double
        let maximumLatitude: Double
        let minimumLongitude: Double
        let maximumLongitude: Double

        func contains(_ coordinate: CampusCoordinate) -> Bool {
            coordinate.latitude >= minimumLatitude
                && coordinate.latitude <= maximumLatitude
                && coordinate.longitude >= minimumLongitude
                && coordinate.longitude <= maximumLongitude
        }
    }

    private struct IndexedFeature: Sendable {
        let feature: CampusBuildings.Feature
        let boundingBox: BoundingBox
    }

    private let indexedFeatures: [IndexedFeature]
    private let maximumHorizontalAccuracy: Double

    init(
        buildings: CampusBuildings,
        maximumHorizontalAccuracy: Double = 100
    ) {
        indexedFeatures = buildings.features.compactMap { feature in
            guard let boundingBox = Self.boundingBox(for: feature) else {
                return nil
            }
            return IndexedFeature(
                feature: feature,
                boundingBox: boundingBox
            )
        }
        self.maximumHorizontalAccuracy = maximumHorizontalAccuracy
    }

    func suggestion(
        for coordinate: CampusCoordinate,
        horizontalAccuracy: Double
    ) -> CampusPlaceSuggestion {
        guard
            horizontalAccuracy.isFinite,
            horizontalAccuracy >= 0,
            horizontalAccuracy <= maximumHorizontalAccuracy
        else {
            return .manualSearch(.poorHorizontalAccuracy)
        }

        let containing: [CampusBuildings.Feature] =
            indexedFeatures.compactMap { indexed in
            guard
                indexed.boundingBox.contains(coordinate),
                self.contains(
                    coordinate,
                    in: indexed.feature.geometry
                )
            else {
                return nil
            }
            return indexed.feature
            }
        guard let feature = containing.first else {
            return .manualSearch(.outsidePolygons)
        }
        guard containing.count == 1 else {
            return .manualSearch(.conflictingCandidates)
        }

        let placeIDs = feature.properties.placeIds
        if placeIDs.isEmpty {
            return .recognizedUnmapped(
                RecognizedCampusBuilding(
                    propertyCode: feature.properties.propertyCode,
                    label: feature.properties.label
                )
            )
        }
        let hasMultiplePlaces = placeIDs.count > 1
        let candidates = placeIDs.map { placeID in
            let label: String?
            if hasMultiplePlaces {
                let placeName = placeID
                    .split(separator: "-")
                    .map { $0.capitalized }
                    .joined(separator: " ")
                label = [
                    feature.properties.label,
                    placeName,
                ]
                .compactMap { $0 }
                .joined(separator: " — ")
            } else {
                label = feature.properties.label
            }
            return BuildingPlaceCandidate(
                placeID: placeID,
                propertyCode: feature.properties.propertyCode,
                label: label
            )
        }
        if candidates.count == 1 {
            return .single(candidates[0])
        }
        return .multiple(candidates)
    }

    func suggestion(
        for reading: CampusLocationReading
    ) -> CampusPlaceSuggestion {
        guard reading.precision == .full else {
            return .manualSearch(.reducedAccuracy)
        }
        return suggestion(
            for: reading.coordinate,
            horizontalAccuracy: reading.horizontalAccuracy
        )
    }

    func confirm(
        placeID: String,
        from suggestion: CampusPlaceSuggestion
    ) throws -> ConfirmedCampusPlace {
        let candidateIDs: Set<String>
        switch suggestion {
        case let .single(candidate):
            candidateIDs = [candidate.placeID]
        case let .multiple(candidates):
            candidateIDs = Set(candidates.map(\.placeID))
        case .recognizedUnmapped, .manualSearch:
            candidateIDs = []
        }
        guard candidateIDs.contains(placeID) else {
            throw CampusPlaceConfirmationError.unsuggestedPlace
        }
        return ConfirmedCampusPlace(placeID: placeID)
    }

    private func contains(
        _ point: CampusCoordinate,
        in geometry: CampusBuildings.Geometry
    ) -> Bool {
        guard
            geometry.type == "Polygon",
            let outerRing = geometry.coordinates.first,
            isInsideOrOnBoundary(point, ring: outerRing)
        else {
            return false
        }

        for hole in geometry.coordinates.dropFirst() {
            if isOnBoundary(point, ring: hole) {
                return true
            }
            if isInside(point, ring: hole) {
                return false
            }
        }
        return true
    }

    private func isInsideOrOnBoundary(
        _ point: CampusCoordinate,
        ring: [[Double]]
    ) -> Bool {
        isOnBoundary(point, ring: ring) || isInside(point, ring: ring)
    }

    private func isOnBoundary(
        _ point: CampusCoordinate,
        ring: [[Double]]
    ) -> Bool {
        guard ring.count >= 2 else { return false }
        for index in ring.indices {
            let nextIndex = ring.index(after: index)
            let next = nextIndex == ring.endIndex
                ? ring.startIndex
                : nextIndex
            guard
                let first = pair(from: ring[index]),
                let second = pair(from: ring[next])
            else {
                continue
            }
            if isOnSegment(
                x: point.longitude,
                y: point.latitude,
                first: first,
                second: second
            ) {
                return true
            }
        }
        return false
    }

    private func isInside(
        _ point: CampusCoordinate,
        ring: [[Double]]
    ) -> Bool {
        guard ring.count >= 3 else { return false }
        var inside = false
        var previous = ring.count - 1
        for current in ring.indices {
            guard
                let a = pair(from: ring[current]),
                let b = pair(from: ring[previous])
            else {
                previous = current
                continue
            }
            let crossesLatitude =
                (a.y > point.latitude) != (b.y > point.latitude)
            if crossesLatitude {
                let longitudeAtLatitude =
                    (b.x - a.x)
                    * (point.latitude - a.y)
                    / (b.y - a.y)
                    + a.x
                if point.longitude < longitudeAtLatitude {
                    inside.toggle()
                }
            }
            previous = current
        }
        return inside
    }

    private func isOnSegment(
        x: Double,
        y: Double,
        first: (x: Double, y: Double),
        second: (x: Double, y: Double)
    ) -> Bool {
        let cross =
            (x - first.x) * (second.y - first.y)
            - (y - first.y) * (second.x - first.x)
        let scale = max(
            1,
            abs(second.x - first.x) + abs(second.y - first.y)
        )
        guard abs(cross) <= 1e-12 * scale else { return false }
        return x >= min(first.x, second.x) - 1e-12
            && x <= max(first.x, second.x) + 1e-12
            && y >= min(first.y, second.y) - 1e-12
            && y <= max(first.y, second.y) + 1e-12
    }

    private func pair(from values: [Double]) -> (x: Double, y: Double)? {
        guard values.count >= 2 else { return nil }
        return (values[0], values[1])
    }

    private static func boundingBox(
        for feature: CampusBuildings.Feature
    ) -> BoundingBox? {
        let pairs = feature.geometry.coordinates
            .flatMap { $0 }
            .compactMap { values -> (longitude: Double, latitude: Double)? in
                guard values.count >= 2 else { return nil }
                return (values[0], values[1])
            }
        guard
            let minimumLatitude = pairs.map(\.latitude).min(),
            let maximumLatitude = pairs.map(\.latitude).max(),
            let minimumLongitude = pairs.map(\.longitude).min(),
            let maximumLongitude = pairs.map(\.longitude).max()
        else {
            return nil
        }
        return BoundingBox(
            minimumLatitude: minimumLatitude,
            maximumLatitude: maximumLatitude,
            minimumLongitude: minimumLongitude,
            maximumLongitude: maximumLongitude
        )
    }
}
