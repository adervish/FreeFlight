import Foundation
import MapKit

/// Downloads all airports once, caches locally, rechecks daily.
/// Filters by viewport on-device — no API calls needed for airport display.
actor LocalAirportStore {
    static let shared = LocalAirportStore()

    private var airports: [Airport] = []
    private var loaded = false
    private let fileCache = FileCache.shared
    private let api = APIClient.shared

    /// Load all airports from cache/remote. Call once on launch.
    func loadAll() async {
        guard !loaded else { return }

        let baseURL = await api.baseURL
        let url = "\(baseURL)/api/features/all-airports"

        if let data = await fileCache.getData(for: url) {
            do {
                airports = try JSONDecoder().decode([Airport].self, from: data)
                loaded = true
                print("LocalAirportStore: \(airports.count) airports loaded")
            } catch {
                print("LocalAirportStore: decode error: \(error)")
            }
        }
    }

    /// Get airports visible in a region, filtered by zoom/tier
    func airportsIn(region: MKCoordinateRegion, zoom: Int) -> [Airport] {
        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2

        // Tier filtering by zoom (matches server-side config)
        let maxTier: Int
        if zoom >= 12 { maxTier = 3 }
        else if zoom >= 9 { maxTier = 2 }
        else { maxTier = 1 }

        return airports.filter { apt in
            apt.latitude >= latMin && apt.latitude <= latMax &&
            apt.longitude >= lngMin && apt.longitude <= lngMax &&
            (apt.tier ?? 3) <= maxTier
        }
    }

    /// Search airports by ident, ICAO, name, or city
    func search(query: String) -> [Airport] {
        guard query.count >= 2 else { return [] }
        let q = query.uppercased()

        return airports
            .filter {
                $0.ident.uppercased().contains(q) ||
                ($0.icao_id?.uppercased().contains(q) ?? false) ||
                ($0.name?.uppercased().contains(q) ?? false) ||
                ($0.city?.uppercased().contains(q) ?? false)
            }
            .sorted { a, b in
                // Exact ident match first
                let aExact = a.ident.uppercased() == q || a.icao_id?.uppercased() == q
                let bExact = b.ident.uppercased() == q || b.icao_id?.uppercased() == q
                if aExact != bExact { return aExact }
                // Then by tier
                return (a.tier ?? 3) < (b.tier ?? 3)
            }
            .prefix(10)
            .map { $0 }
    }
}
