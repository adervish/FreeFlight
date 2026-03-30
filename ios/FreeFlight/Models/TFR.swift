import Foundation
import MapKit
import SwiftUI

struct TFRFeature: Identifiable {
    let id: String // notam_key + polygon index
    let notamKey: String
    let title: String
    let state: String
    let legal: String
    let coordinates: [CLLocationCoordinate2D]

    var fillColor: Color { .red }
    var fillOpacity: Double { 0.12 }
    var strokeColor: Color { .red }
    var strokeWidth: CGFloat { 1.5 }

    var displayTitle: String {
        if !legal.isEmpty {
            return "\(legal): \(title)"
        }
        return title
    }
}

// MARK: - GeoJSON Parsing

enum TFRParser {
    static func parse(data: Data) -> [TFRFeature] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else {
            return []
        }

        var result: [TFRFeature] = []

        for feature in features {
            guard let properties = feature["properties"] as? [String: Any],
                  let geometry = feature["geometry"] as? [String: Any],
                  let geomType = geometry["type"] as? String,
                  let coordinates = geometry["coordinates"] else {
                continue
            }

            let notamKey = properties["notam_key"] as? String ?? ""
            let title = properties["title"] as? String ?? ""
            let state = properties["state"] as? String ?? ""
            let legal = properties["legal"] as? String ?? ""

            let rings = extractRings(type: geomType, coordinates: coordinates)
            for (i, ring) in rings.enumerated() {
                if ring.count >= 3 {
                    result.append(TFRFeature(
                        id: "\(notamKey)-\(i)",
                        notamKey: notamKey,
                        title: title,
                        state: state,
                        legal: legal,
                        coordinates: ring
                    ))
                }
            }
        }

        return result
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
