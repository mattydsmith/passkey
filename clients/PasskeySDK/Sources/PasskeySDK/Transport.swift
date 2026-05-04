import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

/// Empty response type for endpoints whose body the client doesn't read.
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
}

struct Transport: Sendable {
    let baseURL: URL
    let session: URLSession
    let storage: any TokenStorage

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    func request<T: Decodable>(path: String, method: HTTPMethod, body: (any Encodable)?) async throws -> T {
        let url = composeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        try storage.attach(to: &request)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthClientError(
                code: .network,
                rawCode: "network",
                message: "Network request failed: \(error.localizedDescription)",
                status: nil,
                underlying: error
            )
        }

        guard let http = response as? HTTPURLResponse else {
            throw AuthClientError(
                code: .network,
                rawCode: "network",
                message: "Response was not HTTP",
                status: nil,
                underlying: nil
            )
        }

        if !(200..<300).contains(http.statusCode) {
            // Try to decode {error, message}; fall back to a synthesized message.
            let wire = try? decoder.decode(WireError.self, from: data)
            let rawCode = wire?.error ?? "network"
            let message = wire?.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw AuthClientError(
                code: AuthClientErrorCode(rawString: rawCode),
                rawCode: rawCode,
                message: message,
                status: http.statusCode,
                underlying: nil
            )
        }

        if data.isEmpty, let empty = EmptyResponse() as? T {
            return empty
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw AuthClientError(
                code: .network,
                rawCode: "network",
                message: "Response was not valid JSON",
                status: http.statusCode,
                underlying: error
            )
        }
    }

    private func composeURL(path: String) -> URL {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        // baseURL might or might not have a trailing slash; appendingPathComponent handles that.
        return baseURL.appendingPathComponent(trimmed)
    }
}

/// Type-erasing wrapper that lets us encode any `Encodable` value through JSONEncoder.
private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) {
        self._encode = wrapped.encode
    }
    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
