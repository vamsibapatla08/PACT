import SwiftUI

/// The Friends tab: add a friend, answer requests, and everyone you're friends with.
struct FriendsView: View {
    @Environment(PactStore.self) private var store
    @State private var adding = false

    var body: some View {
        NavigationStack {
            TabScreen(title: "Friends") {
                Button("Add a friend", systemImage: "person.badge.plus") { adding = true }.pactAction()

                let incoming = store.friendRequests.filter(\.incoming)
                let sent = store.friendRequests.filter { !$0.incoming }
                if !incoming.isEmpty {
                    section("Requests") {
                        ForEach(incoming) { request in
                            HStack(spacing: 12) {
                                Avatar(name: request.name, url: request.avatarUrl, size: 40)
                                Text(request.name ?? request.email ?? "Someone").font(.body.weight(.semibold))
                                Spacer()
                                Button("Accept") { Task { await store.answer(request, accept: true) } }
                                    .font(.subheadline.weight(.bold)).foregroundStyle(.black)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(LiquidMetal(shape: Capsule()))
                                Button("Decline", systemImage: "xmark") { Task { await store.answer(request, accept: false) } }
                                    .labelStyle(.iconOnly).foregroundStyle(.secondary)
                                    .frame(width: 34, height: 34).glassCircle()
                            }
                        }
                    }
                }
                if !sent.isEmpty {
                    section("Sent") {
                        ForEach(sent) { request in
                            HStack(spacing: 12) {
                                Avatar(name: request.name, url: request.avatarUrl, size: 40)
                                Text(request.name ?? request.email ?? "Someone").font(.body.weight(.semibold))
                                Spacer()
                                Text("Requested").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                let friends = store.friends
                section("Friends") {
                    if store.pactsLoaded && friends.isEmpty {
                        Text("Add your friends here, then start a pact with them.").foregroundStyle(.secondary)
                    }
                    ForEach(friends) { friend in
                        HStack(spacing: 12) {
                            Avatar(name: friend.member.name, url: friend.member.avatarUrl, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(friend.member.name ?? "Someone").font(.body.weight(.semibold))
                                Text(friend.pacts.map(\.name).joined(separator: ", "))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                        }
                    }
                }
            }
            .refreshable { await store.refresh(); await store.loadSocial() }
            .task { await store.loadSocial() }
            .sheet(isPresented: $adding) { AddFriendSheet() }
        }
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 14) { content() }.pactCard()
        }
    }
}

/// Ask someone to be friends by the email they sign in with. They show up once they say yes.
struct AddFriendSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var sending = false
    @State private var failure: String?

    var body: some View {
        SheetLayout(title: "Add a friend", action: sending ? "Sending…" : "Send request",
                    enabled: !sending && email.contains("@")) {
            sending = true
            failure = nil
            Task {
                failure = await store.requestFriend(email)
                sending = false
                if failure == nil { dismiss() }
            }
        } content: {
            PactField(label: "Their email") {
                TextField("nihar@gmail.com", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
            }
            if let failure { Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red) }
            Text("Use the email they sign in to Pact with. Once they accept, you can ask them into any pact.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}
