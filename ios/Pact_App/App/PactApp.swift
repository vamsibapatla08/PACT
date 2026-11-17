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
                Image("Logo").resizable().scaledToFit().frame(width: 84)
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
        case .wallet: WalletView()
        case .pacts: PactsView()
        case .friends: FriendsView()
        }
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case home, pacts, friends, wallet

    var id: Self { self }
    var title: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .home: "house"
        case .wallet: "wallet.bifold"
        case .pacts: "calendar"
        case .friends: "person.2"
        }
    }
}

/// Four round tabs spread across one glass capsule, and a separate silver + that starts a new pact.
/// Off tabs are thin outline icons; the one you're on fills in black on silver.
struct PactTabBar: View {
    @Binding var tab: AppTab
    let onNew: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 0) {
                ForEach(AppTab.allCases) { item in
                    let on = tab == item
                    Button { tab = item } label: {
                        Image(systemName: item.symbol)
                            .symbolVariant(on ? .fill : .none)
                            .symbolRenderingMode(.hierarchical)
                            .font(.system(size: 21, weight: on ? .semibold : .light))
                            .foregroundStyle(on ? AnyShapeStyle(Color.black) : AnyShapeStyle(Color.white.opacity(0.7)))
                            .frame(width: 58, height: 58)
                            .background { if on { LiquidMetal(shape: Circle()) } }
                            .contentShape(.circle)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.title)
                }
            }
            .padding(5)
            .glassEffect(.regular, in: .capsule)
            Button(action: onNew) {
                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(width: 68, height: 68)
                    .background(LiquidMetal(shape: Circle()))
                    .shadow(color: PactColor.silver.opacity(0.3), radius: 18, y: 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New pact")
        }
        .padding(.horizontal, 16)
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
