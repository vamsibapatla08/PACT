import SwiftUI

/// The one thing the group agreed to book, as Grok wrote it up: what it is, the link, and the split.
struct Booking: Hashable {
    let recommendation: Recommendation
    let option: PilotOption
    let people: Int

    var perPerson: Double? { option.pricePerPerson ?? recommendation.perPerson(option) }
    var total: Double? { perPerson.map { $0 * Double(people) } }
    var question: String { "Book \(option.title)?" }
}

/// Where a pact is up to, from my side. Each case is the one thing I can do, or what we're waiting on.
enum PactStep: Equatable {
    /// Talk it through, then ask Grok to write up what you agreed.
    case talk
    /// Grok's card is up. Everyone taps Approve to agree to it.
    case approve(Decision)
    case waitingApprovals(approved: Int, of: Int)
    /// Someone said not yet. Talk again and ask Grok for a new card.
    case declined
    /// Everyone approved. The coordinator needs a wallet to collect into.
    case needsWallet
    /// Everyone approved. The coordinator's app is saving the split.
    case settingUp
    case waitSetup(coordinator: String)
    /// The split is saved. The coordinator starts collecting.
    case startCollecting
    case waitStart(coordinator: String)
    case pay(amount: Double)
    case waitPay(paid: Int, of: Int)
    case finalise(total: Double)
    case waitFinalise(coordinator: String)
    case done(total: Double, coordinator: String)
    case cancelled
}

/// What Grok is asked once the group has agreed in the chat.
let bookingQuestion = """
Find the one thing our group agreed to book in the chat above. Use any link and price someone shared. \
Return it as the only option, with price_per_person for each of us and its link. Don't suggest other places.
"""

extension PactStore {
    func coordinator(_ id: Pact.ID) -> Member? { members[id]?.first(where: \.isHost) }

    func amCoordinator(_ id: Pact.ID) -> Bool { coordinator(id)?.userId == myId }

    /// The newest thing Grok wrote up for this pact.
    func booking(_ id: Pact.ID) -> Booking? {
        guard let rec = recommendations[id]?.first, let option = rec.options.first else { return nil }
        return Booking(recommendation: rec, option: option, people: max(1, members[id]?.count ?? 1))
    }

    func consent(_ id: Pact.ID, for booking: Booking) -> Decision? {
        decisions[id]?.first { $0.recommendationId == booking.recommendation.id }
    }

    func step(_ id: Pact.ID) -> PactStep {
        let host = coordinator(id).map { $0.userId == myId ? "you" : firstName($0.name) } ?? "the coordinator"
        let iCoordinate = amCoordinator(id)

        if let chain = pactSplit[id], chain.state != "none" {
            let total = Double(chain.total.usdc) ?? 0
            switch chain.state {
            case "released": return .done(total: total, coordinator: host)
            case "cancelled": return .cancelled
            default:
                let myShare = chain.members.contains { $0.userId == myId && $0.address != nil }
                if myShare && !chain.paid(myId) { return .pay(amount: Double(chain.share.usdc) ?? 0) }
                if chain.funded { return iCoordinate ? .finalise(total: total) : .waitFinalise(coordinator: host) }
                return .waitPay(paid: chain.sharesPaid, of: chain.sharesNeeded)
            }
        }
        if fundingPlans[id] != nil { return iCoordinate ? .startCollecting : .waitStart(coordinator: host) }

        guard let booking = booking(id), let consent = consent(id, for: booking) else { return .talk }
        switch consent.status {
        case "approved":
            if !iCoordinate { return .waitSetup(coordinator: host) }
            return wallet == nil ? .needsWallet : .settingUp
        case "rejected":
            return .declined
        default:
            return consent.myVote == nil ? .approve(consent) : .waitingApprovals(approved: consent.approvals, of: consent.eligible)
        }
    }

    /// What I owe across every pact that's collecting.
    var owed: Double {
        pacts.reduce(0) { sum, pact in
            guard let chain = pactSplit[pact.id], chain.state == "open",
                  chain.members.contains(where: { $0.userId == myId && $0.address != nil }), !chain.paid(myId) else { return sum }
            return sum + (Double(chain.share.usdc) ?? 0)
        }
    }

    /// Grok reads the chat, writes up the one thing to book, and the card goes to everyone to approve.
    func askGrokToBook(_ id: Pact.ID) async -> String? {
        if let failure = await askPilot(id, question: bookingQuestion) { return failure }
        guard let booking = booking(id), consent(id, for: booking) == nil else { return nil }
        await createDecision(id, question: booking.question, options: ["Approve", "Not yet"], rule: "unanimous",
                             recommendationId: booking.recommendation.id)
        await importFromGrok(id)
        return nil
    }

    /// Approving needs a wallet, so the split can include me. The first approve sets one up.
    func approve(_ decision: Decision, in id: Pact.ID) async {
        if wallet == nil { await createWallet() }
        guard wallet != nil else { return }
        await vote(decision, approve: true, in: id)
    }

    /// Once everyone approves, the coordinator's app saves the split: the price each, paid to them, due in a week.
    func setUpSplit(_ id: Pact.ID) async -> String? {
        guard let booking = booking(id), let each = booking.perPerson, let payee = wallet?.address else {
            return "Grok's card has no price yet. Ask Grok again with the price in the chat."
        }
        let share = each.formatted(.number.precision(.fractionLength(0...2)).grouping(.never).locale(Locale(identifier: "en_US")))
        return await saveFundingPlan(id, shareUsdc: share, deadline: .now.addingTimeInterval(7 * 24 * 3600), payee: payee)
    }
}

func firstName(_ name: String?) -> String {
    name?.split(separator: " ").first.map(String.init) ?? "Someone"
}

extension PactStore {
    /// Hands the coordinator role to someone else in the pact. Locked once the split is set up.
    func makeCoordinator(_ member: Member, in id: Pact.ID) async {
        struct Params: Encodable { let p_pact_id: UUID; let p_user_id: UUID }
        do {
            try await client.rpc("transfer_pact_coordinator", params: Params(p_pact_id: id, p_user_id: member.userId)).execute()
            await loadMembers(id)
        } catch {
            let text = String(describing: error).lowercased()
            self.error = text.contains("locked") ? "Roles are locked once the split is set up."
                : text.contains("could not find the function") || text.contains("pgrst202") ? "Changing roles needs the latest database update. Ask Vamsi to run it."
                : friendly(error, "Couldn't change the role.")
        }
    }
}

/// The kinds of plan a pact can be, with an icon each.
enum PactKind: String, CaseIterable, Identifiable {
    case trip, event, stay, dinner, other

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .trip: "airplane"
        case .event: "ticket"
        case .stay: "bed.double"
        case .dinner: "fork.knife"
        case .other: "sparkles"
        }
    }
}

/// What the coordinator fills in about a pact beyond its name.
struct PactDetails: Equatable {
    var kind: PactKind = .trip
    var about = ""
    var location = ""
    var hasDates = false
    var startsOn = Date.now
    var endsOn = Date.now.addingTimeInterval(2 * 24 * 3600)
    var budget: Double?
    var link = ""

    init() {}

    init(_ pact: Pact) {
        kind = PactKind(rawValue: pact.pactType ?? "") ?? .trip
        about = pact.description ?? ""
        location = pact.location ?? ""
        budget = pact.budget
        link = pact.link ?? ""
        if let start = pact.startsOn.flatMap(dayDate) {
            hasDates = true
            startsOn = start
            endsOn = pact.endsOn.flatMap(dayDate) ?? start
        }
    }
}

private let dayFormat: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    return formatter
}()

func dayDate(_ text: String) -> Date? { dayFormat.date(from: text) }

/// "Nov 20 – 22", or one day.
func dateRange(_ pact: Pact) -> String? {
    guard let start = pact.startsOn.flatMap(dayDate) else { return nil }
    let end = pact.endsOn.flatMap(dayDate) ?? start
    let short = Date.FormatStyle().month(.abbreviated).day()
    if Calendar.current.isDate(start, inSameDayAs: end) { return start.formatted(short) }
    return "\(start.formatted(short)) – \(end.formatted(short))"
}

extension PactStore {
    /// Saves the coordinator's details. Returns an error message, or nil.
    func saveDetails(_ details: PactDetails, for id: Pact.ID) async -> String? {
        struct Params: Encodable {
            let p_pact_id: UUID; let p_type: String; let p_description: String; let p_location: String
            let p_starts_on: String?; let p_ends_on: String?; let p_budget: Double?; let p_link: String
        }
        let link = details.link.trimmingCharacters(in: .whitespaces)
        do {
            try await client.rpc("set_pact_details", params: Params(
                p_pact_id: id, p_type: details.kind.rawValue, p_description: details.about, p_location: details.location,
                p_starts_on: details.hasDates ? dayFormat.string(from: details.startsOn) : nil,
                p_ends_on: details.hasDates ? dayFormat.string(from: max(details.startsOn, details.endsOn)) : nil,
                p_budget: details.budget,
                p_link: link.isEmpty || link.hasPrefix("http") ? link : "https://\(link)"
            )).execute()
            await refresh()
            return nil
        } catch {
            let text = String(describing: error).lowercased()
            if text.contains("could not find the function") || text.contains("pgrst202") {
                return "Saving details needs the latest database update."
            }
            return friendly(error, "Couldn't save the details.")
        }
    }

    /// Makes the pact, saves its details, and asks the picked friends in.
    func create(name: String, details: PactDetails, friends: [Friend]) async -> Pact.ID? {
        let before = Set(pacts.map(\.id))
        guard await create(name: name, description: details.about, budget: details.budget),
              let made = pacts.first(where: { !before.contains($0.id) }) else { return nil }
        _ = await saveDetails(details, for: made.id)
        await invite(friends, to: made.id)
        return made.id
    }

    /// Grok's write-up fills in the link and price when the coordinator hasn't set them yet.
    func importFromGrok(_ id: Pact.ID) async {
        guard amCoordinator(id), let pact = pacts.first(where: { $0.id == id }), let booking = booking(id) else { return }
        var details = PactDetails(pact)
        guard details.link.isEmpty || details.budget == nil else { return }
        if details.link.isEmpty, let link = booking.option.link { details.link = link }
        if details.budget == nil { details.budget = booking.perPerson }
        if details.about.isEmpty { details.about = booking.option.title }
        _ = await saveDetails(details, for: id)
    }
}
