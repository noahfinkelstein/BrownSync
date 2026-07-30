import Foundation

struct CampusBuildings: Decodable, Equatable {
    let type: String
    let features: [Feature]

    struct Feature: Decodable, Equatable {
        let type: String
        let properties: Properties
        let geometry: Geometry
    }

    struct Properties: Decodable, Equatable {
        let label: String?
        let placeId: String?
    }

    struct Geometry: Decodable, Equatable {
        let type: String
        let coordinates: [[[Double]]]
    }

    static func decode(_ data: Data) throws -> CampusBuildings {
        try JSONDecoder().decode(CampusBuildings.self, from: data)
    }
}
