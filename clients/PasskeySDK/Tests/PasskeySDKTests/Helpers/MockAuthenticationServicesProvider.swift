import Foundation
import AuthenticationServices
@testable import PasskeySDK

/// A test provider that returns a canned ASAuthorization or throws a canned
/// error. Tests pre-load the result before invoking the SDK call.
final class MockAuthenticationServicesProvider: AuthenticationServicesProvider, @unchecked Sendable {
    enum Behavior {
        case success(ASAuthorization)
        case failure(any Error)
    }

    var nextBehavior: Behavior?
    private(set) var lastRequest: ASAuthorizationRequest?

    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        lastRequest = request
        guard let behavior = nextBehavior else {
            XCTFailure("MockAuthenticationServicesProvider invoked without a configured behavior")
        }
        nextBehavior = nil
        switch behavior {
        case .success(let authorization):
            return authorization
        case .failure(let error):
            throw error
        }
    }
}

import XCTest

func XCTFailure(_ message: String) -> Never {
    XCTFail(message)
    fatalError(message)
}
