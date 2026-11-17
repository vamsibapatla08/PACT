import SwiftUI

/// The Friends tab: add a friend, answer requests, and everyone you're friends with.
struct FriendsView: View {
    @Environment(PactStore.self) private var store
    @State private var adding = false

    var body: some View {
        NavigationStack {
            TabScreen(title: "Friends") {
                Button("Find people", systemImage: "magnifyingglass") { adding = true }.pactAction()

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

/// Search everyone on Pact by name, or by their exact email, and add them as a friend.
struct AddFriendSheet: View {
    @Environment(PactStore.self) private var store
    @State private var query = ""
    @State private var results: [PersonResult] = []
    @State private var searching = false
    @State private var failure: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetTitle(title: "Find people")
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Name or email", text: $query)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focused)
                if searching { ProgressView().tint(PactColor.silver) }
            }
            .padding(16)
            .pactWell(16)

            if let failure {
                Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red)
            } else if query.trimmingCharacters(in: .whitespaces).count < 2 {
                Text("Type at least two letters of their name, or their whole email.").font(.footnote).foregroundStyle(.secondary)
            } else if results.isEmpty && !searching {
                Text("Nobody on Pact matches that yet.").font(.footnote).foregroundStyle(.secondary)
            }

            ScrollView {
                VStack(spacing: 14) {
                    ForEach(results) { person in
                        HStack(spacing: 12) {
                            Avatar(name: person.name, url: person.avatarUrl, size: 42)
                            Text(person.name ?? "Someone").font(.body.weight(.semibold))
                            Spacer()
                            action(person)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .onAppear { focused = true }
        // Waits a moment after typing stops, so each letter doesn't send its own search.
        .task(id: query) {
            let text = query.trimmingCharacters(in: .whitespaces)
            guard text.count >= 2 else { results = []; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            searching = true
            let outcome = await store.searchPeople(text)
            searching = false
            guard !Task.isCancelled else { return }
            switch outcome {
            case .success(let found): failure = nil; withAnimation(.smooth) { results = found }
            case .failure(let message): failure = message.text
            }
        }
    }

    @ViewBuilder
    private func action(_ person: PersonResult) -> some View {
        switch person.status {
        case "friend":
            Label("Friends", systemImage: "checkmark").font(.subheadline.weight(.semibold)).foregroundStyle(PactColor.paid)
        case "requested":
            Text("Requested").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        default:
            Button(person.status == "asked_you" ? "Accept" : "Add") {
                Task {
                    if let message = await store.requestFriend(person.id) { failure = message; return }
                    if let index = results.firstIndex(of: person) {
                        results[index].status = person.status == "asked_you" ? "friend" : "requested"
                    }
                }
            }
            .font(.subheadline.weight(.bold)).foregroundStyle(.black)
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(LiquidMetal(shape: Capsule()))
            .buttonStyle(.plain)
        }
    }
}
