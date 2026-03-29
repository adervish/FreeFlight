import SwiftUI

struct AirportDetailView: View {
    let airport: Airport
    @State private var selectedTab = 0
    @State private var info: AirportInfo?
    @State private var plates: [PlateGroup] = []
    @State private var selectedPlate: Plate?
    @State private var isLoading = true

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Header
                airportHeader

                // Tab picker
                Picker("", selection: $selectedTab) {
                    Text("Info").tag(0)
                    Text("Freq").tag(1)
                    Text("Runways").tag(2)
                    Text("Plates").tag(3)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                // Tab content
                Group {
                    switch selectedTab {
                    case 0: infoTab
                    case 1: frequencyTab
                    case 2: runwayTab
                    case 3: platesTab
                    default: EmptyView()
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(airport.displayIdent)
                        .font(.headline)
                }
            }
            .sheet(item: $selectedPlate) { plate in
                PlateViewerView(ident: airport.ident, plate: plate)
            }
            .task { await loadData() }
        }
    }

    // MARK: - Header

    private var airportHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(airport.displayName)
                .font(.title2.bold())
            HStack(spacing: 12) {
                Label(airport.typeLabel, systemImage: airport.isHeliport ? "h.circle" : "airplane")
                if let elev = airport.elevation {
                    Label("\(Int(elev))' MSL", systemImage: "arrow.up")
                }
                if airport.hasIAP {
                    Label("IAP", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let city = airport.city, let state = airport.state {
                Text("\(city), \(state)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .padding(.top, 8)
    }

    // MARK: - Info Tab

    private var infoTab: some View {
        List {
            infoRow("Identifier", airport.ident)
            infoRow("ICAO", airport.icao_id ?? "-")
            infoRow("Type", airport.typeLabel)
            infoRow("Use", airport.isPrivate ? "Private" : "Public")
            if airport.isMilitary {
                infoRow("Military", airport.mil_code == "ALL" ? "Joint Use" : "Military")
            }
            infoRow("Approaches", airport.hasIAP ? "Yes" : "No")
            if let elev = airport.elevation {
                infoRow("Elevation", "\(Int(elev))' MSL")
            }
            infoRow("Latitude", String(format: "%.4f", airport.latitude))
            infoRow("Longitude", String(format: "%.4f", airport.longitude))
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Frequency Tab

    private var frequencyTab: some View {
        Group {
            if let info, !info.frequencies.isEmpty {
                List(info.frequencies) { freq in
                    HStack {
                        Text(freq.service_type ?? "")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 80, alignment: .leading)
                        Spacer()
                        Text(freq.displayFreq)
                            .font(.system(.body, design: .monospaced, weight: .semibold))
                    }
                }
                .listStyle(.insetGrouped)
            } else if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("No Frequencies", systemImage: "antenna.radiowaves.left.and.right")
            }
        }
    }

    // MARK: - Runway Tab

    private var runwayTab: some View {
        Group {
            if let info, !info.runways.isEmpty {
                List(info.runways) { rwy in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(rwy.designator ?? "")
                            .font(.headline)
                        HStack(spacing: 16) {
                            if let len = rwy.length_ft {
                                Label("\(len.formatted())'", systemImage: "ruler")
                            }
                            if let wid = rwy.width_ft {
                                Label("\(wid)'", systemImage: "arrow.left.and.right")
                            }
                            Text(rwy.surfaceLabel)
                                .foregroundStyle(.secondary)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
                .listStyle(.insetGrouped)
            } else if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("No Runway Data", systemImage: "road.lanes")
            }
        }
    }

    // MARK: - Plates Tab

    private var platesTab: some View {
        Group {
            if !plates.isEmpty {
                List {
                    ForEach(plates) { group in
                        Section(group.label) {
                            ForEach(group.plates) { plate in
                                Button {
                                    selectedPlate = plate
                                } label: {
                                    HStack {
                                        Text(plate.name)
                                            .foregroundStyle(.primary)
                                        Spacer()
                                        Image(systemName: "doc.fill")
                                            .foregroundStyle(.blue)
                                            .font(.caption)
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            } else if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("No Approach Plates", systemImage: "doc.text")
            }
        }
    }

    // MARK: - Helpers

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
    }

    private func loadData() async {
        async let infoResult = api.fetchAirportInfo(ident: airport.ident)
        async let platesResult = api.fetchPlates(ident: airport.ident)

        do {
            info = try await infoResult
        } catch {
            print("Info load error: \(error)")
        }
        do {
            plates = try await platesResult
        } catch {
            print("Plates load error: \(error)")
        }
        isLoading = false
    }
}
