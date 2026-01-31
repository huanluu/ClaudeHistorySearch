import Foundation

/// A mock URL protocol for testing network requests without hitting real servers
class MockURLProtocol: URLProtocol {
    /// Map of URL patterns to mock responses
    static var mockResponses: [String: MockResponse] = [:]

    /// Request handler for custom response logic
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    /// Captured requests for verification
    static var capturedRequests: [URLRequest] = []

    struct MockResponse {
        let statusCode: Int
        let data: Data
        let headers: [String: String]

        init(statusCode: Int = 200, data: Data = Data(), headers: [String: String] = [:]) {
            self.statusCode = statusCode
            self.data = data
            self.headers = headers
        }

        init(statusCode: Int = 200, json: Any, headers: [String: String] = [:]) {
            self.statusCode = statusCode
            self.data = (try? JSONSerialization.data(withJSONObject: json)) ?? Data()
            self.headers = headers
        }
    }

    // MARK: - URLProtocol overrides

    override class func canInit(with request: URLRequest) -> Bool {
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    override func startLoading() {
        // Capture the request
        Self.capturedRequests.append(request)

        // Try custom handler first
        if let handler = Self.requestHandler {
            do {
                let (response, data) = try handler(request)
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
                return
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
                return
            }
        }

        // Fall back to mock responses by URL
        guard let url = request.url,
              let mockResponse = Self.mockResponses[url.absoluteString] ?? Self.mockResponses[url.path] else {
            let error = NSError(domain: "MockURLProtocol", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "No mock response for \(request.url?.absoluteString ?? "unknown")"
            ])
            client?.urlProtocol(self, didFailWithError: error)
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: mockResponse.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: mockResponse.headers
        )!

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: mockResponse.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {
        // Nothing to do
    }

    // MARK: - Test helpers

    static func reset() {
        mockResponses = [:]
        requestHandler = nil
        capturedRequests = []
    }

    static func addMockResponse(for url: String, response: MockResponse) {
        mockResponses[url] = response
    }

    static func addJSONResponse(for url: String, statusCode: Int = 200, json: Any) {
        mockResponses[url] = MockResponse(statusCode: statusCode, json: json)
    }

    /// Get the last captured request
    static var lastRequest: URLRequest? {
        capturedRequests.last
    }

    /// Check if a header was included in the last request
    static func lastRequestHeader(_ name: String) -> String? {
        lastRequest?.value(forHTTPHeaderField: name)
    }
}
