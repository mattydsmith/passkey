import Foundation
@testable import PasskeySDK

enum Fixtures {
    /// Sample server creation options as JSON the server would send.
    static let creationOptionsJSON = #"""
    {
      "challenge": "Y2g",
      "rp": { "id": "example.com", "name": "example" },
      "user": { "id": "dV8x", "name": "matt@example.com", "displayName": "matt@example.com" },
      "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
      "excludeCredentials": [],
      "authenticatorSelection": { "userVerification": "preferred" },
      "timeout": 60000
    }
    """#.data(using: .utf8)!

    /// Sample server request options as JSON.
    static let requestOptionsJSON = #"""
    {
      "challenge": "Y2g",
      "rpId": "example.com",
      "allowCredentials": [],
      "userVerification": "preferred",
      "timeout": 60000
    }
    """#.data(using: .utf8)!

    static func decodedCreationOptions() throws -> ServerCreationOptions {
        try JSONDecoder().decode(ServerCreationOptions.self, from: creationOptionsJSON)
    }

    static func decodedRequestOptions() throws -> ServerRequestOptions {
        try JSONDecoder().decode(ServerRequestOptions.self, from: requestOptionsJSON)
    }
}
