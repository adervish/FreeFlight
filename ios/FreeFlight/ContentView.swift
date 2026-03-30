import SwiftUI
import MapKit

struct ContentView: View {
    @Environment(DataManager.self) private var dataManager
    @Bindable private var bindableDataManager = DataManager.shared
    @State private var selectedAirport: Airport?
    @State private var selectedNavaid: Navaid?
    @State private var selectedObstacle: Obstacle?
    @State private var selectedWaypoint: Waypoint?
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
    @State private var locationManager = LocationManager.shared
    @State private var currentZoom: Int = 5

    var body: some View {
        ZStack {
            mapView
            VStack {
                overlayControls
                Spacer()
                HStack {
                    Text("Z\(currentZoom)")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.ultraThinMaterial)
                        .clipShape(Capsule())
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.bottom, locationManager.isTracking ? 0 : 34)

                if locationManager.isTracking {
                    GPSInstrumentStrip(locationManager: locationManager)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 34)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .animation(.easeInOut(duration: 0.3), value: locationManager.isTracking)
        .sheet(item: $selectedAirport) { airport in
            AirportDetailView(airport: airport)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .sheet(item: $selectedNavaid) { navaid in
            NavaidDetailView(navaid: navaid)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .sheet(item: $selectedObstacle) { obstacle in
            ObstacleDetailView(obstacle: obstacle)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .sheet(item: $selectedWaypoint) { waypoint in
            WaypointDetailView(waypoint: waypoint)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .onAppear {
            dataManager.loadInitialData()
        }
    }

    // MARK: - Map

    private var mapView: some View {
        Map(position: $mapPosition) {
            // TFR overlays
            ForEach(dataManager.visibleTFRs) { tfr in
                MapPolygon(coordinates: tfr.coordinates)
                    .foregroundStyle(tfr.fillColor.opacity(tfr.fillOpacity))
                    .stroke(tfr.strokeColor, lineWidth: tfr.strokeWidth)
            }

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

            // Airspace labels
            ForEach(dataManager.airspaceLabels) { label in
                Annotation("", coordinate: label.coordinate) {
                    AirspaceBorderLabel(label: label)
                }
                .annotationTitles(.hidden)
            }

            // Navaid markers
            ForEach(dataManager.visibleNavaids) { navaid in
                Annotation(navaid.ident, coordinate: navaid.coordinate) {
                    NavaidMarkerView(navaid: navaid)
                        .onTapGesture { selectedNavaid = navaid }
                }
                .annotationTitles(.hidden)
            }

            // Obstacle markers
            ForEach(dataManager.visibleObstacles) { obstacle in
                Annotation("", coordinate: obstacle.coordinate) {
                    ObstacleMarkerView(obstacle: obstacle)
                        .onTapGesture { selectedObstacle = obstacle }
                }
                .annotationTitles(.hidden)
            }

            // Waypoint markers
            ForEach(dataManager.visibleWaypoints) { waypoint in
                Annotation(waypoint.ident, coordinate: waypoint.coordinate) {
                    WaypointMarkerView(waypoint: waypoint)
                        .onTapGesture { selectedWaypoint = waypoint }
                }
                .annotationTitles(.hidden)
            }

            // User location
            if locationManager.isTracking {
                UserAnnotation()
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
            let zoom = zoomLevel(from: context.region)
            currentZoom = zoom
            dataManager.updateVisibleFeatures(
                region: context.region,
                zoom: zoom
            )
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
                    LayerToggle(label: "TFRs", icon: "exclamationmark.shield", isOn: $bindableDataManager.showTFRs)
                    LayerToggle(label: "Airspace", icon: "circle.hexagongrid", isOn: $bindableDataManager.showAirspace)
                    LayerToggle(label: "Airports", icon: "airplane", isOn: $bindableDataManager.showAirports)
                    LayerToggle(label: "Navaids", icon: "antenna.radiowaves.left.and.right", isOn: $bindableDataManager.showNavaids)
                    LayerToggle(label: "Obstacles", icon: "exclamationmark.triangle", isOn: $bindableDataManager.showObstacles)
                    LayerToggle(label: "Waypoints", icon: "mappin", isOn: $bindableDataManager.showWaypoints)

                    Divider().frame(height: 28)

                    GPSToggleButton(isTracking: $locationManager.isTracking) {
                        if locationManager.isTracking {
                            locationManager.stopTracking()
                        } else {
                            locationManager.startTracking()
                        }
                    }

                    MapStylePicker(selection: $mapStyle)
                }
                .padding(.horizontal)
            }
        }
    }

    /// Convert MapKit region span to equivalent Google Maps zoom level.
    /// Google Maps: zoom N shows 360/2^N degrees of longitude.
    /// MapKit span is the full visible width in degrees.
    private func zoomLevel(from region: MKCoordinateRegion) -> Int {
        // Use the smaller of lat/lng span to account for aspect ratio
        let span = min(region.span.latitudeDelta, region.span.longitudeDelta)
        // zoom = log2(360 / span) but MapKit span ≈ full viewport width
        // Fine-tuned to match web behavior:
        //   span ~40° = zoom 3-4 (continental)
        //   span ~10° = zoom 5-6 (regional)
        //   span ~2°  = zoom 7-8 (state)
        //   span ~0.5° = zoom 9-10 (metro)
        //   span ~0.1° = zoom 11-12 (city)
        //   span ~0.02° = zoom 13-14 (neighborhood)
        let zoom = log2(360.0 / max(span, 0.0001))
        return min(max(Int(zoom), 1), 20)
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
