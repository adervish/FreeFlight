import SwiftUI

struct LayerToggle: View {
    let label: String
    let icon: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { isOn.toggle() }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10))
                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isOn ? Color.blue.opacity(0.15) : Color(.systemGray6))
            .foregroundStyle(isOn ? .blue : .secondary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct MapStylePicker: View {
    @Binding var selection: MapStyleOption

    var body: some View {
        Menu {
            ForEach(MapStyleOption.allCases, id: \.self) { style in
                Button {
                    selection = style
                } label: {
                    Label(style.rawValue, systemImage: style.icon)
                }
            }
        } label: {
            Image(systemName: selection.icon)
                .font(.system(size: 12))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color(.systemGray6))
                .foregroundStyle(.secondary)
                .clipShape(Capsule())
        }
    }
}
