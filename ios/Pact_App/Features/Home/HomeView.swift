import SwiftUI

/// The Home tab: a hello, what I owe across my pacts, New pact, and my pacts with where each is up to.
struct HomeView: View {
    @Environment(PactStore.self) private var store
    @Binding var tab: AppTab

    private var greeting: String {
        guard let first = store.profile?.name?.split(separator: " ").first else { return "Hi" }
        return "Hi, \(first)"
    }

    var body: some View {
        NavigationStack {
            if !store.homeReady {
                VStack(spacing: 18) {
                    Image("Logo").resizable().scaledToFit().frame(width: 64)
                    ProgressView().tint(PactColor.silver).controlSize(.large)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AmbientBackdrop())
                .toolbar(.hidden, for: .navigationBar)
                .task { await reload() }
            } else {
            TabScreen(title: greeting) {
                WalletCard(balance: store.wallet?.usdcBalance, address: store.wallet?.address, name: store.profile?.name)
                    .padding(.top, 4)
                BalanceLine(owed: store.owed, collecting: store.collecting, hasWallet: store.wallet != nil) { tab = .wallet }

                ForEach(store.pactInvites) { invite in InviteCard(invite: invite) }

                HStack {
                    Text("Your pacts").font(.title3.weight(.bold)).foregroundStyle(.white)
                    Spacer()
                    if store.pacts.count > 3 {
                        Button("See all") { tab = .pacts }.font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.75))
                    }
                }
                if store.pactsLoaded && store.pacts.isEmpty {
                    Text("No pacts yet. Add your friends, then tap + to start a pact with them.")
                        .foregroundStyle(.secondary)
                        .pactCard()
                }
                ForEach(store.pacts.prefix(3)) { pact in
                    NavigationLink(value: pact.id) { PactRow(pact: pact) }.buttonStyle(.plain)
                }
            }
            .refreshable { await reload() }
            .navigationDestination(for: Pact.ID.self) { PactView(id: $0) }
            }
        }
    }

    /// Pacts first, then every pact's balance at once. Home shows only when all of it is in.
    private func reload() async {
        await store.refresh()
        async let social: Void = store.loadSocial()
        async let wallet: Void = store.loadWallet()
        await withTaskGroup(of: Void.self) { group in
            for pact in store.pacts { group.addTask { @MainActor in await store.loadPactSplit(pact.id) } }
        }
        _ = await (social, wallet)
        withAnimation(.smooth) { store.homeReady = true }
    }
}

/// One pact in a list: its name, who's in it, and what it needs from me.
struct PactRow: View {
    @Environment(PactStore.self) private var store
    let pact: Pact

    var body: some View {
        let people = store.members[pact.id] ?? []
        HStack(spacing: 14) {
            ZStack {
                ForEach(Array(people.prefix(3).enumerated()), id: \.element.id) { index, member in
                    Avatar(name: member.name, url: member.avatarUrl, size: 30)
                        .overlay(Circle().strokeBorder(.black, lineWidth: 2))
                        .offset(x: CGFloat(index) * 12)
                }
            }
            .frame(width: 56, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(pact.name).font(.headline.weight(.bold)).foregroundStyle(.primary)
                Text(people.map { $0.userId == store.myId ? "You" : firstName($0.name) }.joined(separator: ", "))
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            badge
        }
        .pactCard()
    }

    @ViewBuilder
    private var badge: some View {
        if let chain = store.pactSplit[pact.id], chain.state != "none" {
            if chain.state == "released" {
                Text("Paid out").font(.caption.weight(.heavy)).foregroundStyle(PactColor.paid)
            } else if chain.state == "open", chain.members.contains(where: { $0.userId == store.myId && $0.address != nil }), !chain.paid(store.myId) {
                Text("Owe \(dollars(Double(chain.share.usdc) ?? 0))").font(.caption.weight(.heavy)).foregroundStyle(.black)
                    .padding(.horizontal, 10).padding(.vertical, 6).background(LiquidMetal(shape: Capsule()))
            } else {
                Text("\(chain.sharesPaid) of \(chain.sharesNeeded) paid").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            }
        } else {
            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).silver()
        }
    }
}

/// A friend asked me into a pact. Join or decline right here.
private struct InviteCard: View {
    @Environment(PactStore.self) private var store
    let invite: PactInvite
    @State private var answering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Avatar(name: invite.inviterName, url: invite.inviterAvatarUrl, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(firstName(invite.inviterName)) asked you into").font(.subheadline).foregroundStyle(.secondary)
                    Text(invite.pactName).font(.headline.weight(.bold))
                }
                Spacer()
                Text("\(invite.memberCount) in").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Button("Join") { answer(true) }.pactAction()
                Button("Not now") { answer(false) }.pactGhost()
            }
            .disabled(answering)
        }
        .pactCard()
    }

    private func answer(_ accept: Bool) {
        answering = true
        Task { await store.answer(invite, accept: accept); answering = false }
    }
}

/// The wallet as a metal card, like the website: balance, the full wallet address as the number, and my name.
/// It floats a little and tilts as you drag it.
struct WalletCard: View {
    let balance: String?
    let address: String?
    let name: String?
    @State private var drag: CGSize = .zero

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            card
                .rotation3DEffect(.degrees(Double(drag.width) / 9 + sin(t * 0.45) * 3), axis: (x: 0, y: 1, z: 0), perspective: 0.55)
                .rotation3DEffect(.degrees(Double(-drag.height) / 11 + cos(t * 0.4) * 2), axis: (x: 1, y: 0, z: 0), perspective: 0.55)
                .offset(y: sin(t * 0.7) * 2)
        }
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { drag = CGSize(width: max(-120, min(120, $0.translation.width)), height: max(-90, min(90, $0.translation.height))) }
            .onEnded { _ in withAnimation(.spring(response: 0.7, dampingFraction: 0.55)) { drag = .zero } })
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Wallet card, balance \(balance ?? "0.00") USDC")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("PACT").font(.system(size: 17, weight: .heavy)).tracking(5)
                Spacer()
                Text("BASE SEPOLIA").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white.opacity(0.55))
            }
            Spacer(minLength: 10)
            Text("BALANCE").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white.opacity(0.55))
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(balance ?? "0.00").font(.system(size: 42, weight: .heavy)).contentTransition(.numericText())
                Text("USDC").font(.system(size: 16, weight: .bold)).foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 10)
            Text("WALLET ADDRESS").font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
            Text(address ?? "No wallet yet")
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .lineLimit(1).minimumScaleFactor(0.55)
                .padding(.bottom, 10)
            Text("CARD HOLDER").font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
            Text((name ?? "You").uppercased()).font(.system(size: 14, weight: .bold))
        }
        .foregroundStyle(.white)
        .padding(22)
        .aspectRatio(1.586, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0x2A2C33), Color(hex: 0x0D0E11), Color(hex: 0x1D1E23)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(
                    // A soft glow top-left and a faint sheen across, like brushed metal.
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(RadialGradient(colors: [Color(hex: 0x96AADC).opacity(0.22), .clear], center: .topLeading, startRadius: 0, endRadius: 320))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [.white.opacity(0.35), .white.opacity(0.05), .white.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
                )
        }
        .shadow(color: .black.opacity(0.55), radius: 26, y: 18)
    }
}

/// Under the card: what I owe, what's coming in, or all clear, as small pills.
private struct BalanceLine: View {
    let owed: Double
    let collecting: Double
    let hasWallet: Bool
    let openWallet: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Spacer(minLength: 0)
            if owed == 0 && collecting == 0 {
                Label("Up to date", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white, PactColor.paid)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .glassEffect(.regular, in: .capsule)
            }
            if owed > 0 {
                HStack(spacing: 6) { Text("You owe").opacity(0.65); Text(dollars(owed)).fontWeight(.heavy) }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Capsule().fill(.white))
            }
            if collecting > 0 {
                HStack(spacing: 6) { Text("Coming to you").opacity(0.65); Text(dollars(collecting)).fontWeight(.heavy) }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .glassEffect(.regular, in: .capsule)
            }
            Button(hasWallet ? "Wallet" : "Make your wallet", action: openWallet)
                .font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.75))
            Spacer(minLength: 0)
        }
        .animation(.smooth, value: owed)
        .animation(.smooth, value: collecting)
    }
}
