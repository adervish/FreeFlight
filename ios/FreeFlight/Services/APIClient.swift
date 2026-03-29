import Foundation

actor APIClient {
    static let shared = APIClient()

    var baseURL = "https://freeflight.bentboolean.com"

    private let session: URLSession
    private let decoder = JSONDecoder()
    private let cache = URLCache(
        memoryCapacity: 50_000_000,  // 50MB memory
        diskCapacity: 200_000_000    // 200MB disk
    )

    private init() {
        let config = URLSessionConfiguration.default
        config.urlCache = cache
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
    }

    // MARK: - Features (airports, navaids, etc.)

    struct FeaturesResponse: Codable {
        var airports: [Airport]?
        var navaids: [Navaid]?
        var waypoints: [Waypoint]?
        var obstacles: [Obstacle]?
        var ils: [Airport]? // reuse airport struct for now
    }

    func fetchFeatures(layers: [String], zoom: Int, bounds: MapBounds) async throws -> FeaturesResponse {
        let layersStr = layers.joined(separator: ",")
        let boundsStr = "\(bounds.latMin),\(bounds.lngMin),\(bounds.latMax),\(bounds.lngMax)"
        let url = URL(string: "\(baseURL)/api/features?layers=\(layersStr)&zoom=\(zoom)&bounds=\(boundsStr)")!
        return try await fetch(url)
    }

    // MARK: - Search

    func searchAirports(query: String) async throws -> [Airport] {
        guard query.count >= 2 else { return [] }
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let url = URL(string: "\(baseURL)/api/search?q=\(encoded)")!
        return try await fetch(url)
    }

    // MARK: - Airport Info

    func fetchAirportInfo(ident: String) async throws -> AirportInfo {
        let url = URL(string: "\(baseURL)/api/plates/info/\(ident)")!
        return try await fetch(url)
    }

    // MARK: - Plates

    func fetchPlates(ident: String) async throws -> [PlateGroup] {
        let url = URL(string: "\(baseURL)/api/plates/\(ident)")!
        return try await fetch(url)
    }

    func platePDFURL(ident: String, pdf: String) -> URL {
        URL(string: "\(baseURL)/api/plates/\(ident)/\(pdf)")!
    }

    // MARK: - Airspace GeoJSON

    func fetchAirspaceGeoJSON(filename: String) async throws -> GeoJSONFeatureCollection {
        let url = URL(string: "\(baseURL)/data/\(filename)")!

        // Try cache first for large static files
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad

        let (data, _) = try await session.data(for: request)
        return try decoder.decode(GeoJSONFeatureCollection.self, from: data)
    }

    // MARK: - Generic Fetch

    private func fetch<T: Decodable>(_ url: URL) async throws -> T {
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.badResponse
        }
        return try decoder.decode(T.self, from: data)
    }
}

struct MapBounds {
    let latMin: Double
    let lngMin: Double
    let latMax: Double
    let lngMax: Double
}

enum APIError: Error {
    case badResponse
    case offline
}
