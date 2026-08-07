import UIKit

enum PresentationControllerError: Error {
    case unavailable
}

@MainActor
protocol PresentationControllerProviding: AnyObject {
    func presentationController() throws -> UIViewController
}

@MainActor
final class WindowPresentationControllerProvider:
    PresentationControllerProviding
{
    func presentationController() throws -> UIViewController {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
        guard
            let root = scenes
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?
                .rootViewController
        else {
            throw PresentationControllerError.unavailable
        }
        return Self.visibleController(from: root)
    }

    private static func visibleController(
        from controller: UIViewController
    ) -> UIViewController {
        if let presented = controller.presentedViewController {
            return visibleController(from: presented)
        }
        if
            let navigation = controller as? UINavigationController,
            let visible = navigation.visibleViewController
        {
            return visibleController(from: visible)
        }
        if
            let tab = controller as? UITabBarController,
            let selected = tab.selectedViewController
        {
            return visibleController(from: selected)
        }
        return controller
    }
}
