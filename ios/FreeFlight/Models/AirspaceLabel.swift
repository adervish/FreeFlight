import Foundation
import MapKit

struct AirspaceLabel: Identifiable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
    let text: String
    let angle: Double // degrees, for rotation
    let color: String // airspace class for coloring
    let isCenter: Bool // center label vs border label
}

enum AirspaceLabelComputer {

    // Compute labels for a set of airspace features visible in a region at a given zoom
    static func computeLabels(
        features: [AirspaceFeature],
        region: MKCoordinateRegion,
        zoom: Int
    ) -> [AirspaceLabel] {
        guard zoom >= 6 else { return [] }

        let showBorder = zoom >= 8
        var labels: [AirspaceLabel] = []
        var centersSeen = Set<String>()

        for feature in features {
            let cls = feature.airspaceClass
            guard cls == "B" || cls == "C" || cls == "D" else { continue }
            guard feature.coordinates.count >= 3 else { continue }

            // Center label — only for surface ring (lower = SFC/0), one per name
            let lowerNum = Int(feature.lowerAlt) ?? 0
            if lowerNum == 0 {
                let key = "\(feature.name)|\(cls)"
                if !centersSeen.contains(key) {
                    centersSeen.insert(key)
                    let center = centroid(of: feature.coordinates)
                    if regionContains(region, center) {
                        var name = feature.name
                            .replacingOccurrences(of: "CLASS B", with: "")
                            .replacingOccurrences(of: "CLASS C", with: "")
                            .replacingOccurrences(of: "CLASS D", with: "")
                            .trimmingCharacters(in: .whitespaces)
                        if name.count > 20 { name = String(name.prefix(18)) + "…" }
                        labels.append(AirspaceLabel(
                            coordinate: center,
                            text: "Class \(cls)\n\(name)",
                            angle: 0,
                            color: cls,
                            isCenter: true
                        ))
                    }
                }
            }

            // Border labels
            if showBorder {
                let borderLabels = pickBorderLabels(
                    ring: feature.coordinates,
                    region: region,
                    airspaceClass: cls,
                    lower: feature.lowerAlt,
                    upper: feature.upperAlt
                )
                labels.append(contentsOf: borderLabels)
            }
        }

        return labels
    }

    // MARK: - Border Label Algorithm

    private static func pickBorderLabels(
        ring: [CLLocationCoordinate2D],
        region: MKCoordinateRegion,
        airspaceClass: String,
        lower: String,
        upper: String
    ) -> [AirspaceLabel] {
        guard ring.count >= 3 else { return [] }

        let center = centroid(of: ring)
        let lowerFmt = formatAlt(lower)
        let upperFmt = formatAlt(upper)
        let text = "\(airspaceClass): \(lowerFmt) - \(upperFmt)"

        struct Candidate {
            let coord: CLLocationCoordinate2D
            let angle: Double
            let segLen: Double
        }

        var candidates: [Candidate] = []

        for i in 0..<(ring.count - 1) {
            let p1 = ring[i]
            let p2 = ring[i + 1]

            let midLat = (p1.latitude + p2.latitude) / 2
            let midLng = (p1.longitude + p2.longitude) / 2

            // Must be in viewport
            guard regionContains(region, CLLocationCoordinate2D(latitude: midLat, longitude: midLng)) else { continue }

            let dx = p2.longitude - p1.longitude
            let dy = p2.latitude - p1.latitude
            let len = sqrt(dx * dx + dy * dy)
            guard len > 0 else { continue }

            // Segment length as proxy for screen size
            let segLen = len

            // Tangent angle in screen space (lat up = CSS y down)
            let tangentDeg = atan2(-dy, dx) * 180 / .pi

            // Determine which side of the edge the centroid is on
            let nx1 = -dy / len
            let ny1 = dx / len
            let dot = nx1 * (center.latitude - midLat) + ny1 * (center.longitude - midLng)

            // Rotate so text rises into the interior
            var angle = tangentDeg
            if dot < 0 { angle += 180 }

            candidates.append(Candidate(
                coord: CLLocationCoordinate2D(latitude: midLat, longitude: midLng),
                angle: angle,
                segLen: segLen
            ))
        }

        guard !candidates.isEmpty else { return [] }

        // Sort by segment length, pick longest
        let sorted = candidates.sorted { $0.segLen > $1.segLen }
        var picked = [sorted[0]]

        // Pick a second from the opposite side
        if sorted.count > 4 {
            let best = sorted[0]
            var maxDist = 0.0
            var furthest: Candidate?
            for c in sorted.dropFirst() {
                let d = pow(c.coord.latitude - best.coord.latitude, 2) + pow(c.coord.longitude - best.coord.longitude, 2)
                if d > maxDist { maxDist = d; furthest = c }
            }
            if let furthest { picked.append(furthest) }
        }

        return picked.map { c in
            AirspaceLabel(
                coordinate: c.coord,
                text: text,
                angle: c.angle,
                color: airspaceClass,
                isCenter: false
            )
        }
    }

    // MARK: - Helpers

    private static func centroid(of coords: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        var latSum = 0.0, lngSum = 0.0
        for c in coords { latSum += c.latitude; lngSum += c.longitude }
        let n = Double(coords.count)
        return CLLocationCoordinate2D(latitude: latSum / n, longitude: lngSum / n)
    }

    private static func regionContains(_ region: MKCoordinateRegion, _ coord: CLLocationCoordinate2D) -> Bool {
        let latMin = region.center.latitude - region.span.latitudeDelta / 2
        let latMax = region.center.latitude + region.span.latitudeDelta / 2
        let lngMin = region.center.longitude - region.span.longitudeDelta / 2
        let lngMax = region.center.longitude + region.span.longitudeDelta / 2
        return coord.latitude >= latMin && coord.latitude <= latMax &&
               coord.longitude >= lngMin && coord.longitude <= lngMax
    }

    private static func formatAlt(_ val: String) -> String {
        guard let n = Int(val) else { return val.isEmpty ? "SFC" : val }
        if n <= 0 { return "SFC" }
        if n == -9998 { return "FL180" }
        if n >= 18000 { return "FL\(n / 100)" }
        return "\(n.formatted())'"
    }
}
