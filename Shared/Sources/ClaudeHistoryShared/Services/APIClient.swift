import Foundation

public enum SearchSortOption: String, CaseIterable, Identifiable {
    case relevance
    case date

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .relevance: return "Relevance"
        case .date: return "Date"
        }
    }
}

@MainActor
public class APIClient: ObservableObject {
    @Published public var isLoading = false
    @Published public var error: String?
    @Published public var isAuthenticated = true

    private var baseURL: URL?
    private var apiKey: String?
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    // Use a URLSession with no caching to always get fresh data
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    public init() {}

    public func setBaseURL(_ url: URL?) {
        baseURL = url
    }

    public func getBaseURL() -> URL? {
        baseURL
    }

    public func setAPIKey(_ key: String?) {
        apiKey = key
        isAuthenticated = true
    }

    public func getAPIKey() -> String? {
        apiKey
    }

    /// Load API key from Keychain
    public func loadAPIKeyFromKeychain() {
        apiKey = KeychainHelper.shared.getAPIKey()
    }

    /// Save API key to Keychain
    public func saveAPIKeyToKeychain(_ key: String) throws {
        try KeychainHelper.shared.saveAPIKey(key)
        apiKey = key
        isAuthenticated = true
    }

    /// Clear API key from memory and Keychain
    public func clearAPIKey() throws {
        try KeychainHelper.shared.deleteAPIKey()
        apiKey = nil
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

        var request = URLRequest(url: components.url!)
        addAuthHeader(to: &request)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(SessionsResponse.self, from: data)
    }

    public func fetchSession(id: String) async throws -> SessionDetailResponse {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        let url = baseURL.appendingPathComponent("sessions").appendingPathComponent(id)
        var request = URLRequest(url: url)
        addAuthHeader(to: &request)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(SessionDetailResponse.self, from: data)
    }

    // MARK: - Search

    public func search(query: String, limit: Int = 50, offset: Int = 0, sort: SearchSortOption = .relevance) async throws -> SearchResponse {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        var components = URLComponents(url: baseURL.appendingPathComponent("search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
            URLQueryItem(name: "sort", value: sort.rawValue)
        ]

        var request = URLRequest(url: components.url!)
        addAuthHeader(to: &request)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(SearchResponse.self, from: data)
    }

    // MARK: - Health

    public func checkHealth() async throws -> Bool {
        guard let baseURL = baseURL else {
            throw APIError.noServer
        }

        let url = baseURL.appendingPathComponent("health")
        let (_, response) = try await session.data(from: url)

        if let httpResponse = response as? HTTPURLResponse {
            return httpResponse.statusCode == 200
        }
        return false
    }

    // MARK: - Helpers

    private func addAuthHeader(to request: inout URLRequest) {
        if let apiKey = apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200..<300:
            return
        case 401:
            isAuthenticated = false
            throw APIError.unauthorized
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
    case unauthorized
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
        case .unauthorized:
            return "Invalid or missing API key"
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
