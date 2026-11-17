import SwiftUI
import Observation
import Supabase

/// Everything the app shows, read from and written to the live Supabase project, through the same
/// tables and functions the web app uses.
@Observable
final class PactStore {
    let client = SupabaseClient(supabaseURL: PactConfig.url, supabaseKey: PactConfig.publishableKey)

    var session: Session?
    var profile: Profile?
    var pacts: [Pact] = []
    var members: [Pact.ID: [Member]] = [:]
    var messages: [Pact.ID: [Message]] = [:]
    /// My Circle wallet on Base Sepolia, once it's made.
    var wallet: Wallet?
    /// My recent sends and receives.
    var activity: [Transfer] = []
    /// Each pact's funding plan, and where it stands on PactSplit, read live from Base.
    var fundingPlans: [Pact.ID: FundingPlan] = [:]
    var pactSplit: [Pact.ID: PactSplitStatus] = [:]
    var shareReceipts: [Pact.ID: [ShareReceipt]] = [:]
    /// PactPilot's saved answers and the group's votes, newest first.
    var recommendations: [Pact.ID: [Recommendation]] = [:]
    var decisions: [Pact.ID: [Decision]] = [:]
    /// An invite code from a pact:// link, waiting for the Join sheet.
    var pendingInvite: String?
    /// Friend requests sent and received, friends from accepted requests, pacts I've been asked into,
    /// and who's been asked into each pact.
    var friendRequests: [FriendRequest] = []
    var addedFriends: [Member] = []
    var pactInvites: [PactInvite] = []
    var joinRequests: [Pact.ID: [JoinRequest]] = [:]
    /// Each pact's items: the stays, flights, tickets and dinners it's booking.
    var items: [Pact.ID: [PactItem]] = [:]
    /// True while a pact's chat is open, so the tab bar steps aside for the keyboard and message box.
    var inChat = false
    var walletBusy = false
    var loading = false
    var error: String?
    /// False until the saved session has been checked, so launch shows the logo instead of a flash of sign-in.
    var authReady = false
    /// Set once each first load finishes, so empty states don't flash while data is on its way.
    var pactsLoaded = false
    var walletLoaded = false
    /// True once Home has every pact's balance, so it never shows "Up to date" before it knows.
    var homeReady = false

    var signedIn: Bool { session != nil }
    var myId: UUID? { session?.user.id }

    /// Everyone I share a pact with, once each, with the pacts we share.
    var friends: [Friend] {
        var byId: [UUID: Friend] = [:]
        for member in addedFriends where member.userId != myId { byId[member.userId] = Friend(member: member) }
        for pact in pacts {
            for member in members[pact.id] ?? [] where member.userId != myId {
                byId[member.userId, default: Friend(member: member)].pacts.append(pact)
            }
        }
        return byId.values.sorted { ($0.member.name ?? "") < ($1.member.name ?? "") }
    }

    /// Someone's name from any pact we share.
    func displayName(_ userId: UUID) -> String {
        if userId == myId { return "You" }
        return members.values.lazy.flatMap { $0 }.first { $0.userId == userId }?.name ?? "Someone"
    }

    init() {
        Task { await watchAuth() }
    }

    private func watchAuth() async {
        for await (_, session) in client.auth.authStateChanges {
            withAnimation(.smooth) {
                self.session = session
                authReady = true
            }
            if session != nil {
                // Fills in the profile name from Google for a returning session.
                try? await client.rpc("sync_my_google_profile").execute()
                await loadProfile()
                await refresh()
                await loadSocial()
                await loadWallet()
            } else {
                profile = nil; pacts = []; members = [:]; messages = [:]; wallet = nil; activity = []
                fundingPlans = [:]; pactSplit = [:]; shareReceipts = [:]; recommendations = [:]; decisions = [:]
                friendRequests = []; addedFriends = []; pactInvites = []; joinRequests = [:]
                pactsLoaded = false; walletLoaded = false; homeReady = false
            }
        }
    }

    func loadProfile() async {
        guard let myId else { return }
        profile = try? await client.from("profiles")
            .select("name, email, avatar_url")
            .eq("id", value: myId)
            .single()
            .execute().value
    }

    // MARK: Sign in

    func signIn() async {
        error = nil
        do {
            try await client.auth.signInWithOAuth(provider: .google, redirectTo: PactConfig.authRedirect)
        } catch {
            self.error = friendly(error, "Google sign-in didn't finish. Try again.")
        }
    }

    func signOut() async {
        try? await client.auth.signOut()
    }

    // MARK: Pacts

    /// My active pacts, newest first, with their people.
    func refresh() async {
        guard let myId else { return }
        loading = true
        defer { loading = false; pactsLoaded = true }
        do {
            struct Row: Decodable { let pact_id: UUID }
            let rows: [Row] = try await client.from("pact_members")
                .select("pact_id")
                .eq("user_id", value: myId)
                .eq("membership_status", value: "active")
                .execute().value
            let ids = Array(Set(rows.map(\.pact_id)))
            guard !ids.isEmpty else { withAnimation(.smooth) { pacts = [] }; return }

            let fetched: [Pact] = try await client.from("pacts")
                .select("*")
                .in("pact_id", values: ids)
                .order("created_at", ascending: false)
                .execute().value
            withAnimation(.smooth) { pacts = fetched }
            error = nil
            for pact in fetched { await loadMembers(pact.id) }
        } catch {
            self.error = friendly(error, "Couldn't load your pacts.")
        }
    }

    func loadMembers(_ id: Pact.ID) async {
        do {
            let rows: [Member] = try await client.rpc("list_pact_members", params: ["p_pact_id": id]).execute().value
            members[id] = rows
        } catch {
            self.error = friendly(error, "Couldn't load who's in this pact.")
        }
    }

    /// Creates the pact and makes me its host, in one call.
    func create(name: String, description: String, budget: Double?) async -> Bool {
        struct Params: Encodable { let p_name: String; let p_description: String?; let p_budget: Double? }
        let note = description.trimmingCharacters(in: .whitespaces)
        do {
            try await client.rpc("create_pact", params: Params(p_name: name.trimmingCharacters(in: .whitespaces),
                                                                p_description: note.isEmpty ? nil : note,
                                                                p_budget: budget)).execute()
            await refresh()
            return true
        } catch {
            self.error = friendly(error, "Couldn't create the pact.")
            return false
        }
    }

    func join(code: String) async -> Bool {
        do {
            try await client.rpc("join_pact", params: ["p_invite_code": inviteCode(from: code)]).execute()
            await refresh()
            return true
        } catch {
            self.error = friendly(error, "Couldn't join with that code.")
            return false
        }
    }

    /// A fresh invite code, good for 24 hours. Only the host can make one.
    func invite(_ id: Pact.ID) async -> String? {
        do {
            let rows: [Invitation] = try await client.rpc("create_pact_invitation", params: ["p_pact_id": id]).execute().value
            return rows.first?.inviteCode
        } catch {
            self.error = friendly(error, "Couldn't make an invite code.")
            return nil
        }
    }

    /// The link a host shares. It opens the website's Join page, which works on any phone.
    func inviteLink(_ code: String) -> URL {
        var link = URLComponents(url: PactConfig.web.appending(path: "pacts/join"), resolvingAgainstBaseURL: false)!
        link.queryItems = [URLQueryItem(name: "invite", value: code)]
        return link.url!
    }

    /// The code from a pasted invite link (web or pact://), or the text itself when it's just a code.
    func inviteCode(from text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = URLComponents(string: trimmed)?.queryItems?.first { $0.name == "invite" }?.value
        return code ?? trimmed
    }

    // MARK: Chat

    func name(of userId: UUID, in pact: Pact.ID) -> String {
        if userId == myId { return "You" }
        return members[pact]?.first { $0.userId == userId }?.name ?? "Someone"
    }

    func loadMessages(_ id: Pact.ID) async {
        do {
            let rows: [Message] = try await client.from("pact_messages")
                .select("message_id, pact_id, sender_id, body, created_at")
                .eq("pact_id", value: id)
                .order("created_at", ascending: true)
                .order("message_id", ascending: true)
                .execute().value
            messages[id] = rows
        } catch {
            self.error = friendly(error, "Couldn't load the chat.")
        }
    }

    func send(_ id: Pact.ID, text: String) async {
        struct NewMessage: Encodable { let pact_id: UUID; let body: String }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        do {
            try await client.from("pact_messages").insert(NewMessage(pact_id: id, body: body)).execute()
        } catch {
            self.error = friendly(error, "Your message didn't send.")
        }
    }

    /// New messages arrive live until the calling task is cancelled.
    func listen(_ id: Pact.ID) async {
        let channel = client.channel("pact-messages:\(id.uuidString.lowercased())")
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "pact_messages",
                                             filter: "pact_id=eq.\(id.uuidString.lowercased())")
        await channel.subscribe()
        defer { Task { [client] in await client.removeChannel(channel) } }
        for await insert in inserts {
            guard let message = try? insert.decodeRecord(as: Message.self, decoder: JSONDecoder()) else { continue }
            if messages[id]?.contains(where: { $0.id == message.id }) != true {
                withAnimation(.smooth) { messages[id, default: []].append(message) }
            }
        }
    }

    func friendly(_ error: Error, _ fallback: String) -> String {
        let text = String(describing: error).lowercased()
        if text.contains("invit") || text.contains("expired") { return "That invite code is wrong, expired or already used." }
        if text.contains("row-level security") || text.contains("permission denied") || text.contains("42501") {
            return "You don't have permission to do that."
        }
        if text.contains("network") || text.contains("offline") || text.contains("timed out") {
            return "Pact can't reach the server. Check your connection."
        }
        return fallback
    }
}
