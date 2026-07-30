import XCTest
@testable import BrownSync

final class CampusBuildingsTests: XCTestCase {
    func testDecodesNamedCampusBuildingAndPolygon() throws {
        let data = Data(
            """
            {
              "type": "FeatureCollection",
              "features": [{
                "type": "Feature",
                "properties": {
                  "label": "Rockefeller Library",
                  "placeId": "rockefeller-library"
                },
                "geometry": {
                  "type": "Polygon",
                  "coordinates": [[[-71.401, 41.826], [-71.400, 41.826], [-71.401, 41.826]]]
                }
              }]
            }
            """.utf8
        )

        let collection = try CampusBuildings.decode(data)

        XCTAssertEqual(collection.features.count, 1)
        XCTAssertEqual(collection.features[0].properties.label, "Rockefeller Library")
        XCTAssertEqual(collection.features[0].properties.placeId, "rockefeller-library")
        XCTAssertEqual(collection.features[0].geometry.type, "Polygon")
        XCTAssertEqual(collection.features[0].geometry.coordinates[0][0], [-71.401, 41.826])
    }

    func testDecodesBuildingWhenOptionalPlaceMetadataIsAbsent() throws {
        let data = Data(
            """
            {
              "type": "FeatureCollection",
              "features": [{
                "type": "Feature",
                "properties": {},
                "geometry": {
                  "type": "Polygon",
                  "coordinates": [[[-71.401, 41.826], [-71.400, 41.826], [-71.401, 41.826]]]
                }
              }]
            }
            """.utf8
        )

        let collection = try CampusBuildings.decode(data)

        XCTAssertNil(collection.features[0].properties.label)
        XCTAssertNil(collection.features[0].properties.placeId)
    }
}
