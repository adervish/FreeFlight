import SwiftUI
import MapKit

struct ContentView: View {
    @Environment(DataManager.self) private var dataManager
    @Bindable private var bindableDataManager = DataManager.shared
    @State private var selectedAirport: Airport?
    @State private var showSearch = false
    @State private var showLayers = false
    @State private var mapPosition = MapCameraPosition.region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 37.6213, longitude: -122.379),
            span: MKCoordinateSpan(latitudeDelta: 40, longitudeDelta: 40)
        )
    )
    @State private var visibleRegion: MKCoordinateRegion?
    @State private var mapStyle: MapStyleOption = .dark

    var body: some View {
        ZStack(alignment: .top) {
            mapView
            overlayControls
        }
        .sheet(item: $selectedAirport) { airport in
            AirportDetailView(airport: airport)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .task {
            await dataManager.loadAirspaceData()
        }
    }

    // MARK: - Map

    private var mapView: some View {
        Map(position: $mapPosition) {
            // Airspace overlays
            ForEach(dataManager.visibleAirspace) { airspace in
                MapPolygon(coordinates: airspace.coordinates)
                    .foregroundStyle(airspace.fillColor.opacity(airspace.fillOpacity))
                    .stroke(airspace.strokeColor, lineWidth: airspace.strokeWidth)
            }

            // Airport markers
            ForEach(dataManager.visibleAirports) { airport in
                Annotation(airport.displayIdent, coordinate: airport.coordinate) {
                    AirportMarkerView(airport: airport)
                        .onTapGesture { selectedAirport = airport }
                }
                .annotationTitles(.hidden)
            }

            // Navaid markers
            ForEach(dataManager.visibleNavaids) { navaid in
                Annotation(navaid.ident, coordinate: navaid.coordinate) {
                    NavaidMarkerView(navaid: navaid)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(mapStyle.style)
        .mapControls {
            MapCompass()
            MapScaleView()
            MapUserLocationButton()
        }
        .onMapCameraChange(frequency: .onEnd) { context in
            visibleRegion = context.region
            Task {
                await dataManager.updateVisibleFeatures(
                    region: context.region,
                    zoom: zoomLevel(from: context.region)
                )
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Overlay Controls

    private var overlayControls: some View {
        VStack(spacing: 8) {
            // Search bar
            SearchBarView(selectedAirport: $selectedAirport, mapPosition: $mapPosition)
                .padding(.horizontal)
                .padding(.top, 8)

            // Layer controls
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    LayerToggle(label: "Airspace", icon: "circle.hexagongrid", isOn: $bindableDataManager.showAirspace)
                    LayerToggle(label: "Airports", icon: "airplane", isOn: $bindableDataManager.showAirports)
                    LayerToggle(label: "Navaids", icon: "antenna.radiowaves.left.and.right", isOn: $bindableDataManager.showNavaids)
                    LayerToggle(label: "Obstacles", icon: "exclamationmark.triangle", isOn: $bindableDataManager.showObstacles)
                    LayerToggle(label: "Waypoints", icon: "mappin", isOn: $bindableDataManager.showWaypoints)

                    Divider().frame(height: 28)

                    MapStylePicker(selection: $mapStyle)
                }
                .padding(.horizontal)
            }
        }
    }

    private func zoomLevel(from region: MKCoordinateRegion) -> Int {
        let zoom = Int(log2(360.0 / max(region.span.longitudeDelta, 0.001)))
        return min(max(zoom, 1), 20)
    }
}

// MARK: - Map Style

enum MapStyleOption: String, CaseIterable {
    case dark = "Dark"
    case satellite = "Satellite"
    case standard = "Standard"

    var style: MapStyle {
        switch self {
        case .dark: return .standard(elevation: .realistic, emphasis: .muted, pointsOfInterest: .excludingAll)
        case .satellite: return .imagery(elevation: .realistic)
        case .standard: return .standard(elevation: .realistic)
        }
    }

    var icon: String {
        switch self {
        case .dark: return "moon.fill"
        case .satellite: return "globe.americas.fill"
        case .standard: return "map.fill"
        }
    }
}
