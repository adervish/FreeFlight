import SwiftUI
import MapKit

struct SearchBarView: View {
    @Binding var selectedAirport: Airport?
    @Binding var mapPosition: MapCameraPosition
    @State private var query = ""
    @State private var results: [Airport] = []
    @State private var isSearching = false
    @State private var showResults = false
    @FocusState private var isFocused: Bool

    private let api = APIClient.shared

    var body: some View {
        VStack(spacing: 0) {
            // Search field
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .font(.system(size: 14))

                TextField("Search airports...", text: $query)
                    .font(.system(size: 15))
                    .focused($isFocused)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .onChange(of: query) { _, newValue in
                        search(newValue)
                    }
                    .onSubmit {
                        if let first = results.first {
                            selectAirport(first)
                        }
                    }

                if !query.isEmpty {
                    Button {
                        query = ""
                        results = []
                        showResults = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.15), radius: 8, y: 4)

            // Results dropdown
            if showResults && !results.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(results) { airport in
                            SearchResultRow(airport: airport)
                                .onTapGesture { selectAirport(airport) }
                        }
                    }
                }
                .frame(maxHeight: 280)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
                .padding(.top, 4)
            }
        }
        .onChange(of: isFocused) { _, focused in
            if !focused {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    showResults = false
                }
            }
        }
    }

    private func search(_ text: String) {
        guard text.count >= 2 else {
            results = []
            showResults = false
            return
        }
        Task {
            do {
                results = try await api.searchAirports(query: text)
                showResults = !results.isEmpty
            } catch {
                results = []
            }
        }
    }

    private func selectAirport(_ airport: Airport) {
        query = airport.displayIdent
        showResults = false
        isFocused = false

        withAnimation(.easeInOut(duration: 0.5)) {
            mapPosition = .region(MKCoordinateRegion(
                center: airport.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.1, longitudeDelta: 0.1)
            ))
        }

        selectedAirport = airport
    }
}

struct SearchResultRow: View {
    let airport: Airport

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(airport.displayIdent)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.blue)
                    Text(airport.displayName)
                        .font(.system(size: 13))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
                if let city = airport.city, let state = airport.state {
                    Text("\(city), \(state)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(airport.typeLabel)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}
