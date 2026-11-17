import SwiftUI

/// The Pacts tab: every pact is a group chat with Grok in it.
struct PactsView: View {
    @Environment(PactStore.self) private var store

    var body: some View {
        NavigationStack {
            TabScreen(title: "Pacts") {
                if store.pactsLoaded && store.pacts.isEmpty {
                    Text("A pact is a group chat for one plan. Tap + to start one with your friends.")
                        .foregroundStyle(.secondary)
                        .pactCard()
                }
                ForEach(store.pacts) { pact in
                    NavigationLink(value: pact.id) { PactRow(pact: pact) }.buttonStyle(.plain)
                }
            }
            .refreshable { await store.refresh() }
            .navigationDestination(for: Pact.ID.self) { PactView(id: $0) }
        }
    }
}

extension View {
    /// Shows the store's last error, if there is one.
    func errorAlert() -> some View { modifier(ErrorAlert()) }
}

private struct ErrorAlert: ViewModifier {
    @Environment(PactStore.self) private var store

    func body(content: Content) -> some View {
        content.alert("Something went wrong", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.error ?? "")
        }
    }
}
