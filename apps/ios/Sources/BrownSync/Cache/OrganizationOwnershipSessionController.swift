import Foundation

@MainActor
final class OrganizationOwnershipSessionController:
    SensitiveCachePurging
{
    private weak var model: OrganizationAdminViewModel?

    func attach(model: OrganizationAdminViewModel) {
        self.model = model
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        guard let model else { return }
        await model.deactivate(reason: reason).value
    }
}
