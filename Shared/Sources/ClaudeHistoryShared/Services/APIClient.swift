import Foundation

@MainActor
public class APIClient: ObservableObject {
    @Published public var isLoading = false
    @Published public var error: String?

    private var baseURL: URL?
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    public init() {}

    public func setBaseURL(_ url: URL?) {
        baseURL = url
    }

    public func getBaseURL() -> URL? {
        baseURL
    }

    // MARK: - Sessions

    public func fetchSessions(limit: Int = 20, offset: Int = 0) async throws -> SessionsResponse {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        var components = URLComponents(url: baseURL.appendingPathComponent("sessions"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)")
        ]

        let (data, response) = try await URLSession.shared.data(from: components.url!)
        try validateResponse(response)
        return try decoder.decode(SessionsResponse.self, from: data)
    }

    public func fetchSession(id: String) async throws -> SessionDetailResponse {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        let url = baseURL.appendingPathComponent("sessions").appendingPathComponent(id)
        let (data, response) = try await URLSession.shared.data(from: url)
        try validateResponse(response)
        return try decoder.decode(SessionDetailResponse.self, from: data)
    }

    // MARK: - Search

    public func search(query: String, limit: Int = 50, offset: Int = 0) async throws -> SearchResponse {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        var components = URLComponents(url: baseURL.appendingPathComponent("search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)")
        ]

        let (data, response) = try await URLSession.shared.data(from: components.url!)
        try validateResponse(response)
        return try decoder.decode(SearchResponse.self, from: data)
    }

    // MARK: - Health

    public func checkHealth() async throws -> Bool {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        let url = baseURL.appendingPathComponent("health")
        let (_, response) = try await URLSession.shared.data(from: url)

        if let httpResponse = response as? HTTPURLResponse {
            return httpResponse.statusCode == 200
        }
        return false
    }

    // MARK: - Helpers

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200..<300:
            return
        case 404:
            throw APIError.notFound
        case 400..<500:
            throw APIError.clientError(httpResponse.statusCode)
        case 500..<600:
            throw APIError.serverError(httpResponse.statusCode)
        default:
            throw APIError.unknown(httpResponse.statusCode)
        }
    }
}

public enum APIError: LocalizedError {
    case noServer
    case invalidResponse
    case notFound
    case clientError(Int)
    case serverError(Int)
    case unknown(Int)

    public var errorDescription: String? {
        switch self {
        case .noServer:
            return "No server connected"
        case .invalidResponse:
            return "Invalid server response"
        case .notFound:
            return "Resource not found"
        case .clientError(let code):
            return "Client error: \(code)"
        case .serverError(let code):
            return "Server error: \(code)"
        case .unknown(let code):
            return "Unknown error: \(code)"
        }
    }
}
