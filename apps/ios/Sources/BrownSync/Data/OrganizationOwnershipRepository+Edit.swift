import BrownSyncAPI
import Foundation

extension WorkerOrganizationOwnershipRepository {
    func update(
        organizationID: String,
        baseline: PublicOrganizationProfile,
        expectedRevision: Int,
        patch: OrganizationEditPatchIntent
    ) async throws -> OrganizationEditOutcome {
        guard !patch.isEmpty else {
            throw OrganizationOwnershipError.emptyEditPatch
        }

        return try await runLogged(
            operation: .update
        ) { [client, publicOrganizations] in
            let request = Components.Schemas.OrgEditV2Request(
                version: 2,
                expectedRevision: expectedRevision,
                patch: Components.Schemas.OrgEditV2Patch(
                    description: Self.descriptionCommand(
                        for: patch.description
                    ),
                    aboutMd: Self.aboutCommand(
                        for: patch.aboutMarkdown
                    ),
                    meetingInfo: Self.meetingCommand(
                        for: patch.meetingInformation
                    ),
                    links: Self.linksCommand(for: patch.links)
                )
            )
            let output = try await client.updateOrganization(
                .init(
                    path: .init(id: organizationID),
                    body: .json(
                        Components.Schemas.OrgEditRequest(
                            value2: request
                        )
                    )
                )
            )

            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(payload):
                    let wire: OrganizationEditResultWire =
                        try Self.decode(payload)
                    guard
                        wire.organizationId == organizationID,
                        wire.revision >= 0
                    else {
                        throw APIError.invalidResponse
                    }
                    return .updated(
                        organizationID: wire.organizationId,
                        revision: wire.revision,
                        changed: wire.changed
                    )
                }
            case let .badRequest(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 400, payload: payload)
                }
            case let .unauthorized(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 401, payload: payload)
                }
            case let .forbidden(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 403, payload: payload)
                }
            case let .notFound(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 404, payload: payload)
                }
            case let .conflict(response):
                switch response.body {
                case let .json(payload):
                    guard Self.errorCode(in: payload) == "conflict" else {
                        throw Self.apiError(
                            status: 409,
                            payload: payload
                        )
                    }
                    let latestResource =
                        try await publicOrganizations.profile(
                            id: organizationID,
                            at: nil,
                            policy: .reload
                        )
                    guard
                        latestResource.value.id == organizationID,
                        latestResource.value.revision >= 0
                    else {
                        throw APIError.invalidResponse
                    }
                    return .conflict(
                        OrganizationEditConflictReview(
                            organizationID: organizationID,
                            expectedRevision: expectedRevision,
                            latestRevision:
                                latestResource.value.revision,
                            fields: Self.conflictFields(
                                baseline: baseline,
                                submitted: patch,
                                latest: latestResource.value
                            )
                        )
                    )
                }
            case let .tooManyRequests(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 429, payload: payload)
                }
            case let .serviceUnavailable(response):
                switch response.body {
                case let .json(payload):
                    throw Self.apiError(status: 503, payload: payload)
                }
            case let .undocumented(status, _):
                throw APIError.server(status: status, code: nil)
            }
        }
    }

    private static func descriptionCommand(
        for intent: OrganizationEditValue<String>
    ) -> Components.Schemas.OrgEditDescriptionCommand? {
        switch intent {
        case .unchanged:
            return nil
        case let .set(value):
            return .init(action: .set, value: value)
        case .clear:
            return .init(action: .clear)
        }
    }

    private static func aboutCommand(
        for intent: OrganizationEditValue<String>
    ) -> Components.Schemas.OrgEditAboutMdCommand? {
        switch intent {
        case .unchanged:
            return nil
        case let .set(value):
            return .init(action: .set, value: value)
        case .clear:
            return .init(action: .clear)
        }
    }

    private static func meetingCommand(
        for intent: OrganizationEditValue<String>
    ) -> Components.Schemas.OrgEditMeetingInfoCommand? {
        switch intent {
        case .unchanged:
            return nil
        case let .set(value):
            return .init(action: .set, value: value)
        case .clear:
            return .init(action: .clear)
        }
    }

    private static func linksCommand(
        for intent: OrganizationEditValue<[OrganizationLink]>
    ) -> Components.Schemas.OrgEditLinksCommand? {
        switch intent {
        case .unchanged:
            return nil
        case let .set(value):
            return .init(
                action: .set,
                value: value.map(Self.generatedEditLink)
            )
        case .clear:
            return .init(action: .clear)
        }
    }

    private static func generatedEditLink(
        _ link: OrganizationLink
    ) -> Components.Schemas.OrgLink {
        switch link.platform {
        case .instagram:
            return .init(
                platform: .instagram,
                url: link.url.absoluteString,
                label: link.label
            )
        case .discord:
            return .init(
                platform: .discord,
                url: link.url.absoluteString,
                label: link.label
            )
        case .facebook:
            return .init(
                platform: .facebook,
                url: link.url.absoluteString,
                label: link.label
            )
        case .linkedin:
            return .init(
                platform: .linkedin,
                url: link.url.absoluteString,
                label: link.label
            )
        case .youtube:
            return .init(
                platform: .youtube,
                url: link.url.absoluteString,
                label: link.label
            )
        case .x:
            return .init(
                platform: .x,
                url: link.url.absoluteString,
                label: link.label
            )
        case .tiktok:
            return .init(
                platform: .tiktok,
                url: link.url.absoluteString,
                label: link.label
            )
        case .website:
            return .init(
                platform: .website,
                url: link.url.absoluteString,
                label: link.label
            )
        case .other:
            return .init(
                platform: .other,
                url: link.url.absoluteString,
                label: link.label
            )
        }
    }

    private static func errorCode<Payload: Encodable>(
        in payload: Payload
    ) -> String? {
        let envelope: OrganizationEditErrorEnvelopeWire? =
            try? GeneratedJSONBridge.decode(payload)
        return envelope?.error.code
    }

    private static func conflictFields(
        baseline: PublicOrganizationProfile,
        submitted: OrganizationEditPatchIntent,
        latest: PublicOrganizationProfile
    ) -> [OrganizationEditFieldComparison] {
        var fields: [OrganizationEditFieldComparison] = []

        if let submittedText = submitted.description.submittedText {
            fields.append(
                .init(
                    field: .description,
                    baselineText: baseline.summary,
                    submittedText: submittedText,
                    latestText: latest.summary
                )
            )
        } else if submitted.description.isClear {
            fields.append(
                .init(
                    field: .description,
                    baselineText: baseline.summary,
                    submittedText: nil,
                    latestText: latest.summary
                )
            )
        }

        if let submittedText = submitted.aboutMarkdown.submittedText {
            fields.append(
                .init(
                    field: .aboutMarkdown,
                    baselineText: baseline.about,
                    submittedText: submittedText,
                    latestText: latest.about
                )
            )
        } else if submitted.aboutMarkdown.isClear {
            fields.append(
                .init(
                    field: .aboutMarkdown,
                    baselineText: baseline.about,
                    submittedText: nil,
                    latestText: latest.about
                )
            )
        }

        if let submittedText =
            submitted.meetingInformation.submittedText
        {
            fields.append(
                .init(
                    field: .meetingInformation,
                    baselineText: baseline.meetingInformation,
                    submittedText: submittedText,
                    latestText: latest.meetingInformation
                )
            )
        } else if submitted.meetingInformation.isClear {
            fields.append(
                .init(
                    field: .meetingInformation,
                    baselineText: baseline.meetingInformation,
                    submittedText: nil,
                    latestText: latest.meetingInformation
                )
            )
        }

        switch submitted.links {
        case .unchanged:
            break
        case let .set(links):
            fields.append(
                .init(
                    field: .links,
                    baselineText: renderedPublicLinks(baseline.links),
                    submittedText: renderedLinks(links),
                    latestText: renderedPublicLinks(latest.links)
                )
            )
        case .clear:
            fields.append(
                .init(
                    field: .links,
                    baselineText: renderedPublicLinks(baseline.links),
                    submittedText: nil,
                    latestText: renderedPublicLinks(latest.links)
                )
            )
        }

        return fields
    }

    private static func renderedLinks(
        _ links: [OrganizationLink]
    ) -> String {
        links.map { link in
            renderedLink(
                platform: link.platform.stableName,
                label: link.label,
                url: link.url.absoluteString
            )
        }.joined(separator: "\n")
    }

    private static func renderedPublicLinks(
        _ links: [PublicOrganizationLink]
    ) -> String {
        links.map { link in
            renderedLink(
                platform: link.platform,
                label: link.label,
                url: link.url
            )
        }.joined(separator: "\n")
    }

    private static func renderedLink(
        platform: String,
        label: String?,
        url: String
    ) -> String {
        if let label {
            return "\(platform): \(label) — \(url)"
        }
        return "\(platform): \(url)"
    }
}

private struct OrganizationEditResultWire: Decodable {
    let organizationId: String
    let revision: Int
    let changed: Bool
}

private struct OrganizationEditErrorEnvelopeWire: Decodable {
    struct Detail: Decodable {
        let code: String
    }

    let error: Detail
}

private extension OrganizationEditPatchIntent {
    var isEmpty: Bool {
        description.isUnchanged
            && aboutMarkdown.isUnchanged
            && meetingInformation.isUnchanged
            && links.isUnchanged
    }
}

private extension OrganizationEditValue {
    var isUnchanged: Bool {
        if case .unchanged = self {
            return true
        }
        return false
    }

    var isClear: Bool {
        if case .clear = self {
            return true
        }
        return false
    }
}

private extension OrganizationEditValue where Value == String {
    var submittedText: String? {
        if case let .set(value) = self {
            return value
        }
        return nil
    }
}

private extension OrganizationLinkPlatform {
    var stableName: String {
        switch self {
        case .instagram:
            return "instagram"
        case .discord:
            return "discord"
        case .facebook:
            return "facebook"
        case .linkedin:
            return "linkedin"
        case .youtube:
            return "youtube"
        case .x:
            return "x"
        case .tiktok:
            return "tiktok"
        case .website:
            return "website"
        case .other:
            return "other"
        }
    }
}
