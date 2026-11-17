import SwiftUI

/// My profile, opened from the photo in the top right: photo, name and email from `profiles`, and Sign out.
struct ProfileView: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showingWallet = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                HStack {
                    Text("Profile").font(.system(size: 30, weight: .heavy)).silver()
                    Spacer()
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .font(.headline)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                        .glassCircle()
                }

                VStack(spacing: 12) {
                    Avatar(name: store.profile?.name, url: store.profile?.avatarUrl, size: 96)
                        .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: 2))
                    Text(store.profile?.name ?? "You").font(.title2.weight(.heavy))
                    if let email = store.profile?.email {
                        Text(email).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .pactCard()

                VStack(spacing: 14) {
                    row("Pacts", "\(store.pacts.count)")
                    row("Friends", "\(store.friends.count)")
                }
                .pactCard()

                Button { showingWallet = true } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Payment details").font(.headline.weight(.bold)).foregroundStyle(.primary)
                            Text(store.wallet == nil ? "Set up the first time you approve a payment" : "Wallet, balance and test money")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.bold)).silver()
                    }
                    .pactCard()
                }
                .buttonStyle(.plain)

                Button("Sign out") {
                    dismiss()
                    Task { await store.signOut() }
                }
                .pactGhost()
            }
            .padding(24)
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .sheet(isPresented: $showingWallet) { WalletView() }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.body.weight(.semibold)).monospacedDigit()
        }
    }
}
