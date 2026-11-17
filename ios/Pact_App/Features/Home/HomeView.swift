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
            TabScreen(title: greeting) {
                let owed = store.owed
                VStack(alignment: .leading, spacing: 6) {
                    Text("You owe").font(.subheadline.weight(.semibold))
                    Text(dollars(owed)).font(.system(size: 44, weight: .heavy)).contentTransition(.numericText())
                    Text(owed > 0 ? "Open the pact to approve your share." : "You're all settled.")
                        .font(.footnote.weight(.medium))
                }
                .foregroundStyle(.black)
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .liquidMetal()

                ForEach(store.pactInvites) { invite in InviteCard(invite: invite) }

                HStack {
                    Text("Your pacts").font(.headline).foregroundStyle(.secondary)
                    Spacer()
                    if store.pacts.count > 3 {
                        Button("See all") { tab = .pacts }.font(.subheadline.weight(.semibold)).silver()
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
            .task { await reload() }
            .navigationDestination(for: Pact.ID.self) { PactView(id: $0) }
        }
    }

    private func reload() async {
        await store.refresh()
        await store.loadSocial()
        await store.loadWallet()
        for pact in store.pacts { await store.loadPactSplit(pact.id) }
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
