import Foundation
import MapKit
import PDFKit
import UIKit

struct PlateOverlayInfo: Identifiable {
    let id = UUID()
    let pdfName: String
    let image: UIImage
    let bounds: MKCoordinateRegion
    let nw: CLLocationCoordinate2D
    let ne: CLLocationCoordinate2D
    let sw: CLLocationCoordinate2D
    let se: CLLocationCoordinate2D

    var mapRect: MKMapRect {
        let swPoint = MKMapPoint(sw)
        let nePoint = MKMapPoint(ne)
        return MKMapRect(
            x: min(swPoint.x, nePoint.x),
            y: min(swPoint.y, nePoint.y),
            width: abs(nePoint.x - swPoint.x),
            height: abs(nePoint.y - swPoint.y)
        )
    }

    static func from(georef: PlateGeoref, pdfData: Data) -> PlateOverlayInfo? {
        // Render PDF to image
        guard let pdfDoc = PDFDocument(data: pdfData),
              let page = pdfDoc.page(at: 0) else { return nil }

        let pageRect = page.bounds(for: .mediaBox)
        let scale: CGFloat = 2.0 // retina
        let renderSize = CGSize(width: pageRect.width * scale, height: pageRect.height * scale)

        let renderer = UIGraphicsImageRenderer(size: renderSize)
        let image = renderer.image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: renderSize))
            ctx.cgContext.translateBy(x: 0, y: renderSize.height)
            ctx.cgContext.scaleBy(x: scale, y: -scale)
            page.draw(with: .mediaBox, to: ctx.cgContext)
        }

        let nw = CLLocationCoordinate2D(latitude: georef.nw_lat, longitude: georef.nw_lon)
        let ne = CLLocationCoordinate2D(latitude: georef.ne_lat, longitude: georef.ne_lon)
        let sw = CLLocationCoordinate2D(latitude: georef.sw_lat, longitude: georef.sw_lon)
        let se = CLLocationCoordinate2D(latitude: georef.se_lat, longitude: georef.se_lon)

        let centerLat = (nw.latitude + sw.latitude) / 2
        let centerLon = (nw.longitude + ne.longitude) / 2
        let spanLat = abs(nw.latitude - sw.latitude)
        let spanLon = abs(ne.longitude - nw.longitude)

        return PlateOverlayInfo(
            pdfName: georef.pdf_name,
            image: image,
            bounds: MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: centerLat, longitude: centerLon),
                span: MKCoordinateSpan(latitudeDelta: spanLat, longitudeDelta: spanLon)
            ),
            nw: nw, ne: ne, sw: sw, se: se
        )
    }
}
