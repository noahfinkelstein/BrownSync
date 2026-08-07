import BrownSyncAPI
import Foundation
import XCTest

final class OrganizationGeneratedV2OperationsREDTests: XCTestCase {
  func testGeneratedOrgEditV2EncodesDescriptionSetAboutClearAndOmissionExactly()
    throws
  {
    let request = Components.Schemas.OrgEditV2Request(
      version: 2,
      expectedRevision: 3,
      patch: Components.Schemas.OrgEditV2Patch(
        description: Components.Schemas.OrgEditDescriptionCommand(
          action: .set,
          value: "Updated description"
        ),
        aboutMd: Components.Schemas.OrgEditAboutMdCommand(
          action: .clear
        )
      )
    )

    let object = try phase4JSONObject(
      JSONEncoder().encode(request)
    )

    XCTAssertEqual(
      object as NSDictionary,
      [
        "version": 2,
        "expectedRevision": 3,
        "patch": [
          "description": [
            "action": "set",
            "value": "Updated description",
          ],
          "aboutMd": [
            "action": "clear"
          ],
        ],
      ] as NSDictionary
    )
  }

  func testGeneratedOrgEditV2EncodesMeetingClearAndLinksSetExactly()
    throws
  {
    let request = Components.Schemas.OrgEditV2Request(
      version: 2,
      expectedRevision: 4,
      patch: Components.Schemas.OrgEditV2Patch(
        meetingInfo: Components.Schemas.OrgEditMeetingInfoCommand(
          action: .clear
        ),
        links: Components.Schemas.OrgEditLinksCommand(
          action: .set,
          value: [
            Components.Schemas.OrgLink(
              platform: .website,
              url: "https://studentradio.example"
            )
          ]
        )
      )
    )

    let object = try phase4JSONObject(
      JSONEncoder().encode(request)
    )

    XCTAssertEqual(
      object as NSDictionary,
      [
        "version": 2,
        "expectedRevision": 4,
        "patch": [
          "meetingInfo": [
            "action": "clear"
          ],
          "links": [
            "action": "set",
            "value": [
              [
                "platform": "website",
                "url":
                  "https://studentradio.example",
              ]
            ],
          ],
        ],
      ] as NSDictionary
    )
  }
}
