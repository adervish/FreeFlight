import Foundation
import MapKit
import SwiftUI

struct AirspaceFeature: Identifiable {
    let id = UUID()
    let name: String
    let airspaceClass: String
    let upperAlt: String
    let lowerAlt: String
    let coordinates: [CLLocationCoordinate2D]

    var fillColor: Color {
        switch airspaceClass {
        case "B": return .blue
        case "C": return .purple
        case "D": return .blue
        default: return .gray
        }
    }

    var fillOpacity: Double {
        switch airspaceClass {
        case "B": return 0.10
        case "C": return 0.08
        case "D": return 0.06
        default: return 0.03
        }
    }

    var strokeColor: Color {
        switch airspaceClass {
        case "B": return .blue
        case "C": return .purple
        case "D": return .blue
        default: return .gray
        }
    }

    var strokeWidth: CGFloat {
        switch airspaceClass {
        case "B": return 1.5
        default: return 1.0
        }
    }

    var altitudeLabel: String {
        let lower = formatAlt(lowerAlt)
        let upper = formatAlt(upperAlt)
        return "\(airspaceClass): \(lower) - \(upper)"
    }

    private func formatAlt(_ val: String) -> String {
        guard let n = Int(val) else { return val.isEmpty ? "SFC" : val }
        if n <= 0 { return "SFC" }
        if n == -9998 { return "FL180" }
        if n >= 18000 { return "FL\(n / 100)" }
        return "\(n.formatted())'"
    }
}

// GeoJSON parsing
struct GeoJSONFeatureCollection: Codable {
    let type: String
    let features: [GeoJSONFeature]
}

struct GeoJSONFeature: Codable {
    let type: String
    let properties: GeoJSONProperties
    let geometry: GeoJSONGeometry
}

struct GeoJSONProperties: Codable {
    let n: String?  // name
    let c: String?  // class
    let u: String?  // upper altitude
    let l: String?  // lower altitude
    let t: String?  // type
}

struct GeoJSONGeometry: Codable {
    let type: String
    let coordinates: AnyCodable // Handles nested arrays
}

// Helper for decoding nested coordinate arrays
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let arr = try? container.decode([AnyCodable].self) {
            value = arr.map { $0.value }
        } else if let num = try? container.decode(Double.self) {
            value = num
        } else {
            value = NSNull()
        }
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}

extension GeoJSONFeature {
    func toAirspaceFeatures() -> [AirspaceFeature] {
        let cls = properties.c ?? ""
        // Skip Class E and A
        if cls == "E" || cls == "A" { return [] }

        let name = properties.n ?? properties.t ?? ""
        let upper = properties.u ?? ""
        let lower = properties.l ?? ""

        let rings = extractRings(from: geometry)
        return rings.map { coords in
            AirspaceFeature(
                name: name,
                airspaceClass: cls,
                upperAlt: upper,
                lowerAlt: lower,
                coordinates: coords
            )
        }
    }

    private func extractRings(from geom: GeoJSONGeometry) -> [[CLLocationCoordinate2D]] {
        switch geom.type {
        case "Polygon":
            if let rings = geom.coordinates.value as? [Any],
               let outerRing = rings.first as? [Any] {
                return [parseRing(outerRing)]
            }
        case "MultiPolygon":
            if let polys = geom.coordinates.value as? [Any] {
                return polys.compactMap { poly -> [CLLocationCoordinate2D]? in
                    guard let rings = poly as? [Any],
                          let outerRing = rings.first as? [Any] else { return nil }
                    return parseRing(outerRing)
                }
            }
        default: break
        }
        return []
    }

    private func parseRing(_ ring: [Any]) -> [CLLocationCoordinate2D] {
        ring.compactMap { point -> CLLocationCoordinate2D? in
            guard let coord = point as? [Any],
                  coord.count >= 2,
                  let lng = coord[0] as? Double,
                  let lat = coord[1] as? Double else { return nil }
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
    }
}
