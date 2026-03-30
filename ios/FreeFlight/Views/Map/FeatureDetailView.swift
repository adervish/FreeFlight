import SwiftUI

struct NavaidDetailView: View {
    let navaid: Navaid

    var body: some View {
        NavigationStack {
            List {
                Section("Navaid") {
                    row("Identifier", navaid.ident)
                    if let name = navaid.name {
                        row("Name", name)
                    }
                    if let cls = navaid.class {
                        row("Class", cls.trimmingCharacters(in: .whitespaces))
                    }
                }
                Section("Location") {
                    row("Latitude", String(format: "%.6f°", navaid.latitude))
                    row("Longitude", String(format: "%.6f°", navaid.longitude))
                }
            }
            .navigationTitle(navaid.ident)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct ObstacleDetailView: View {
    let obstacle: Obstacle

    var body: some View {
        NavigationStack {
            List {
                Section("Obstacle") {
                    if let oas = obstacle.oas_number {
                        row("OAS Number", oas)
                    }
                    if let type = obstacle.type_code {
                        row("Type", type.trimmingCharacters(in: .whitespaces))
                    }
                    if let agl = obstacle.agl {
                        row("Height AGL", "\(Int(agl)) ft")
                    }
                    if let amsl = obstacle.amsl {
                        row("Elevation MSL", "\(Int(amsl)) ft")
                    }
                    if let lighting = obstacle.lighting {
                        row("Lighting", lightingDescription(lighting))
                    }
                }
                Section("Location") {
                    row("Latitude", String(format: "%.6f°", obstacle.latitude))
                    row("Longitude", String(format: "%.6f°", obstacle.longitude))
                }
            }
            .navigationTitle("Obstacle")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func lightingDescription(_ code: String) -> String {
        switch code.trimmingCharacters(in: .whitespaces) {
        case "R": return "Red"
        case "D": return "Dual (Red & White)"
        case "H": return "High Intensity White"
        case "M": return "Medium Intensity White"
        case "S": return "Synchronized Red"
        case "F": return "Flood"
        case "C": return "Catenary"
        case "N": return "None"
        default: return code
        }
    }
}

struct WaypointDetailView: View {
    let waypoint: Waypoint

    var body: some View {
        NavigationStack {
            List {
                Section("Waypoint") {
                    row("Identifier", waypoint.ident)
                    if let type = waypoint.type_code {
                        row("Type", type.trimmingCharacters(in: .whitespaces))
                    }
                }
                Section("Location") {
                    row("Latitude", String(format: "%.6f°", waypoint.latitude))
                    row("Longitude", String(format: "%.6f°", waypoint.longitude))
                }
            }
            .navigationTitle(waypoint.ident)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: - Shared row helper

private func row(_ label: String, _ value: String) -> some View {
    HStack {
        Text(label)
            .foregroundStyle(.secondary)
        Spacer()
        Text(value)
    }
}
