import Foundation

public enum AuthClientErrorCode: String, Sendable, Equatable {
    case invalidOtp = "invalid_otp"
    case otpAttemptsExceeded = "otp_attempts_exceeded"
    case otpExpired = "otp_expired"
    case invalidCredential = "invalid_credential"
    case unknownCredential = "unknown_credential"
    case unauthenticated
    case rateLimited = "rate_limited"
    case csrfRequired = "csrf_required"
    case invalidRequest = "invalid_request"
    case internalError = "internal_error"
    case network
    case passkeyCancelled = "passkey_cancelled"
    case passkeyFailed = "passkey_failed"
    case unsupported
    case unknown

    /// Parse a wire-format error code into the enum, falling through to `.unknown`.
    public init(rawString: String) {
        self = AuthClientErrorCode(rawValue: rawString) ?? .unknown
    }
}

public struct AuthClientError: Error, Sendable {
    public let code: AuthClientErrorCode
    public let rawCode: String
    public let message: String
    public let status: Int?
    public let underlying: (any Error)?

    public init(
        code: AuthClientErrorCode,
        rawCode: String,
        message: String,
        status: Int?,
        underlying: (any Error)?
    ) {
        self.code = code
        self.rawCode = rawCode
        self.message = message
        self.status = status
        self.underlying = underlying
    }
}

/// Internal: shape the server returns on non-2xx responses.
struct WireError: Decodable {
    let error: String
    let message: String?
}
