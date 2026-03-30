import Foundation
import MapKit
import Observation

@Observable
final class DataManager {
    static let shared = DataManager()

    // Layer visibility toggles
    var showAirspace = true
    var showAirports = true
    var showNavaids = false
    var showObstacles = false
    var showWaypoints = false
    var showTFRs = true

    // Visible data
    var visibleAirspace: [AirspaceFeature] = []
    var airspaceLabels: [AirspaceLabel] = []
    var visibleAirports: [Airport] = []
    var visibleNavaids: [Navaid] = []
    var visibleObstacles: [Obstacle] = []
    var visibleWaypoints: [Waypoint] = []
    var visibleTFRs: [TFRFeature] = []

    // All data (loaded once, filtered on-device)
    private var allAirspace: [AirspaceFeature] = []
    private var allNavaids: [Navaid] = []
    private var allTFRs: [TFRFeature] = []

    // Debounce
    private var updateTask: Task<Void, Never>?
    private var lastRegion: MKCoordinateRegion?

    private let api = APIClient.shared
    private let fileCache = FileCache.shared
    private let airportStore = LocalAirportStore.shared
    private let waypointStore = LocalWaypointStore.shared

    // MARK: - Initial Load

    func loadInitialData() {
        Task { await loadAirspaceData() }
        Task { await airportStore.loadAll() }
        Task { await waypointStore.loadAll() }
        Task { await loadNavaidData() }
        Task { await loadTFRData() }
    }

    private func loadAirspaceData() async {
        guard allAirspace.isEmpty else { return }

        let files = ["airspace.json", "boundary-airspace.json", "defense-airspace.json"]
        let baseURL = await api.baseURL

        await withTaskGroup(of: [AirspaceFeature].self) { group in
            for file in files {
                group.addTask {
                    let url = "\(baseURL)/data/\(file)"
                    guard let data = await self.fileCache.getData(for: url) else {
                        print("Failed to load \(file)")
                        return []
                    }
                    let features = AirspaceParser.parse(data: data)
                    print("Loaded \(file): \(features.count) airspace features")
                    return features
                }
            }
            for await features in group {
                allAirspace.append(contentsOf: features)
            }
        }

        print("Total airspace features: \(allAirspace.count)")
    }

    private func loadNavaidData() async {
        guard allNavaids.isEmpty else { return }

        let url = "\(await api.baseURL)/api/features/all-navaids"
        guard let data = await fileCache.getData(for: url) else {
            print("Failed to load navaids")
            return
        }
        do {
            allNavaids = try JSONDecoder().decode([Navaid].self, from: data)
            print("Loaded \(allNavaids.count) navaids")
        } catch {
            print("Navaid decode error: \(error)")
        }
    }

    private func loadTFRData() async {
        guard allTFRs.isEmpty else { return }

        let url = "\(await api.baseURL)/api/tfrs"
        guard let data = await fileCache.getData(for: url, maxAge: 3600) else {
            print("Failed to load TFRs")
            return
        }
        allTFRs = TFRParser.parse(data: data)
        print("Loaded \(allTFRs.count) TFR polygons")
    }

    // MARK: - Feature Updates

    func updateVisibleFeatures(region: MKCoordinateRegion, zoom: Int) {
        lastRegion = region

        // All local filtering — synchronous, no actor hops
        if showAirspace {
            filterAirspaceForZoom(zoom: zoom, region: region)
        } else {
            visibleAirspace = []
            airspaceLabels = []
        }

        if showTFRs {
            filterTFRsForRegion(region)
        } else {
            visibleTFRs = []
        }

        if showNavaids {
            filterNavaidsForRegion(region, zoom: zoom)
        } else {
            visibleNavaids = []
        }

        // Debounce API/actor calls
        updateTask?.cancel()
        updateTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await fetchFeatureLayers(region: region, zoom: zoom)
        }
    }

    // MARK: - Local Filters (synchronous, no actor hops)

    private func filterAirspaceForZoom(zoom: Int, region: MKCoordinateRegion? = nil) {
        visibleAirspace = allAirspace.filter { feature in
            let classVisible: Bool
            switch feature.airspaceClass {
            case "B": classVisible = zoom >= 5
            case "C": classVisible = zoom >= 6
            case "D": classVisible = zoom >= 7
            default: classVisible = zoom >= 7
            }
            guard classVisible else { return false }

            if let region {
                let latMin = region.center.latitude - region.span.latitudeDelta / 2 - 1
                let latMax = region.center.latitude + region.span.latitudeDelta / 2 + 1
                let lngMin = region.center.longitude - region.span.longitudeDelta / 2 - 1
                let lngMax = region.center.longitude + region.span.longitudeDelta / 2 + 1
                let hasVisible = feature.coordinates.contains { c in
                    c.latitude >= latMin && c.latitude <= latMax &&
                    c.longitude >= lngMin && c.longitude <= lngMax
                }
                if !hasVisible { return false }
            }
            return true
        }

        if let region {
            airspaceLabels = AirspaceLabelComputer.computeLabels(
                features: visibleAirspace,
                region: region,
                zoom: zoom
            )
        }
    }

    private func filterTFRsForRegion(_ region: MKCoordinateRegion) {
        let latMin = region.center.latitude - region.span.latitudeDelta / 2 - 1
        let latMax = region.center.latitude + region.span.latitudeDelta / 2 + 1
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2 - 1
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2 + 1

        visibleTFRs = allTFRs.filter { tfr in
            tfr.coordinates.contains { c in
                c.latitude >= latMin && c.latitude <= latMax &&
                c.longitude >= lngMin && c.longitude <= lngMax
            }
        }
    }

    private func filterNavaidsForRegion(_ region: MKCoordinateRegion, zoom: Int) {
        guard zoom >= 9 else { visibleNavaids = []; return }

        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2

        let maxTier = zoom >= 12 ? 2 : 1

        visibleNavaids = allNavaids.filter { nav in
            nav.latitude >= latMin && nav.latitude <= latMax &&
            nav.longitude >= lngMin && nav.longitude <= lngMax &&
            (nav.tier ?? 2) <= maxTier
        }
    }

    // MARK: - Remote Feature Layers (debounced)

    private func fetchFeatureLayers(region: MKCoordinateRegion, zoom: Int) async {
        // Airports: actor-isolated but fast (already loaded)
        if showAirports {
            visibleAirports = await airportStore.airportsIn(region: region, zoom: zoom)
        } else {
            visibleAirports = []
        }

        // Waypoints: local filtering
        if showWaypoints {
            visibleWaypoints = await waypointStore.waypointsIn(region: region, zoom: zoom)
        } else {
            visibleWaypoints = []
        }

        // Obstacles: still fetched from API
        if showObstacles {
            let bounds = MapBounds(
                latMin: region.center.latitude - region.span.latitudeDelta / 2,
                lngMin: region.center.longitude - region.span.longitudeDelta / 2,
                latMax: region.center.latitude + region.span.latitudeDelta / 2,
                lngMax: region.center.longitude + region.span.longitudeDelta / 2
            )
            do {
                let response = try await api.fetchFeatures(layers: ["obstacles"], zoom: zoom, bounds: bounds)
                visibleObstacles = response.obstacles ?? []
            } catch {
                print("Feature fetch error: \(error)")
            }
        } else {
            visibleObstacles = []
        }
    }
}
