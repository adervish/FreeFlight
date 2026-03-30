import Foundation
import MapKit

/// Downloads all waypoints once, caches locally, rechecks daily.
actor LocalWaypointStore {
    static let shared = LocalWaypointStore()

    private var waypoints: [Waypoint] = []
    private var loaded = false
    private let fileCache = FileCache.shared
    private let api = APIClient.shared

    func loadAll() async {
        guard !loaded else { return }

        let baseURL = await api.baseURL
        let url = "\(baseURL)/api/features/all-waypoints"

        if let data = await fileCache.getData(for: url) {
            do {
                waypoints = try JSONDecoder().decode([Waypoint].self, from: data)
                loaded = true
                print("LocalWaypointStore: \(waypoints.count) waypoints loaded")
            } catch {
                print("LocalWaypointStore: decode error: \(error)")
            }
        }
    }

    /// Get waypoints visible in a region.
    /// - zoom < 8: hidden
    /// - zoom 8+: all waypoints in viewport (131K total, bbox filtered)
    func waypointsIn(region: MKCoordinateRegion, zoom: Int) -> [Waypoint] {
        guard zoom >= 8 else { return [] }

        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2

        let result = waypoints.filter { wp in
            wp.latitude >= latMin && wp.latitude <= latMax &&
            wp.longitude >= lngMin && wp.longitude <= lngMax
        }

        // Cap at 1000 to avoid choking the map
        if result.count > 1000 {
            return Array(result.prefix(1000))
        }
        return result
    }
}
