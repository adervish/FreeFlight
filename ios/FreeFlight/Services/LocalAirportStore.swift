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

    /// Get airports visible in a region, filtered by zoom/tier.
    ///
    /// Tier 1 = ICAO airports (major, ~3000)
    /// Tier 2 = public airports without ICAO (~6000)
    /// Tier 3 = private/small (~10000)
    ///
    /// Zoom thresholds (matching web feature-config.ts):
    ///   zoom <= 5:  hidden (too many even for tier 1 at continental scale)
    ///   zoom 6-7:   tier 1 only (ICAO airports)
    ///   zoom 8-10:  tier 1+2 (all public airports)
    ///   zoom 11+:   all tiers (everything including private)
    func airportsIn(region: MKCoordinateRegion, zoom: Int) -> [Airport] {
        guard zoom >= 6 else { return [] }

        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2

        let maxTier: Int
        if zoom >= 11 { maxTier = 3 }
        else if zoom >= 8 { maxTier = 2 }
        else { maxTier = 1 }

        let result = airports.filter { apt in
            apt.latitude >= latMin && apt.latitude <= latMax &&
            apt.longitude >= lngMin && apt.longitude <= lngMax &&
            (apt.tier ?? 3) <= maxTier
        }

        // Cap at 500 to avoid choking the map with annotations
        if result.count > 500 {
            return Array(result.prefix(500))
        }
        return result
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
