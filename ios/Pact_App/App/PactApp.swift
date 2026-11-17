import SwiftUI

@main
struct PactApp: App {
    @State private var store = PactStore()

    init() {
        // Solid, heavy screen titles to match the rest of the type.
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = [.font: UIFont.systemFont(ofSize: 34, weight: .heavy)]
        bar.titleTextAttributes = [.font: UIFont.systemFont(ofSize: 17, weight: .bold)]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.dark)
                // Google sends people back to pact://login-callback: finish the sign-in here too,
                // in case the link opens the app instead of the sign-in sheet.
                .onOpenURL { url in
                    Task { try? await store.client.auth.session(from: url) }
                }
        }
    }
}

/// The logo while the saved sign-in is checked, then sign in or the tabs.
struct RootView: View {
    @Environment(PactStore.self) private var store

    var body: some View {
        ZStack {
            if !store.authReady {
                Image("Logo").resizable().scaledToFit().frame(width: 96)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AmbientBackdrop())
                    .transition(.opacity)
            } else if store.signedIn {
                MainTabs().transition(.opacity)
            } else {
                SignInView().transition(.opacity)
            }
        }
        .tint(PactColor.silver)
        .animation(.smooth(duration: 0.35), value: store.signedIn)
        .animation(.smooth(duration: 0.35), value: store.authReady)
    }
}

/// The three tabs. Profile opens from the photo in the top right of every tab.
struct MainTabs: View {
    @Environment(PactStore.self) private var store
    @State private var tab = AppTab.home
    @State private var creating = false

    var body: some View {
        // The bar sits below the tabs rather than over them, so every screen's own bottom buttons
        // (New pact, Open chat, the message box) and the end of every list stay above it.
        VStack(spacing: 0) {
            // Every tab stays alive underneath, so each keeps its place when you switch back.
            ZStack {
                ForEach(AppTab.allCases) { item in
                    screen(item)
                        .opacity(tab == item ? 1 : 0)
                        .allowsHitTesting(tab == item)
                }
            }
            .frame(maxHeight: .infinity)
            if !store.inChat {
                PactTabBar(tab: $tab) { creating = true }
                    .padding(.top, 6).transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(AmbientBackdrop())
        .animation(.smooth(duration: 0.25), value: store.inChat)
        .sheet(isPresented: $creating) { CreatePactSheet() }
    }

    @ViewBuilder
    private func screen(_ item: AppTab) -> some View {
        switch item {
        case .home: HomeView(tab: $tab)
        case .pacts: PactsView()
        case .friends: FriendsView()
        }
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case home, pacts, friends

    var id: Self { self }
    var title: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .home: "house"
        case .pacts: "bubble.left.and.bubble.right"
        case .friends: "person.2"
        }
    }
}

/// Three round tabs on a glass capsule, and a separate silver + on the right that starts a new pact.
struct PactTabBar: View {
    @Binding var tab: AppTab
    let onNew: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 6) {
                ForEach(AppTab.allCases) { item in
                    let on = tab == item
                    Button { tab = item } label: {
                        Image(systemName: item.symbol)
                            .symbolVariant(on ? .fill : .none)
                            .font(.system(size: 20, weight: on ? .bold : .regular))
                            .foregroundStyle(on ? AnyShapeStyle(Color.black) : AnyShapeStyle(Color.white.opacity(0.55)))
                            .frame(width: 54, height: 54)
                            .background { if on { LiquidMetal(shape: Circle()) } }
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.title)
                }
            }
            .padding(6)
            .glassEffect(.regular, in: .capsule)
            Spacer()
            Button(action: onNew) {
                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 66, height: 66)
                    .background(LiquidMetal(shape: Circle()))
                    .shadow(color: PactColor.silver.opacity(0.3), radius: 18, y: 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New pact")
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 2)
        .sensoryFeedback(.selection, trigger: tab)
        .animation(.smooth(duration: 0.2), value: tab)
    }
}

/// A tab's page: the Pact header with my photo top right, the page title, then its content.
struct TabScreen<Content: View>: View {
    @Environment(PactStore.self) private var store
    let title: String
    @ViewBuilder let content: Content
    @State private var showingProfile = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 10) {
                    Image("Logo").resizable().scaledToFit().frame(width: 30)
                    Text("Pact").font(.system(size: 26, weight: .heavy)).silver()
                    Spacer()
                    Button { showingProfile = true } label: {
                        Avatar(name: store.profile?.name, url: store.profile?.avatarUrl, size: 40)
                            .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }
                Text(title).font(.system(size: 36, weight: .heavy)).silver()
                content
            }
            .padding(20)
            .animation(.smooth, value: store.pactsLoaded)
            .animation(.smooth, value: store.walletLoaded)
        }
        .background(AmbientBackdrop())
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showingProfile) { ProfileView() }
        .errorAlert()
    }
}
