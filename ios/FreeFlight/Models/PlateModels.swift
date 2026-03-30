import Foundation

struct PlateGroup: Codable, Identifiable {
    var id: String { code }
    let code: String
    let label: String
    let plates: [Plate]
}

struct Plate: Codable, Identifiable, Hashable {
    var id: String { pdf }
    let name: String
    let pdf: String
    let georef: Bool?

    var isGeoreferenced: Bool { georef ?? false }
}

struct PlateGeoref: Codable {
    let pdf_name: String
    let nw_lat: Double
    let nw_lon: Double
    let ne_lat: Double
    let ne_lon: Double
    let sw_lat: Double
    let sw_lon: Double
    let se_lat: Double
    let se_lon: Double
}

struct AirportFrequency: Codable, Identifiable {
    var id: String { "\(service_type ?? "")-\(freq_tx ?? 0)" }
    let service_type: String?
    let freq_tx: Double?
    let freq_rx: Double?
    let remarks: String?

    var displayFreq: String {
        guard let f = freq_tx, f > 0 else { return "-" }
        return String(format: "%.3f", f)
    }
}

struct AirportRunway: Codable, Identifiable {
    var id: String { designator ?? UUID().uuidString }
    let designator: String?
    let length_ft: Int?
    let width_ft: Int?
    let surface: String?
    let lighting: String?

    var surfaceLabel: String {
        switch surface {
        case "ASPH": return "Asphalt"
        case "CONC": return "Concrete"
        case "TURF": return "Turf"
        case "GRVL": return "Gravel"
        case "DIRT": return "Dirt"
        case "WATE": return "Water"
        default: return surface ?? "Unknown"
        }
    }
}

struct AirportInfo: Codable {
    let frequencies: [AirportFrequency]
    let runways: [AirportRunway]
}
