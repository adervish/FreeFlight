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

// MARK: - GeoJSON Parsing (manual for reliability)

enum AirspaceParser {
    static func parse(data: Data) -> [AirspaceFeature] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else {
            return []
        }

        var result: [AirspaceFeature] = []

        for feature in features {
            guard let properties = feature["properties"] as? [String: Any],
                  let geometry = feature["geometry"] as? [String: Any],
                  let geomType = geometry["type"] as? String,
                  let coordinates = geometry["coordinates"] else {
                continue
            }

            let cls = properties["c"] as? String ?? ""
            // Skip Class E and A
            if cls == "E" || cls == "A" { continue }

            let name = properties["n"] as? String ?? properties["t"] as? String ?? ""
            let upper = stringFromAny(properties["u"])
            let lower = stringFromAny(properties["l"])

            let rings = extractRings(type: geomType, coordinates: coordinates)
            for ring in rings {
                if ring.count >= 3 {
                    result.append(AirspaceFeature(
                        name: name,
                        airspaceClass: cls,
                        upperAlt: upper,
                        lowerAlt: lower,
                        coordinates: ring
                    ))
                }
            }
        }

        return result
    }

    private static func stringFromAny(_ value: Any?) -> String {
        guard let value else { return "" }
        if let s = value as? String { return s }
        if let n = value as? Int { return String(n) }
        if let n = value as? Double { return String(Int(n)) }
        return ""
    }

    private static func extractRings(type: String, coordinates: Any) -> [[CLLocationCoordinate2D]] {
        switch type {
        case "Polygon":
            guard let rings = coordinates as? [Any],
                  let outerRing = rings.first else { return [] }
            return [parseRing(outerRing)]

        case "MultiPolygon":
            guard let polys = coordinates as? [Any] else { return [] }
            return polys.compactMap { poly -> [CLLocationCoordinate2D]? in
                guard let rings = poly as? [Any],
                      let outerRing = rings.first else { return nil }
                let ring = parseRing(outerRing)
                return ring.count >= 3 ? ring : nil
            }

        default:
            return []
        }
    }

    private static func parseRing(_ ring: Any) -> [CLLocationCoordinate2D] {
        guard let points = ring as? [Any] else { return [] }
        return points.compactMap { point -> CLLocationCoordinate2D? in
            guard let coord = point as? [NSNumber],
                  coord.count >= 2 else { return nil }
            return CLLocationCoordinate2D(
                latitude: coord[1].doubleValue,
                longitude: coord[0].doubleValue
            )
        }
    }
}
