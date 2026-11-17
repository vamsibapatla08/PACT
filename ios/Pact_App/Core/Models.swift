import Foundation

/// The live Supabase project the web app uses. The publishable key is safe in the app; row level security does the rest.
enum PactConfig {
    static let url = URL(string: "https://gnueyjkepcquehiigcis.supabase.co")!
    static let publishableKey = "sb_publishable_2JjZJGhjRXoONOFIHApFPw_155CbPW-"
    /// Google sends people back here after sign-in. It must be in Supabase's Auth redirect list.
    static let authRedirect = URL(string: "pact://login-callback")!
    /// The live web app, where invite links land.
    static let web = URL(string: "https://pact-chi-nine.vercel.app")!
}

/// A row in `pacts`.
struct Pact: Identifiable, Hashable, Decodable {
    let id: UUID
    var name: String
    var description: String?
    var budget: Double?
    var status: String
    var createdBy: UUID?
    var createdAt: String
    /// `trip`, `event`, `stay`, `dinner` or `other`. Nil until the pact details migration has run.
    var pactType: String?
    var location: String?
    var startsOn: String?
    var endsOn: String?
    var link: String?

    enum CodingKeys: String, CodingKey {
        case id = "pact_id", name, description, budget, status, location, link
        case createdBy = "created_by", createdAt = "created_at", pactType = "pact_type"
        case startsOn = "starts_on", endsOn = "ends_on"
    }
}

/// My row in `profiles`, filled from Google.
struct Profile: Hashable, Decodable {
    var name: String?
    var email: String?
    var avatarUrl: String?

    enum CodingKeys: String, CodingKey { case name, email, avatarUrl = "avatar_url" }
}

/// A row from `list_pact_members`.
struct Member: Identifiable, Hashable, Decodable {
    let userId: UUID
    var role: String
    var name: String?
    var avatarUrl: String?

    var id: UUID { userId }
    var isHost: Bool { role == "host" }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id", role, name, avatarUrl = "avatar_url"
    }
}

/// Someone I share at least one pact with.
struct Friend: Identifiable, Hashable {
    var member: Member
    var pacts: [Pact] = []

    var id: UUID { member.userId }
}

/// A row in `pact_messages`.
struct Message: Identifiable, Hashable, Decodable {
    let id: UUID
    var pactId: UUID
    var senderId: UUID
    var body: String
    var createdAt: String

    enum CodingKeys: String, CodingKey {
        case id = "message_id", pactId = "pact_id", senderId = "sender_id", body, createdAt = "created_at"
    }
}

/// One row from `create_pact_invitation`.
struct Invitation: Decodable {
    var inviteCode: String
    var expiresAt: String

    enum CodingKeys: String, CodingKey { case inviteCode = "invite_code", expiresAt = "expires_at" }
}
