import Foundation

public struct AuthUser: Sendable, Decodable, Equatable {
    public let id: String
    public let email: String

    public init(id: String, email: String) {
        self.id = id
        self.email = email
    }
}

public struct StartEmailSignInResult: Sendable, Decodable, Equatable {
    public let otpId: String
    public let expiresInSeconds: Int
}

public struct VerifyEmailOtpResult: Sendable, Equatable {
    public let user: AuthUser
}

public struct RegisterPasskeyResult: Sendable, Decodable, Equatable {
    public let passkeyId: String
}

public struct SignInWithPasskeyResult: Sendable, Equatable {
    public let user: AuthUser
}

public struct GetCurrentUserResult: Sendable, Decodable, Equatable {
    public let user: AuthUser
}

public struct SessionSummary: Sendable, Decodable, Equatable {
    public let createdAt: Int
    public let expiresAt: Int
    public let lastSeenAt: Int
    public let userAgent: String?
    public let ip: String?
}

public struct ListSessionsResult: Sendable, Decodable, Equatable {
    public let sessions: [SessionSummary]
}

public struct PasskeySummary: Sendable, Decodable, Equatable {
    public let id: String
    public let deviceName: String?
    public let createdAt: Int
    public let lastUsedAt: Int?
    public let transports: [String]?
}

public struct ListPasskeysResult: Sendable, Decodable, Equatable {
    public let passkeys: [PasskeySummary]
}
