import Foundation

enum StyleLoaderError: Error, Equatable, LocalizedError {
    case missingResource(String)
    case invalidStyleJSON
    case invalidCamera
    case missingProtomapsSource

    var errorDescription: String? {
        switch self {
        case let .missingResource(name):
            return "Missing bundled resource: \(name)"
        case .invalidStyleJSON:
            return "The bundled map style is not a JSON object."
        case .invalidCamera:
            return "The bundled map style has an invalid camera."
        case .missingProtomapsSource:
            return "The bundled map style has no protomaps source."
        }
    }
}

struct StyleCamera: Equatable {
    let longitude: Double
    let latitude: Double
    let zoom: Double
    let bearing: Double
    let pitch: Double
}

enum StyleLoader {
    static func prepare(
        styleURL: URL,
        archiveURL: URL,
        glyphsDirectoryURL: URL,
        fileManager: FileManager = .default
    ) throws -> URL {
        try require(styleURL, named: "style.json", fileManager: fileManager)
        try require(archiveURL, named: "providence.pmtiles", fileManager: fileManager)
        try require(glyphsDirectoryURL, named: "glyphs", fileManager: fileManager)

        let source = try Data(contentsOf: styleURL)
        let rewritten = try rewrite(
            source,
            archiveURL: archiveURL,
            glyphsDirectoryURL: glyphsDirectoryURL
        )
        let preparedURL = fileManager.temporaryDirectory
            .appendingPathComponent("brownsync-style-\(UUID().uuidString).json")
        try rewritten.write(to: preparedURL, options: .atomic)
        return preparedURL
    }

    static func camera(from data: Data) throws -> StyleCamera {
        guard let style = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StyleLoaderError.invalidStyleJSON
        }
        guard let center = style["center"] as? [NSNumber],
              center.count == 2,
              let zoom = style["zoom"] as? NSNumber,
              let bearing = style["bearing"] as? NSNumber,
              let pitch = style["pitch"] as? NSNumber else {
            throw StyleLoaderError.invalidCamera
        }

        let camera = StyleCamera(
            longitude: center[0].doubleValue,
            latitude: center[1].doubleValue,
            zoom: zoom.doubleValue,
            bearing: bearing.doubleValue,
            pitch: pitch.doubleValue
        )
        guard camera.longitude.isFinite,
              (-180...180).contains(camera.longitude),
              camera.latitude.isFinite,
              (-90...90).contains(camera.latitude),
              camera.zoom.isFinite,
              camera.bearing.isFinite,
              camera.pitch.isFinite else {
            throw StyleLoaderError.invalidCamera
        }
        return camera
    }

    static func rewrite(
        _ data: Data,
        archiveURL: URL,
        glyphsDirectoryURL: URL
    ) throws -> Data {
        guard var style = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StyleLoaderError.invalidStyleJSON
        }
        guard var sources = style["sources"] as? [String: Any],
              var protomaps = sources["protomaps"] as? [String: Any] else {
            throw StyleLoaderError.missingProtomapsSource
        }

        protomaps["url"] = "pmtiles://\(archiveURL.absoluteString)"
        sources["protomaps"] = protomaps
        style["sources"] = sources

        let glyphsRoot = glyphsDirectoryURL.absoluteString.hasSuffix("/")
            ? String(glyphsDirectoryURL.absoluteString.dropLast())
            : glyphsDirectoryURL.absoluteString
        style["glyphs"] = "\(glyphsRoot)/{fontstack}/{range}.pbf"
        style.removeValue(forKey: "sky")

        return try JSONSerialization.data(
            withJSONObject: style,
            options: [.sortedKeys]
        )
    }

    private static func require(
        _ url: URL,
        named name: String,
        fileManager: FileManager
    ) throws {
        guard fileManager.fileExists(atPath: url.path) else {
            throw StyleLoaderError.missingResource(name)
        }
    }
}
