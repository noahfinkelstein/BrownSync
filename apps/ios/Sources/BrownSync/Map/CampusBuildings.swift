import Foundation

struct CampusBuildings: Decodable, Equatable, Sendable {
    let type: String
    let features: [Feature]

    struct Feature: Decodable, Equatable, Sendable {
        let type: String
        let properties: Properties
        let geometry: Geometry
    }

    struct Properties: Decodable, Equatable, Sendable {
        let propertyCode: String?
        let label: String?
        let placeId: String?
        let placeIds: [String]

        private enum CodingKeys: String, CodingKey {
            case propertyCode
            case label
            case placeId
            case placeIds
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            propertyCode = try container.decodeIfPresent(
                String.self,
                forKey: .propertyCode
            )
            label = try container.decodeIfPresent(
                String.self,
                forKey: .label
            )
            placeId = try container.decodeIfPresent(
                String.self,
                forKey: .placeId
            )
            placeIds =
                try container.decodeIfPresent(
                    [String].self,
                    forKey: .placeIds
                )
                ?? placeId.map { [$0] }
                ?? []
        }
    }

    struct Geometry: Decodable, Equatable, Sendable {
        let type: String
        let coordinates: [[[Double]]]
    }

    static func decode(_ data: Data) throws -> CampusBuildings {
        try JSONDecoder().decode(CampusBuildings.self, from: data)
    }
}
