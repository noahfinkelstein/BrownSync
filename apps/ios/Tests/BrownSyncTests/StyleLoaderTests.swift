import XCTest
@testable import BrownSync

final class StyleLoaderTests: XCTestCase {
    func testParsesCameraFromCanonicalStyleFields() throws {
        let source = """
        {
          "version": 8,
          "center": [-71.4015, 41.8268],
          "zoom": 15.1,
          "bearing": -15,
          "pitch": 45
        }
        """

        let camera = try StyleLoader.camera(from: Data(source.utf8))

        XCTAssertEqual(camera.longitude, -71.4015)
        XCTAssertEqual(camera.latitude, 41.8268)
        XCTAssertEqual(camera.zoom, 15.1)
        XCTAssertEqual(camera.bearing, -15)
        XCTAssertEqual(camera.pitch, 45)
    }

    func testMissingCameraFieldReturnsInvalidCameraError() {
        let source = """
        {
          "version": 8,
          "center": [-71.4015, 41.8268],
          "zoom": 15.1,
          "bearing": -15
        }
        """

        XCTAssertThrowsError(
            try StyleLoader.camera(from: Data(source.utf8))
        ) { error in
            XCTAssertEqual(error as? StyleLoaderError, .invalidCamera)
        }
    }

    func testRewritesOnlyLocalURLsAndRemovesUnsupportedSky() throws {
        let source = """
        {
          "version": 8,
          "glyphs": "https://example.com/{fontstack}/{range}.pbf",
          "light": {"anchor": "map", "intensity": 0.35},
          "sky": {"sky-type": "atmosphere"},
          "sources": {
            "protomaps": {
              "type": "vector",
              "url": "pmtiles:///tiles/providence.pmtiles"
            }
          },
          "layers": [
            {"id": "land", "type": "background", "paint": {"background-color": "#123456"}}
          ]
        }
        """
        let archiveURL = URL(fileURLWithPath: "/Bundle/providence.pmtiles")
        let glyphsURL = URL(fileURLWithPath: "/Bundle/glyphs", isDirectory: true)

        let data = try StyleLoader.rewrite(
            Data(source.utf8),
            archiveURL: archiveURL,
            glyphsDirectoryURL: glyphsURL
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let sources = try XCTUnwrap(object["sources"] as? [String: Any])
        let protomaps = try XCTUnwrap(sources["protomaps"] as? [String: Any])
        let light = try XCTUnwrap(object["light"] as? [String: Any])
        let layers = try XCTUnwrap(object["layers"] as? [[String: Any]])
        let paint = try XCTUnwrap(layers.first?["paint"] as? [String: Any])

        XCTAssertEqual(
            protomaps["url"] as? String,
            "pmtiles://file:///Bundle/providence.pmtiles"
        )
        XCTAssertEqual(
            object["glyphs"] as? String,
            "file:///Bundle/glyphs/{fontstack}/{range}.pbf"
        )
        XCTAssertNil(object["sky"])
        XCTAssertEqual(light["intensity"] as? Double, 0.35)
        XCTAssertEqual(paint["background-color"] as? String, "#123456")
    }

    func testMissingStyleResourceReturnsNamedError() {
        let missingStyle = URL(fileURLWithPath: "/missing/style.json")
        let missingArchive = URL(fileURLWithPath: "/missing/providence.pmtiles")
        let missingGlyphs = URL(fileURLWithPath: "/missing/glyphs")

        XCTAssertThrowsError(
            try StyleLoader.prepare(
                styleURL: missingStyle,
                archiveURL: missingArchive,
                glyphsDirectoryURL: missingGlyphs
            )
        ) { error in
            XCTAssertEqual(
                error as? StyleLoaderError,
                .missingResource("style.json")
            )
        }
    }
}
