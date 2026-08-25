import SwiftUI

@main
struct LingoGateApp: App {
    @StateObject private var services = AppServices()
    @StateObject private var coordinator = GateCoordinator()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            HomeView(services: services, coordinator: coordinator)
                .fullScreenCover(item: $coordinator.activeGate) { context in
                    QuizView(context: context, services: services, coordinator: coordinator)
                }
                .onOpenURL { url in
                    coordinator.handleURL(url)
                }
                .onChange(of: scenePhase) { _, phase in
                    // shield モードのフォアグラウンド再チェック（解除ウィンドウ超過なら再シールド）。
                    if phase == .active {
                        coordinator.reshieldIfExpired()
                    }
                }
        }
    }
}
