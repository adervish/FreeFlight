import SwiftUI

struct AirspaceBorderLabel: View {
    let label: AirspaceLabel

    private var labelColor: Color {
        switch label.color {
        case "B": return .blue
        case "C": return .purple
        case "D": return .blue
        default: return .gray
        }
    }

    var body: some View {
        if label.isCenter {
            // Center label: colored text, no background
            Text(label.text)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(labelColor)
                .multilineTextAlignment(.center)
        } else {
            // Border label: black box, rotated along border, text rises inward
            Text(label.text)
                .font(.system(size: 9, weight: .semibold, design: .default))
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Color.black.opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(labelColor.opacity(0.5), lineWidth: 1)
                )
                .rotationEffect(.degrees(label.angle))
        }
    }
}
