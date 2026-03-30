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

    // All airspace (loaded once from GeoJSON)
    private var allAirspace: [AirspaceFeature] = []
    private var airspaceLoaded = false

    // All TFRs (cached with hourly refresh)
    private var allTFRs: [TFRFeature] = []
    private var tfrsLoaded = false

    // Debounce
    private var updateTask: Task<Void, Never>?
    private var lastRegion: MKCoordinateRegion?

    private let api = APIClient.shared
    private let fileCache = FileCache.shared
    private let airportStore = LocalAirportStore.shared

    // MARK: - Airspace Loading

    func loadInitialData() async {
        async let airspace: () = loadAirspaceData()
        async let airports: () = airportStore.loadAll()
        async let tfrs: () = loadTFRData()
        _ = await (airspace, airports, tfrs)
    }

    private func loadAirspaceData() async {
        guard !airspaceLoaded else { return }
        airspaceLoaded = true

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
        filterAirspaceForZoom(zoom: 5)
    }

    private func loadTFRData() async {
        guard !tfrsLoaded else { return }
        tfrsLoaded = true

        let url = "\(await api.baseURL)/api/tfrs"
        guard let data = await fileCache.getData(for: url, maxAge: 3600) else {
            print("Failed to load TFRs")
            return
        }
        allTFRs = TFRParser.parse(data: data)
        print("Loaded \(allTFRs.count) TFR polygons")
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

    // MARK: - Feature Updates

    func updateVisibleFeatures(region: MKCoordinateRegion, zoom: Int) async {
        lastRegion = region

        // Filter airspace by zoom
        if showAirspace {
            filterAirspaceForZoom(zoom: zoom, region: region)
        } else {
            visibleAirspace = []
            airspaceLabels = []
        }

        // Filter TFRs by viewport (visible at all zoom levels)
        if showTFRs {
            filterTFRsForRegion(region)
        } else {
            visibleTFRs = []
        }

        // Debounce API calls
        updateTask?.cancel()
        updateTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await fetchFeatureLayers(region: region, zoom: zoom)
        }
    }

    private func filterAirspaceForZoom(zoom: Int, region: MKCoordinateRegion? = nil) {
        // Filter by class + zoom (same thresholds as web)
        // Also filter by viewport to avoid rendering offscreen polygons
        visibleAirspace = allAirspace.filter { feature in
            let classVisible: Bool
            switch feature.airspaceClass {
            case "B": classVisible = zoom >= 5
            case "C": classVisible = zoom >= 6
            case "D": classVisible = zoom >= 7
            default: classVisible = zoom >= 7
            }
            guard classVisible else { return false }

            // Viewport check using centroid (rough but fast)
            if let region {
                let latMin = region.center.latitude - region.span.latitudeDelta / 2 - 1
                let latMax = region.center.latitude + region.span.latitudeDelta / 2 + 1
                let lngMin = region.center.longitude - region.span.longitudeDelta / 2 - 1
                let lngMax = region.center.longitude + region.span.longitudeDelta / 2 + 1
                // Check if any coordinate is in the viewport
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

    private func fetchFeatureLayers(region: MKCoordinateRegion, zoom: Int) async {
        // Airports: local filtering (no API call)
        if showAirports {
            visibleAirports = await airportStore.airportsIn(region: region, zoom: zoom)
        } else {
            visibleAirports = []
        }

        // Other layers: still use API
        var layers: [String] = []
        if showNavaids { layers.append("navaids") }
        if showObstacles { layers.append("obstacles") }
        if showWaypoints { layers.append("waypoints") }

        if layers.isEmpty {
            visibleNavaids = []
            visibleObstacles = []
            visibleWaypoints = []
            return
        }

        let bounds = MapBounds(
            latMin: region.center.latitude - region.span.latitudeDelta / 2,
            lngMin: region.center.longitude - region.span.longitudeDelta / 2,
            latMax: region.center.latitude + region.span.latitudeDelta / 2,
            lngMax: region.center.longitude + region.span.longitudeDelta / 2
        )

        do {
            let response = try await api.fetchFeatures(layers: layers, zoom: zoom, bounds: bounds)
            if showNavaids { visibleNavaids = response.navaids ?? [] }
            if showObstacles { visibleObstacles = response.obstacles ?? [] }
            if showWaypoints { visibleWaypoints = response.waypoints ?? [] }
        } catch {
            print("Feature fetch error: \(error)")
        }
    }
}
