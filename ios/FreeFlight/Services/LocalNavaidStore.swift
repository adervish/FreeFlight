import Foundation
import MapKit

/// Downloads all navaids once, caches locally, rechecks daily.
/// Filters by viewport on-device — no API calls needed for navaid display.
actor LocalNavaidStore {
    static let shared = LocalNavaidStore()

    private var navaids: [Navaid] = []
    private var loaded = false
    private let fileCache = FileCache.shared
    private let api = APIClient.shared

    func loadAll() async {
        guard !loaded else { return }

        let baseURL = await api.baseURL
        let url = "\(baseURL)/api/features/all-navaids"

        if let data = await fileCache.getData(for: url) {
            do {
                navaids = try JSONDecoder().decode([Navaid].self, from: data)
                loaded = true
                print("LocalNavaidStore: \(navaids.count) navaids loaded")
            } catch {
                print("LocalNavaidStore: decode error: \(error)")
            }
        }
    }

    /// Navaids visible at zoom 9+, tier-filtered like airports.
    func navaidsIn(region: MKCoordinateRegion, zoom: Int) -> [Navaid] {
        guard zoom >= 9 else { return [] }

        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2

        let maxTier: Int
        if zoom >= 12 { maxTier = 2 }
        else { maxTier = 1 }

        return navaids.filter { nav in
            nav.latitude >= latMin && nav.latitude <= latMax &&
            nav.longitude >= lngMin && nav.longitude <= lngMax &&
            (nav.tier ?? 2) <= maxTier
        }
    }
}
