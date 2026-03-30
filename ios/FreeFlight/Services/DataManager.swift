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

    // Visible data
    var visibleAirspace: [AirspaceFeature] = []
    var airspaceLabels: [AirspaceLabel] = []
    var visibleAirports: [Airport] = []
    var visibleNavaids: [Navaid] = []
    var visibleObstacles: [Obstacle] = []
    var visibleWaypoints: [Waypoint] = []

    // All airspace (loaded once from GeoJSON)
    private var allAirspace: [AirspaceFeature] = []
    private var airspaceLoaded = false

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
        _ = await (airspace, airports)
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

        // Debounce API calls
        updateTask?.cancel()
        updateTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await fetchFeatureLayers(region: region, zoom: zoom)
        }
    }

    private func filterAirspaceForZoom(zoom: Int, region: MKCoordinateRegion? = nil) {
        visibleAirspace = allAirspace.filter { feature in
            switch feature.airspaceClass {
            case "B": return true
            case "C": return zoom >= 6
            case "D": return zoom >= 7
            default: return zoom >= 7
            }
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
