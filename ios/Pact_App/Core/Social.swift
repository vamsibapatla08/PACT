import SwiftUI
import Supabase

/// A friend request waiting on someone, from `list_friend_requests`.
struct FriendRequest: Identifiable, Hashable, Decodable {
    let requestId: UUID
    var incoming: Bool
    var userId: UUID
    var name: String?
    var email: String?
    var avatarUrl: String?

    var id: UUID { requestId }

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id", incoming, userId = "user_id", name, email, avatarUrl = "avatar_url"
    }
}

/// A pact I've been asked into, from `list_my_pact_invites`.
struct PactInvite: Identifiable, Hashable, Decodable {
    let pactId: UUID
    var pactName: String
    var inviterName: String?
    var inviterAvatarUrl: String?
    var memberCount: Int

    var id: UUID { pactId }

    enum CodingKeys: String, CodingKey {
        case pactId = "pact_id", pactName = "pact_name", inviterName = "inviter_name"
        case inviterAvatarUrl = "inviter_avatar_url", memberCount = "member_count"
    }
}

/// Someone asked into a pact who hasn't said yes yet, from `list_pact_join_requests`.
struct JoinRequest: Identifiable, Hashable, Decodable {
    let userId: UUID
    var name: String?
    var avatarUrl: String?

    var id: UUID { userId }

    enum CodingKeys: String, CodingKey { case userId = "user_id", name, avatarUrl = "avatar_url" }
}

/// Friends by email, then pacts made from friends. Nobody joins with a code: you ask friends in and they say yes.
extension PactStore {
    func loadSocial() async {
        struct FriendRow: Decodable { let user_id: UUID; let name: String?; let avatar_url: String? }
        async let requests: [FriendRequest]? = try? client.rpc("list_friend_requests").execute().value
        async let friends: [FriendRow]? = try? client.rpc("list_friends").execute().value
        async let invites: [PactInvite]? = try? client.rpc("list_my_pact_invites").execute().value
        let (r, f, i) = await (requests, friends, invites)
        withAnimation(.smooth) {
            friendRequests = r ?? []
            addedFriends = (f ?? []).map { Member(userId: $0.user_id, role: "member", name: $0.name, avatarUrl: $0.avatar_url) }
            pactInvites = i ?? []
        }
    }

    /// Asks someone to be friends by the email they sign in with. Returns an error message, or nil.
    func requestFriend(_ email: String) async -> String? {
        do {
            let _: String = try await client.rpc("send_friend_request", params: ["p_email": email]).execute().value
            await loadSocial()
            return nil
        } catch {
            let text = String(describing: error).lowercased()
            if text.contains("nobody on pact") { return "Nobody on Pact uses that email yet. They need to sign in once first." }
            if text.contains("your own email") { return "That's your own email." }
            return friendly(error, "Couldn't send the request.")
        }
    }

    func answer(_ request: FriendRequest, accept: Bool) async {
        struct Params: Encodable { let p_request_id: UUID; let p_accept: Bool }
        do {
            try await client.rpc("respond_friend_request", params: Params(p_request_id: request.requestId, p_accept: accept)).execute()
            await loadSocial()
        } catch {
            self.error = friendly(error, "Couldn't answer that request.")
        }
    }

    /// Asks friends into a pact. They join once they say yes.
    func invite(_ friends: [Friend], to id: Pact.ID) async {
        guard !friends.isEmpty else { return }
        struct Params: Encodable { let p_pact_id: UUID; let p_user_ids: [UUID] }
        do {
            try await client.rpc("invite_to_pact", params: Params(p_pact_id: id, p_user_ids: friends.map(\.id))).execute()
            await loadJoinRequests(id)
        } catch {
            self.error = friendly(error, "Couldn't ask them in.")
        }
    }

    func answer(_ invite: PactInvite, accept: Bool) async {
        struct Params: Encodable { let p_pact_id: UUID; let p_accept: Bool }
        do {
            try await client.rpc("respond_pact_invite", params: Params(p_pact_id: invite.pactId, p_accept: accept)).execute()
            await loadSocial()
            if accept { await refresh() }
        } catch {
            self.error = friendly(error, "Couldn't answer that invite.")
        }
    }

    func loadJoinRequests(_ id: Pact.ID) async {
        let rows: [JoinRequest]? = try? await client.rpc("list_pact_join_requests", params: ["p_pact_id": id]).execute().value
        joinRequests[id] = rows ?? []
    }
}

/// Someone on Pact from `search_people`, and where I stand with them: `none`, `requested`, `asked_you` or `friend`.
struct PersonResult: Identifiable, Hashable, Decodable {
    let id: UUID
    var name: String?
    var avatarUrl: String?
    var status: String

    enum CodingKeys: String, CodingKey { case id = "user_id", name, avatarUrl = "avatar_url", status }
}

struct SearchFailure: Error { var text: String }

extension PactStore {
    func searchPeople(_ query: String) async -> Result<[PersonResult], SearchFailure> {
        do {
            let rows: [PersonResult] = try await client.rpc("search_people", params: ["p_query": query]).execute().value
            return .success(rows)
        } catch {
            let text = String(describing: error).lowercased()
            if text.contains("could not find the function") || text.contains("pgrst202") {
                return .failure(SearchFailure(text: "Search needs the latest database update."))
            }
            return .failure(SearchFailure(text: friendly(error, "Couldn't search right now.")))
        }
    }

    /// Asks someone from a search to be friends, or accepts if they already asked me. Returns an error message, or nil.
    func requestFriend(_ userId: UUID) async -> String? {
        do {
            let _: String = try await client.rpc("send_friend_request_to", params: ["p_user_id": userId]).execute().value
            await loadSocial()
            return nil
        } catch {
            return friendly(error, "Couldn't send the request.")
        }
    }
}
