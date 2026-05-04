import Foundation

/// URLProtocol subclass used by tests to intercept URLSession requests.
/// Tests register a handler that returns canned (Data, HTTPURLResponse, Error?)
/// for each request URL.
final class MockURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (Data, HTTPURLResponse)

    static let lock = NSLock()
    nonisolated(unsafe) private static var _handler: Handler?
    static var handler: Handler? {
        get { lock.lock(); defer { lock.unlock() }; return _handler }
        set { lock.lock(); defer { lock.unlock() }; _handler = newValue }
    }

    /// Last request that arrived at the mock — useful for assertions.
    nonisolated(unsafe) private static var _lastRequest: URLRequest?
    static var lastRequest: URLRequest? {
        get { lock.lock(); defer { lock.unlock() }; return _lastRequest }
        set { lock.lock(); defer { lock.unlock() }; _lastRequest = newValue }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // Capture the body, since URLProtocol doesn't include it on the request
        // by default for streamed bodies.
        var captured = request
        if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buffer, maxLength: 4096)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            stream.close()
            captured.httpBody = data
        }
        MockURLProtocol.lastRequest = captured

        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (data, response) = try handler(captured)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    /// Build a configured URLSession that routes through this protocol.
    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    static func reset() {
        handler = nil
        lastRequest = nil
    }
}
