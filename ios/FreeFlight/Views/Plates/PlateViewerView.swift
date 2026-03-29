import SwiftUI
import PDFKit

struct PlateViewerView: View {
    let ident: String
    let plate: Plate
    @State private var pdfData: Data?
    @State private var isLoading = true
    @State private var error: String?
    @Environment(\.dismiss) var dismiss

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            Group {
                if let pdfData {
                    PDFKitView(data: pdfData)
                } else if let error {
                    ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                } else {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading plate...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(plate.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await loadPDF() }
        }
    }

    private func loadPDF() async {
        let url = await api.platePDFURL(ident: ident, pdf: plate.pdf)
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                error = "Failed to load plate"
                isLoading = false
                return
            }
            pdfData = data
        } catch {
            self.error = "Network error"
        }
        isLoading = false
    }
}

struct PDFKitView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.displayMode = .singlePage
        pdfView.displayDirection = .vertical
        pdfView.backgroundColor = UIColor.systemBackground
        pdfView.document = PDFDocument(data: data)
        return pdfView
    }

    func updateUIView(_ uiView: PDFView, context: Context) {}
}
