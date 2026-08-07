import Foundation
import XCTest

@testable import BrownSync

final class CampusPlaceSnapperREDTests: XCTestCase {
    func testCheckedInDatasetRetainsAllPolygonAndPlaceMetadata()
        throws
    {
        let collection = try checkedInCampusBuildings()

        XCTAssertEqual(collection.features.count, 262)
        XCTAssertTrue(
            collection.features.allSatisfy {
                $0.geometry.type == "Polygon"
            }
        )
        XCTAssertEqual(
            collection.features.filter {
                $0.properties.placeId != nil
            }.count,
            154
        )
        XCTAssertEqual(
            collection.features.filter {
                $0.properties.placeId == nil
            }.count,
            108
        )
        XCTAssertEqual(
            collection.features.filter {
                $0.properties.placeIds.count > 1
            }.count,
            6
        )
        XCTAssertEqual(
            Set(
                collection.features.compactMap(
                    \.properties.propertyCode
                )
            ).count,
            262
        )
        XCTAssertEqual(
            collection.features.filter {
                $0.geometry.coordinates.count > 1
            }.map(\.properties.propertyCode),
            ["100327"],
            "Polygon rings must retain the checked-in hole."
        )
    }

    func testOneMappedBuildingIsOnlyASuggestionUntilConfirmed()
        throws
    {
        let collection = try checkedInCampusBuildings()
        let feature = try XCTUnwrap(
            collection.features.first {
                $0.properties.placeId != nil
                    && $0.properties.placeIds.count == 1
            }
        )
        let coordinate = try unambiguousInteriorCoordinate(
            of: feature,
            in: collection
        )
        let snapper = CampusPlaceSnapper(buildings: collection)

        let suggestion = snapper.suggestion(
            for: coordinate,
            horizontalAccuracy: 15
        )

        guard case let .single(candidate) = suggestion else {
            return XCTFail("Expected one candidate, got \(suggestion)")
        }
        XCTAssertEqual(candidate.placeID, feature.properties.placeId)
        XCTAssertEqual(
            candidate.propertyCode,
            feature.properties.propertyCode
        )
        let confirmed = try snapper.confirm(
            placeID: candidate.placeID,
            from: suggestion
        )
        XCTAssertEqual(confirmed.placeID, candidate.placeID)
    }

    func testAllSixMultiPlaceBuildingsReturnEveryCandidateWithoutChoosing()
        throws
    {
        let collection = try checkedInCampusBuildings()
        let multiPlaceFeatures = collection.features.filter {
            $0.properties.placeIds.count > 1
        }
        let snapper = CampusPlaceSnapper(buildings: collection)

        let results = try multiPlaceFeatures.map { feature in
            let suggestion = snapper.suggestion(
                for: try unambiguousInteriorCoordinate(
                    of: feature,
                    in: collection
                ),
                horizontalAccuracy: 15
            )
            guard case let .multiple(candidates) = suggestion else {
                XCTFail(
                    "Expected multiple choices for "
                        + (feature.properties.propertyCode ?? "unknown")
                )
                return (feature, [BuildingPlaceCandidate]())
            }
            return (feature, candidates)
        }

        XCTAssertEqual(results.count, 6)
        for (feature, candidates) in results {
            XCTAssertEqual(
                Set(candidates.map(\.placeID)),
                Set(feature.properties.placeIds)
            )
            XCTAssertTrue(
                candidates.allSatisfy {
                    $0.propertyCode == feature.properties.propertyCode
                }
            )
            let labels = candidates.compactMap(\.label)
            XCTAssertEqual(labels.count, candidates.count)
            XCTAssertEqual(
                Set(labels).count,
                candidates.count,
                "Every multi-place choice needs a distinct visible and VoiceOver label."
            )
            let canonicalPlaces = candidates.map { candidate in
                PublicPlace(
                    id: candidate.placeID,
                    name: "Canonical \(candidate.placeID)",
                    aliases: [],
                    kind: "campus",
                    address: nil,
                    latitude: 41.8,
                    longitude: -71.4
                )
            }
            let displayNames = candidates.map {
                CampusPlaceCandidateNaming.displayName(
                    for: $0,
                    availablePlaces: canonicalPlaces
                )
            }
            XCTAssertEqual(
                Set(displayNames).count,
                candidates.count,
                "All six multi-place buildings need unique canonical button and VoiceOver names."
            )
            for candidate in candidates {
                let confirmed = try snapper.confirm(
                    placeID: candidate.placeID,
                    from: .multiple(candidates)
                )
                XCTAssertEqual(confirmed.placeID, candidate.placeID)
                XCTAssertEqual(
                    CampusPlaceCandidateNaming.displayName(
                        for: candidate,
                        availablePlaces: canonicalPlaces
                    ),
                    "Canonical \(candidate.placeID)"
                )
            }
        }
    }

    func testRecognizedUnmappedBuildingRequiresManualPlaceSearch()
        throws
    {
        let collection = try checkedInCampusBuildings()
        let feature = try XCTUnwrap(
            collection.features.first {
                $0.properties.placeId == nil
            }
        )
        let snapper = CampusPlaceSnapper(buildings: collection)

        let suggestion = snapper.suggestion(
            for: try unambiguousInteriorCoordinate(
                of: feature,
                in: collection
            ),
            horizontalAccuracy: 15
        )

        guard case let .recognizedUnmapped(building) = suggestion else {
            return XCTFail(
                "An unmapped polygon must not become a guessed place."
            )
        }
        XCTAssertEqual(
            building.propertyCode,
            feature.properties.propertyCode
        )
        XCTAssertEqual(building.label, feature.properties.label)
    }

    func testPointInsideHoleIsNotInsideBuilding() throws {
        let collection = try checkedInCampusBuildings()
        let snapper = CampusPlaceSnapper(buildings: collection)

        let suggestion = snapper.suggestion(
            for: CampusCoordinate(
                latitude: 41.82898,
                longitude: -71.40010
            ),
            horizontalAccuracy: 15
        )

        XCTAssertEqual(suggestion, .manualSearch(.outsidePolygons))
    }

    func testExactOuterBoundaryIsACandidate() throws {
        let collection = try CampusBuildings.decode(
            squareFeatureCollection(
                propertyCode: "boundary",
                placeID: "boundary-hall",
                minimumLongitude: -71.41,
                minimumLatitude: 41.82,
                maximumLongitude: -71.40,
                maximumLatitude: 41.83
            )
        )
        let snapper = CampusPlaceSnapper(buildings: collection)

        let suggestion = snapper.suggestion(
            for: CampusCoordinate(
                latitude: 41.82,
                longitude: -71.41
            ),
            horizontalAccuracy: 15
        )

        guard case let .single(candidate) = suggestion else {
            return XCTFail("An exact polygon vertex must be included.")
        }
        XCTAssertEqual(candidate.placeID, "boundary-hall")
    }

    func testOverlappingDifferentBuildingsRequireManualSearch() throws {
        let first = String(
            decoding: squareFeature(
                propertyCode: "first",
                placeID: "first-place",
                minimumLongitude: -71.41,
                minimumLatitude: 41.82,
                maximumLongitude: -71.39,
                maximumLatitude: 41.84
            ),
            as: UTF8.self
        )
        let second = String(
            decoding: squareFeature(
                propertyCode: "second",
                placeID: "second-place",
                minimumLongitude: -71.405,
                minimumLatitude: 41.825,
                maximumLongitude: -71.385,
                maximumLatitude: 41.845
            ),
            as: UTF8.self
        )
        let collection = try CampusBuildings.decode(
            Data(
                """
                {"type":"FeatureCollection","features":[\(first),\(second)]}
                """.utf8
            )
        )
        let snapper = CampusPlaceSnapper(buildings: collection)

        let suggestion = snapper.suggestion(
            for: CampusCoordinate(
                latitude: 41.83,
                longitude: -71.40
            ),
            horizontalAccuracy: 15
        )

        XCTAssertEqual(
            suggestion,
            .manualSearch(.conflictingCandidates)
        )
    }

    func testOutsideAndPoorAccuracyNeverChooseNearestBuilding()
        throws
    {
        let collection = try CampusBuildings.decode(
            squareFeatureCollection(
                propertyCode: "one",
                placeID: "one-place",
                minimumLongitude: -71.41,
                minimumLatitude: 41.82,
                maximumLongitude: -71.40,
                maximumLatitude: 41.83
            )
        )
        let snapper = CampusPlaceSnapper(
            buildings: collection,
            maximumHorizontalAccuracy: 100
        )

        XCTAssertEqual(
            snapper.suggestion(
                for: CampusCoordinate(
                    latitude: 41.90,
                    longitude: -71.50
                ),
                horizontalAccuracy: 15
            ),
            .manualSearch(.outsidePolygons)
        )
        XCTAssertEqual(
            snapper.suggestion(
                for: CampusCoordinate(
                    latitude: 41.825,
                    longitude: -71.405
                ),
                horizontalAccuracy: 101
            ),
            .manualSearch(.poorHorizontalAccuracy)
        )
    }

    func testReducedAccuracyDeterministicallyRequiresManualSearch() throws {
        let collection = try CampusBuildings.decode(
            squareFeatureCollection(
                propertyCode: "one",
                placeID: "one-place",
                minimumLongitude: -71.41,
                minimumLatitude: 41.82,
                maximumLongitude: -71.40,
                maximumLatitude: 41.83
            )
        )
        let snapper = CampusPlaceSnapper(buildings: collection)

        let suggestion = snapper.suggestion(
            for: CampusLocationReading(
                coordinate: CampusCoordinate(
                    latitude: 41.825,
                    longitude: -71.405
                ),
                horizontalAccuracy: 15,
                precision: .reduced
            )
        )

        XCTAssertEqual(suggestion, .manualSearch(.reducedAccuracy))
    }

    func testCannotConfirmAPlaceThatWasNotSuggested() throws {
        let collection = try CampusBuildings.decode(
            squareFeatureCollection(
                propertyCode: "one",
                placeID: "one-place",
                minimumLongitude: -71.41,
                minimumLatitude: 41.82,
                maximumLongitude: -71.40,
                maximumLatitude: 41.83
            )
        )
        let snapper = CampusPlaceSnapper(buildings: collection)
        let suggestion = snapper.suggestion(
            for: CampusCoordinate(
                latitude: 41.825,
                longitude: -71.405
            ),
            horizontalAccuracy: 15
        )

        XCTAssertThrowsError(
            try snapper.confirm(
                placeID: "different-place",
                from: suggestion
            )
        )
    }

    private func checkedInCampusBuildings() throws -> CampusBuildings {
        let fileURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources")
            .appendingPathComponent("campus-buildings.geojson")
        return try CampusBuildings.decode(Data(contentsOf: fileURL))
    }

    private func unambiguousInteriorCoordinate(
        of feature: CampusBuildings.Feature,
        in collection: CampusBuildings
    ) throws -> CampusCoordinate {
        let outerRing = try XCTUnwrap(
            feature.geometry.coordinates.first
        )
        let origin = try fixturePair(from: XCTUnwrap(outerRing.first))
        var twiceArea = 0.0
        var longitudeNumerator = 0.0
        var latitudeNumerator = 0.0

        for index in outerRing.indices {
            let nextIndex = outerRing.index(after: index)
            let wrappedNext =
                nextIndex == outerRing.endIndex
                ? outerRing.startIndex
                : nextIndex
            let first = try fixturePair(from: outerRing[index])
            let second = try fixturePair(from: outerRing[wrappedNext])
            let firstLongitude = first.longitude - origin.longitude
            let firstLatitude = first.latitude - origin.latitude
            let secondLongitude = second.longitude - origin.longitude
            let secondLatitude = second.latitude - origin.latitude
            let cross =
                firstLongitude * secondLatitude
                - secondLongitude * firstLatitude
            twiceArea += cross
            longitudeNumerator +=
                (firstLongitude + secondLongitude) * cross
            latitudeNumerator +=
                (firstLatitude + secondLatitude) * cross
        }

        XCTAssertGreaterThan(abs(twiceArea), Double.ulpOfOne)
        let coordinate = CampusCoordinate(
            latitude: origin.latitude
                + latitudeNumerator / (3 * twiceArea),
            longitude: origin.longitude
                + longitudeNumerator / (3 * twiceArea)
        )
        let containingPropertyCodes = try collection.features.compactMap {
            candidate -> String? in
            try fixtureContains(coordinate, in: candidate)
                ? candidate.properties.propertyCode
                : nil
        }
        XCTAssertEqual(
            containingPropertyCodes,
            [feature.properties.propertyCode].compactMap { $0 },
            "The metadata fixture must use an interior point unique to its intended real polygon."
        )
        return coordinate
    }

    private func fixtureContains(
        _ point: CampusCoordinate,
        in feature: CampusBuildings.Feature
    ) throws -> Bool {
        guard
            let outerRing = feature.geometry.coordinates.first,
            try fixtureIsInsideOrOnBoundary(point, ring: outerRing)
        else {
            return false
        }
        for hole in feature.geometry.coordinates.dropFirst() {
            if try fixtureIsInside(point, ring: hole) {
                return false
            }
        }
        return true
    }

    private func fixtureIsInsideOrOnBoundary(
        _ point: CampusCoordinate,
        ring: [[Double]]
    ) throws -> Bool {
        guard ring.count >= 3 else { return false }
        for index in ring.indices {
            let nextIndex = ring.index(after: index)
            let wrappedNext =
                nextIndex == ring.endIndex
                ? ring.startIndex
                : nextIndex
            let first = try fixturePair(from: ring[index])
            let second = try fixturePair(from: ring[wrappedNext])
            let cross =
                (point.longitude - first.longitude)
                    * (second.latitude - first.latitude)
                - (point.latitude - first.latitude)
                    * (second.longitude - first.longitude)
            if abs(cross) <= 1e-12,
                point.longitude
                    >= min(first.longitude, second.longitude) - 1e-12,
                point.longitude
                    <= max(first.longitude, second.longitude) + 1e-12,
                point.latitude
                    >= min(first.latitude, second.latitude) - 1e-12,
                point.latitude
                    <= max(first.latitude, second.latitude) + 1e-12
            {
                return true
            }
        }
        return try fixtureIsInside(point, ring: ring)
    }

    private func fixtureIsInside(
        _ point: CampusCoordinate,
        ring: [[Double]]
    ) throws -> Bool {
        guard ring.count >= 3 else { return false }
        var isInside = false
        var previous = ring.count - 1
        for current in ring.indices {
            let first = try fixturePair(from: ring[current])
            let second = try fixturePair(from: ring[previous])
            if (first.latitude > point.latitude)
                != (second.latitude > point.latitude)
            {
                let longitudeAtLatitude =
                    (second.longitude - first.longitude)
                    * (point.latitude - first.latitude)
                    / (second.latitude - first.latitude)
                    + first.longitude
                if point.longitude < longitudeAtLatitude {
                    isInside.toggle()
                }
            }
            previous = current
        }
        return isInside
    }

    private func fixturePair(
        from values: [Double]
    ) throws -> (longitude: Double, latitude: Double) {
        XCTAssertGreaterThanOrEqual(values.count, 2)
        guard values.count >= 2 else {
            throw CampusFixtureError.malformedCoordinate
        }
        return (values[0], values[1])
    }

    private func squareFeatureCollection(
        propertyCode: String,
        placeID: String,
        minimumLongitude: Double,
        minimumLatitude: Double,
        maximumLongitude: Double,
        maximumLatitude: Double
    ) -> Data {
        let feature = String(
            decoding: squareFeature(
                propertyCode: propertyCode,
                placeID: placeID,
                minimumLongitude: minimumLongitude,
                minimumLatitude: minimumLatitude,
                maximumLongitude: maximumLongitude,
                maximumLatitude: maximumLatitude
            ),
            as: UTF8.self
        )
        return Data(
            """
            {"type":"FeatureCollection","features":[\(feature)]}
            """.utf8
        )
    }

    private func squareFeature(
        propertyCode: String,
        placeID: String,
        minimumLongitude: Double,
        minimumLatitude: Double,
        maximumLongitude: Double,
        maximumLatitude: Double
    ) -> Data {
        Data(
            """
            {
              "type":"Feature",
              "properties":{
                "propertyCode":"\(propertyCode)",
                "label":"Test Building",
                "placeId":"\(placeID)",
                "placeIds":["\(placeID)"]
              },
              "geometry":{
                "type":"Polygon",
                "coordinates":[[
                  [\(minimumLongitude),\(minimumLatitude)],
                  [\(maximumLongitude),\(minimumLatitude)],
                  [\(maximumLongitude),\(maximumLatitude)],
                  [\(minimumLongitude),\(maximumLatitude)],
                  [\(minimumLongitude),\(minimumLatitude)]
                ]]
              }
            }
            """.utf8
        )
    }
}

private enum CampusFixtureError: Error {
    case malformedCoordinate
}
