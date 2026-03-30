import SwiftUI

struct AirportMarkerView: View {
    let airport: Airport

    var body: some View {
        VStack(spacing: 1) {
            markerIcon
            Text(airport.displayIdent)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(airport.markerColor)
        }
    }

    @ViewBuilder
    private var markerIcon: some View {
        if airport.isHeliport {
            // H shape
            Text("H")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(airport.markerColor)
                .frame(width: 16, height: 16)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(airport.markerColor, lineWidth: 1.5)
                )
        } else if airport.isSeaplane {
            Image(systemName: "water.waves")
                .font(.system(size: 10))
                .foregroundStyle(airport.markerColor)
        } else if airport.hasIAP || airport.isMilitary {
            // Major airport: circle with tick marks
            ZStack {
                Circle()
                    .fill(airport.markerColor.opacity(0.2))
                    .frame(width: 14, height: 14)
                Circle()
                    .stroke(airport.markerColor, lineWidth: 1.5)
                    .frame(width: 14, height: 14)
                // Tick marks
                ForEach([0, 90, 180, 270], id: \.self) { angle in
                    Rectangle()
                        .fill(airport.markerColor)
                        .frame(width: 1.5, height: 4)
                        .offset(y: -9)
                        .rotationEffect(.degrees(Double(angle)))
                }
            }
            .frame(width: 22, height: 22)
        } else {
            // Small airport: simple circle
            Circle()
                .fill(airport.isPrivate ? Color.clear : airport.markerColor.opacity(0.2))
                .frame(width: airport.isPrivate ? 8 : 10, height: airport.isPrivate ? 8 : 10)
                .overlay(
                    Circle()
                        .stroke(airport.markerColor, lineWidth: 1.5)
                )
        }
    }
}

struct NavaidMarkerView: View {
    let navaid: Navaid

    var body: some View {
        VStack(spacing: 1) {
            Image(systemName: "diamond.fill")
                .font(.system(size: 8))
                .foregroundStyle(.cyan)
            Text(navaid.ident)
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(.cyan.opacity(0.8))
        }
    }
}

struct ObstacleMarkerView: View {
    let obstacle: Obstacle

    var body: some View {
        VStack(spacing: 1) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 8))
                .foregroundStyle(.orange)
            if let agl = obstacle.agl {
                Text("\(Int(agl))'")
                    .font(.system(size: 7, weight: .medium))
                    .foregroundStyle(.orange.opacity(0.8))
            }
        }
    }
}

struct WaypointMarkerView: View {
    let waypoint: Waypoint

    var body: some View {
        VStack(spacing: 1) {
            Image(systemName: "triangle.fill")
                .font(.system(size: 6))
                .foregroundStyle(.green)
            Text(waypoint.ident)
                .font(.system(size: 7, weight: .medium))
                .foregroundStyle(.green.opacity(0.8))
        }
    }
}
