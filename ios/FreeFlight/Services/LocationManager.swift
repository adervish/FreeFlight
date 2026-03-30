import Foundation
import CoreLocation
import Observation

@Observable
final class LocationManager: NSObject, CLLocationManagerDelegate {
    static let shared = LocationManager()

    var location: CLLocation?
    var speed: CLLocationSpeed = 0          // m/s
    var altitude: CLLocationDistance = 0     // meters
    var course: CLLocationDirection = 0     // degrees
    var horizontalAccuracy: Double = 0
    var verticalAccuracy: Double = 0
    var isTracking = false
    var authorizationStatus: CLAuthorizationStatus = .notDetermined

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .airborne
        manager.allowsBackgroundLocationUpdates = false
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    func startTracking() {
        requestPermission()
        manager.startUpdatingLocation()
        isTracking = true
    }

    func stopTracking() {
        manager.stopUpdatingLocation()
        isTracking = false
    }

    // MARK: - Computed properties for display

    /// Speed in knots
    var speedKnots: Double {
        guard speed >= 0 else { return 0 }
        return speed * 1.94384
    }

    /// Altitude in feet
    var altitudeFeet: Double {
        altitude * 3.28084
    }

    /// Ground track as cardinal direction
    var courseCardinal: String {
        guard course >= 0 else { return "---" }
        let dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                     "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
        let idx = Int((course + 11.25) / 22.5) % 16
        return dirs[idx]
    }

    /// Vertical speed in ft/min (computed from successive locations)
    private var lastAltitude: Double?
    private var lastAltitudeTime: Date?
    var verticalSpeed: Double = 0 // ft/min

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        location = loc
        speed = loc.speed
        altitude = loc.altitude
        course = loc.course
        horizontalAccuracy = loc.horizontalAccuracy
        verticalAccuracy = loc.verticalAccuracy

        // Compute vertical speed
        let now = Date()
        let altFt = loc.altitude * 3.28084
        if let lastAlt = lastAltitude, let lastTime = lastAltitudeTime {
            let dt = now.timeIntervalSince(lastTime)
            if dt > 0.5 {
                verticalSpeed = (altFt - lastAlt) / (dt / 60.0) // ft/min
                lastAltitude = altFt
                lastAltitudeTime = now
            }
        } else {
            lastAltitude = altFt
            lastAltitudeTime = now
        }
    }

    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        authorizationStatus = status
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            if isTracking {
                manager.startUpdatingLocation()
            }
        }
    }
}
