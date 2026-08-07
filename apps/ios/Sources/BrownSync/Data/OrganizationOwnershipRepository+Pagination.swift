extension WorkerOrganizationOwnershipRepository {
    func allReviewableClaims() async throws
        -> [OrganizationReviewableClaim]
    {
        try await allReviewableClaims(pageSize: 50)
    }

    func allReviewableClaims(
        pageSize: Int
    ) async throws -> [OrganizationReviewableClaim] {
        guard pageSize > 0 else {
            throw OrganizationOwnershipError.invalidReviewPageSize
        }

        let limit = min(pageSize, 100)
        var claims: [OrganizationReviewableClaim] = []
        var cursor: OrganizationClaimCursor?
        var seenCursors: Set<OrganizationClaimCursor> = []

        while true {
            let page = try await reviewPage(
                after: cursor,
                limit: limit
            )
            claims.append(contentsOf: page.claims)

            guard let next = page.next else {
                return claims
            }
            guard seenCursors.insert(next).inserted else {
                throw APIError.invalidResponse
            }
            cursor = next
        }
    }
}
