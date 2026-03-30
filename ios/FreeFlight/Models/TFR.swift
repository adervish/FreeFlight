import Foundation
import MapKit
import SwiftUI

struct TFRFeature: Identifiable {
    let id: String // notam_key + polygon index
    let notamKey: String
    let title: String
    let state: String
    let legal: String
    let dateEffective: Date?
    let dateExpiry: Date?
    let notamText: String?
    let coordinates: [CLLocationCoordinate2D]

    /// Active within the next 4 hours = red, otherwise orange.
    /// If dates are unknown, assume active (red).
    var isActiveSoon: Bool {
        let now = Date()
        let fourHours = now.addingTimeInterval(4 * 3600)

        guard let effective = dateEffective, let expiry = dateExpiry else {
            return true // unknown dates → treat as active
        }

        // Active if: effective <= 4h from now AND expiry > now
        return effective <= fourHours && expiry > now
    }

    var fillColor: Color { isActiveSoon ? .red : .orange }
    var fillOpacity: Double { 0.12 }
    var strokeColor: Color { isActiveSoon ? .red : .orange }
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
    private static let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

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
            let dateEffective = parseDate(properties["date_effective"])
            let dateExpiry = parseDate(properties["date_expiry"])
            let notamText = properties["notam_text"] as? String

            let rings = extractRings(type: geomType, coordinates: coordinates)
            for (i, ring) in rings.enumerated() {
                if ring.count >= 3 {
                    result.append(TFRFeature(
                        id: "\(notamKey)-\(i)",
                        notamKey: notamKey,
                        title: title,
                        state: state,
                        legal: legal,
                        dateEffective: dateEffective,
                        dateExpiry: dateExpiry,
                        notamText: notamText,
                        coordinates: ring
                    ))
                }
            }
        }

        return result
    }

    private static func parseDate(_ value: Any?) -> Date? {
        guard let str = value as? String, !str.isEmpty else { return nil }
        return iso8601.date(from: str)
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
