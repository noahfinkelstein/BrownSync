import BrownSyncAPI
import Foundation

struct WorkerOrganizationOwnershipRepository:
    OrganizationOwnershipRepository,
    Sendable
{
    let client: BrownSyncAPI.Client
    let publicOrganizations: any OrganizationRepository
    let logger: any OrganizationOwnershipLogSink

    init(
        client: BrownSyncAPI.Client,
        publicOrganizations: any OrganizationRepository,
        logger: any OrganizationOwnershipLogSink
    ) {
        self.client = client
        self.publicOrganizations = publicOrganizations
        self.logger = logger
    }

    func runLogged<Value: Sendable>(
        operation: OrganizationOwnershipLogOperation,
        _ work: () async throws -> Value
    ) async throws -> Value {
        do {
            return try await work()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            await logger.record(
                .operationFailed(
                    operation: operation,
                    error: Self.safeLogError(for: error)
                )
            )
            throw error
        }
    }

    static func decode<Source: Encodable, Target: Decodable>(
        _ source: Source,
        as _: Target.Type = Target.self
    ) throws -> Target {
        do {
            return try GeneratedJSONBridge.decode(source)
        } catch {
            throw APIError.invalidResponse
        }
    }

    static func apiError<Payload: Encodable>(
        status: Int,
        payload: Payload
    ) -> APIError {
        let envelope: OrganizationOwnershipErrorEnvelopeWire? =
            try? GeneratedJSONBridge.decode(payload)
        return APIError.normalized(
            status: status,
            code: envelope?.error.code
        )
    }

    private static func safeLogError(
        for error: Error
    ) -> OrganizationOwnershipLogError {
        if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized:
                return .unauthorized
            case .brownMembershipRequired:
                return .brownMembershipRequired
            case .recentAuthenticationRequired:
                return .recentAuthenticationRequired
            case .forbidden:
                return .forbidden
            case .rateLimited:
                return .rateLimited
            case .unavailable:
                return .unavailable
            case .invalidResponse:
                return .invalidResponse
            case .server:
                return .server
            }
        }
        if error is OrganizationOwnershipError {
            return .invalidRequest
        }
        return .transport
    }
}

private struct OrganizationOwnershipErrorEnvelopeWire: Decodable {
    struct Detail: Decodable {
        let code: String
    }

    let error: Detail
}
