import Foundation
import XCTest

final class PrivacyManifestREDTests: XCTestCase {
    func testShippedAuthAndPresenceDataIsLinkedNonTrackingAppFunctionality()
        throws
    {
        let declarations = try collectedDataDeclarations()
        let requiredTypes: Set<String> = [
            "NSPrivacyCollectedDataTypeEmailAddress",
            "NSPrivacyCollectedDataTypeUserID",
            "NSPrivacyCollectedDataTypeCoarseLocation",
            "NSPrivacyCollectedDataTypeOtherUserContent",
        ]

        for requiredType in requiredTypes {
            let declaration = try XCTUnwrap(
                declarations.first {
                    $0["NSPrivacyCollectedDataType"] as? String
                        == requiredType
                },
                "Missing privacy declaration for \(requiredType)."
            )
            XCTAssertEqual(
                declaration["NSPrivacyCollectedDataTypeLinked"] as? Bool,
                true,
                "\(requiredType) must be disclosed as linked to the user."
            )
            XCTAssertEqual(
                declaration["NSPrivacyCollectedDataTypeTracking"] as? Bool,
                false,
                "\(requiredType) must not be disclosed as tracking."
            )
            XCTAssertEqual(
                declaration["NSPrivacyCollectedDataTypePurposes"]
                    as? [String],
                ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
                "\(requiredType) is collected only for app functionality."
            )
        }
    }

    func testManifestKeepsTrackingDisabledAndNeverDeclaresPreciseLocation()
        throws
    {
        let manifest = try privacyManifest()
        let declarations = try collectedDataDeclarations(from: manifest)
        let declaredTypes = Set(
            declarations.compactMap {
                $0["NSPrivacyCollectedDataType"] as? String
            }
        )

        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
        XCTAssertFalse(
            declaredTypes.contains(
                "NSPrivacyCollectedDataTypePreciseLocation"
            ),
            "Raw coordinates remain on device, so precise location "
                + "must not be declared as collected."
        )
    }

    private func collectedDataDeclarations()
        throws -> [[String: Any]]
    {
        try collectedDataDeclarations(from: privacyManifest())
    }

    private func collectedDataDeclarations(
        from manifest: [String: Any]
    ) throws -> [[String: Any]] {
        try XCTUnwrap(
            manifest["NSPrivacyCollectedDataTypes"]
                as? [[String: Any]],
            "Privacy manifest must contain a collected-data array."
        )
    }

    private func privacyManifest() throws -> [String: Any] {
        let fileURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources")
            .appendingPathComponent("PrivacyInfo.xcprivacy")
        let data = try Data(contentsOf: fileURL)
        return try XCTUnwrap(
            PropertyListSerialization.propertyList(
                from: data,
                options: [],
                format: nil
            ) as? [String: Any],
            "PrivacyInfo.xcprivacy must be a dictionary plist."
        )
    }
}
