import SwiftUI
import CoreLocation

struct GPSInstrumentStrip: View {
    let locationManager: LocationManager

    var body: some View {
        HStack(spacing: 0) {
            instrument(
                label: "GS",
                value: locationManager.isTracking ? String(format: "%.0f", locationManager.speedKnots) : "---",
                unit: "KTS"
            )
            divider
            instrument(
                label: "ALT",
                value: locationManager.isTracking ? String(format: "%.0f", locationManager.altitudeFeet) : "---",
                unit: "FT"
            )
            divider
            instrument(
                label: "VS",
                value: locationManager.isTracking ? String(format: "%+.0f", locationManager.verticalSpeed) : "---",
                unit: "FPM"
            )
            divider
            instrument(
                label: "TRK",
                value: locationManager.isTracking && locationManager.course >= 0
                    ? String(format: "%03.0f°", locationManager.course)
                    : "---",
                unit: locationManager.courseCardinal
            )
            divider
            instrument(
                label: "LAT",
                value: locationManager.location != nil
                    ? String(format: "%.4f", locationManager.location!.coordinate.latitude)
                    : "---",
                unit: ""
            )
            divider
            instrument(
                label: "LON",
                value: locationManager.location != nil
                    ? String(format: "%.4f", locationManager.location!.coordinate.longitude)
                    : "---",
                unit: ""
            )
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.3), radius: 8, y: 2)
    }

    private func instrument(label: String, value: String, unit: String) -> some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .monospaced))
                .foregroundStyle(.primary)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if !unit.isEmpty {
                Text(unit)
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var divider: some View {
        Rectangle()
            .fill(.quaternary)
            .frame(width: 0.5, height: 36)
    }
}

struct GPSToggleButton: View {
    @Binding var isTracking: Bool
    let action: () -> Void

    var body: some View {
        Button {
            action()
        } label: {
            Image(systemName: isTracking ? "location.fill" : "location")
                .font(.system(size: 12))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isTracking ? Color.blue.opacity(0.15) : Color(.systemGray6))
                .foregroundStyle(isTracking ? .blue : .secondary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
