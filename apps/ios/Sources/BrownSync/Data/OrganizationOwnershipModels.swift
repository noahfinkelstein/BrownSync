import Foundation

enum OrganizationRole: Equatable, Sendable {
    case owner
    case editor
}

enum OrganizationClaimStatus: Equatable, Sendable {
    case pending
    case approved
    case rejected
}

struct OrganizationMembership: Equatable, Sendable {
    let organizationID: String
    let organizationName: String
    let role: OrganizationRole
    let grantedAt: Date
}

struct OrganizationClaimSummary: Equatable, Sendable {
    let id: UUID
    let organizationID: String
    let organizationName: String
    let status: OrganizationClaimStatus
    let createdAt: Date
    let reviewedAt: Date?
    let reviewNote: String?
}

struct OrganizationAccessSnapshot: Equatable, Sendable {
    let memberships: [OrganizationMembership]
    let claims: [OrganizationClaimSummary]
}

enum OrganizationLinkPlatform: Equatable, Sendable {
    case instagram
    case discord
    case facebook
    case linkedin
    case youtube
    case x
    case tiktok
    case website
    case other
}

struct OrganizationLink: Equatable, Sendable {
    let platform: OrganizationLinkPlatform
    let url: URL
    let label: String?
}

struct OrganizationCreateDraft: Equatable, Sendable {
    let name: String
    let description: String?
    let aboutMarkdown: String?
    let meetingInformation: String?
    let links: [OrganizationLink]
}

enum OrganizationCreateDisposition: Equatable, Sendable {
    case created
    case replayed
}

struct OrganizationCreateOutcome: Equatable, Sendable {
    let organizationID: String
    let revision: Int
    let role: OrganizationRole
    let disposition: OrganizationCreateDisposition
}

enum OrganizationClaimOutcome: Equatable, Sendable {
    case autoApproved(role: OrganizationRole, claimID: UUID)
    case pending(claimID: UUID)
    case alreadyAdmin(role: OrganizationRole)
    case replayedPending(claimID: UUID)
}

struct OrganizationClaimCursor: Equatable, Hashable, Sendable {
    let afterCreatedAt: Date
    let afterClaimID: UUID
}

struct OrganizationReviewableClaim: Equatable, Sendable {
    let claimID: UUID
    let organizationID: String
    let organizationName: String
    let claimantDisplayName: String?
    let claimantHandle: String?
    let evidence: String?
    let createdAt: Date
}

struct OrganizationClaimReviewPage: Equatable, Sendable {
    let claims: [OrganizationReviewableClaim]
    let next: OrganizationClaimCursor?
}

struct OrganizationClaimDecisionOutcome: Equatable, Sendable {
    let claimID: UUID
    let status: OrganizationClaimStatus
    let grantedRole: OrganizationRole?
    let changed: Bool
}

enum OrganizationEditValue<Value: Equatable & Sendable>:
    Equatable,
    Sendable
{
    case unchanged
    case set(Value)
    case clear
}

struct OrganizationEditPatchIntent: Equatable, Sendable {
    let description: OrganizationEditValue<String>
    let aboutMarkdown: OrganizationEditValue<String>
    let meetingInformation: OrganizationEditValue<String>
    let links: OrganizationEditValue<[OrganizationLink]>
}

enum OrganizationEditField: Equatable, Sendable {
    case description
    case aboutMarkdown
    case meetingInformation
    case links
}

struct OrganizationEditFieldComparison: Equatable, Sendable {
    let field: OrganizationEditField
    let baselineText: String?
    let submittedText: String?
    let latestText: String?
}

struct OrganizationEditConflictReview: Equatable, Sendable {
    let organizationID: String
    let expectedRevision: Int
    let latestRevision: Int
    let fields: [OrganizationEditFieldComparison]
}

enum OrganizationEditOutcome: Equatable, Sendable {
    case updated(
        organizationID: String,
        revision: Int,
        changed: Bool
    )
    case conflict(OrganizationEditConflictReview)
}

enum OrganizationOwnershipError: Error, Equatable, Sendable {
    case emptyEditPatch
    case invalidReviewPageSize
}

protocol OrganizationOwnershipRepository: Sendable {
    func access() async throws -> OrganizationAccessSnapshot

    func create(
        _ draft: OrganizationCreateDraft
    ) async throws -> OrganizationCreateOutcome

    func claim(
        organizationID: String,
        evidence: String?
    ) async throws -> OrganizationClaimOutcome

    func update(
        organizationID: String,
        baseline: PublicOrganizationProfile,
        expectedRevision: Int,
        patch: OrganizationEditPatchIntent
    ) async throws -> OrganizationEditOutcome

    func reviewPage(
        after cursor: OrganizationClaimCursor?,
        limit: Int
    ) async throws -> OrganizationClaimReviewPage

    func allReviewableClaims(
        pageSize: Int
    ) async throws -> [OrganizationReviewableClaim]

    func decideClaim(
        claimID: UUID,
        approve: Bool,
        note: String?
    ) async throws -> OrganizationClaimDecisionOutcome
}

enum OrganizationOwnershipLogOperation: Equatable, Sendable {
    case access
    case create
    case claim
    case update
    case review
    case decideClaim
}

enum OrganizationOwnershipLogError: Equatable, Sendable {
    case unauthorized
    case brownMembershipRequired
    case recentAuthenticationRequired
    case forbidden
    case rateLimited
    case unavailable
    case invalidResponse
    case server
    case invalidRequest
    case transport
}

enum OrganizationOwnershipLogEvent: Equatable, Sendable {
    case operationFailed(
        operation: OrganizationOwnershipLogOperation,
        error: OrganizationOwnershipLogError
    )
}

protocol OrganizationOwnershipLogSink: Sendable {
    func record(_ event: OrganizationOwnershipLogEvent) async
}
