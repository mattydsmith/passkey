import Foundation
import AuthenticationServices

/// Test seam for AuthenticationServices. The default implementation delegates
/// to ASAuthorizationController; tests substitute a mock that returns canned
/// authorizations or throws specific ASAuthorizationError values.
public protocol AuthenticationServicesProvider: Sendable {
    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization
}

/// Production implementation. Wraps ASAuthorizationController in async/await.
public final class DefaultAuthenticationServicesProvider: NSObject, AuthenticationServicesProvider, ASAuthorizationControllerDelegate, @unchecked Sendable {
    public override init() {
        super.init()
    }

    public func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            let controller = ASAuthorizationController(authorizationRequests: [request])
            let bridge = Bridge(continuation: continuation)
            controller.delegate = bridge
            // Retain bridge for the lifetime of the controller call.
            // ASAuthorizationController holds delegate weakly, so we attach
            // the bridge to the controller via an associated object.
            objc_setAssociatedObject(controller, &Bridge.key, bridge, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            controller.performRequests()
        }
    }

    private final class Bridge: NSObject, ASAuthorizationControllerDelegate {
        static var key: UInt8 = 0
        let continuation: CheckedContinuation<ASAuthorization, any Error>
        private var resumed = false

        init(continuation: CheckedContinuation<ASAuthorization, any Error>) {
            self.continuation = continuation
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
            guard !resumed else { return }
            resumed = true
            continuation.resume(returning: authorization)
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
            guard !resumed else { return }
            resumed = true
            continuation.resume(throwing: error)
        }
    }
}
