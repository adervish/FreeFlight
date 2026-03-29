import SwiftUI
import SwiftData

@main
struct FreeFlightApp: App {
    let dataManager = DataManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .environment(dataManager)
        }
    }
}
