import Foundation
import MapKit
import SwiftUI

struct Airport: Identifiable, Codable, Hashable {
    var id: String { ident }
    let ident: String
    let name: String?
    let icao_id: String?
    let latitude: Double
    let longitude: Double
    let elevation: Double?
    let type_code: String?
    let city: String?
    let state: String?
    let country: String?
    let mil_code: String?
    let iap_exists: Int?
    let private_use: Int?
    let tier: Int?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var displayIdent: String {
        icao_id ?? ident
    }

    var displayName: String {
        name ?? ident
    }

    var hasIAP: Bool { iap_exists == 1 }
    var isPrivate: Bool { private_use == 1 }
    var isMilitary: Bool { mil_code == "MIL" || mil_code == "ALL" }
    var isHeliport: Bool { type_code == "HP" }
    var isSeaplane: Bool { type_code == "SP" }

    var typeLabel: String {
        switch type_code {
        case "AD": return "Airport"
        case "HP": return "Heliport"
        case "SP": return "Seaplane Base"
        case "UL": return "Ultralight"
        case "GL": return "Gliderport"
        case "BP": return "Balloon Port"
        default: return type_code ?? "Unknown"
        }
    }

    var markerColor: Color {
        if isMilitary { return .gray }
        if hasIAP { return .blue }
        if isPrivate { return Color(.systemGray) }
        return Color(.systemPink)
    }
}

struct Navaid: Identifiable, Codable {
    var id: String { "\(ident)-\(latitude)-\(longitude)" }
    let ident: String
    let name: String?
    let `class`: String?
    let latitude: Double
    let longitude: Double
    let tier: Int?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct Waypoint: Identifiable, Codable {
    var id: String { "\(ident)-\(latitude)-\(longitude)" }
    let ident: String
    let latitude: Double
    let longitude: Double
    let type_code: String?
    let tier: Int?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct Obstacle: Identifiable, Codable {
    var id: String { "\(oas_number ?? "obs")-\(latitude)-\(longitude)" }
    let oas_number: String?
    let latitude: Double
    let longitude: Double
    let type_code: String?
    let agl: Double?
    let amsl: Double?
    let lighting: String?
    let tier: Int?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
