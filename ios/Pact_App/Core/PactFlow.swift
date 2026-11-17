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
        guard let booking = booking(id) else {
            return "Grok couldn't find one thing you've agreed to book yet. Agree on it in the chat, with the link and price, then try again."
        }
        guard consent(id, for: booking) == nil else { return nil }
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

extension PactStore {
    /// Takes someone out of a pact. Coordinator only, and locked once the split is set up.
    func removeMember(_ member: Member, from id: Pact.ID) async {
        struct Params: Encodable { let p_pact_id: UUID; let p_user_id: UUID }
        do {
            try await client.rpc("remove_pact_member", params: Params(p_pact_id: id, p_user_id: member.userId)).execute()
            await loadMembers(id)
        } catch {
            let text = String(describing: error).lowercased()
            self.error = text.contains("locked") ? "People are locked once the split is set up."
                : text.contains("could not find the function") || text.contains("pgrst202") ? "Removing people needs the latest database update."
                : friendly(error, "Couldn't remove them.")
        }
    }

    /// Money still to come in from other people to the pacts I coordinate. My own unpaid share is in "You owe", not here.
    var collecting: Double {
        pacts.reduce(0) { sum, pact in
            guard amCoordinator(pact.id), let chain = pactSplit[pact.id], chain.state == "open" else { return sum }
            let othersUnpaid = chain.members.filter { $0.userId != myId && $0.address != nil && !$0.paid }.count
            return sum + (Double(chain.share.usdc) ?? 0) * Double(othersUnpaid)
        }
    }
}

/// What kind of thing an item is.
enum ItemKind: String, CaseIterable, Identifiable, Codable {
    case stay, flight, ticket, dinner, other

    var id: String { rawValue }
    var title: String {
        switch self {
        case .ticket: "Tickets"
        default: rawValue.capitalized
        }
    }
    var symbol: String {
        switch self {
        case .stay: "bed.double"
        case .flight: "airplane"
        case .ticket: "ticket"
        case .dinner: "fork.knife"
        case .other: "shippingbox"
        }
    }

    /// A best guess from a title Grok wrote, for items added from the chat.
    init(guessing title: String) {
        let text = title.lowercased()
        if ["flight", "fly", "airline", "plane"].contains(where: text.contains) { self = .flight }
        else if ["hotel", "stay", "airbnb", "room", "house", "loft", "hostel"].contains(where: text.contains) { self = .stay }
        else if ["ticket", "event", "show", "concert", "game", "festival", "pass"].contains(where: text.contains) { self = .ticket }
        else if ["dinner", "lunch", "brunch", "restaurant", "meal"].contains(where: text.contains) { self = .dinner }
        else { self = .other }
    }
}

extension PactKind {
    /// The items each kind of pact usually has, offered first when adding one.
    var presets: [ItemKind] {
        switch self {
        case .trip: [.flight, .stay, .ticket, .dinner, .other]
        case .event: [.ticket, .stay, .dinner, .other]
        case .stay: [.stay, .other]
        case .dinner: [.dinner, .other]
        case .other: ItemKind.allCases
        }
    }
}

/// A row in `pact_items`: one thing the pact is booking.
struct PactItem: Identifiable, Hashable, Decodable {
    let id: UUID
    var kind: ItemKind
    var title: String
    var location: String?
    var startsOn: String?
    var endsOn: String?
    var link: String?
    var priceEach: Double?
    var source: String
    var createdBy: UUID

    enum CodingKeys: String, CodingKey {
        case id = "item_id", kind, title, location, link, source
        case startsOn = "starts_on", endsOn = "ends_on", priceEach = "price_each", createdBy = "created_by"
    }

    /// "Nov 20 – 22", or one day, or nil.
    var dates: String? {
        guard let start = startsOn.flatMap(dayDate) else { return nil }
        let end = endsOn.flatMap(dayDate) ?? start
        let short = Date.FormatStyle().month(.abbreviated).day()
        return Calendar.current.isDate(start, inSameDayAs: end) ? start.formatted(short) : "\(start.formatted(short)) – \(end.formatted(short))"
    }
}

/// What someone fills in to add an item.
struct ItemDraft {
    var kind: ItemKind = .stay
    var title = ""
    var location = ""
    var hasDates = false
    var startsOn = Date.now
    var endsOn = Date.now
    var link = ""
    var priceEach: Double?
}

let itemsQuestion = """
List each thing our group agreed to book in the chat above as its own option: a stay, a flight, tickets or a dinner. \
Give each its price_per_person and link. Don't add anything we didn't agree on.
"""

extension PactStore {
    func loadItems(_ id: Pact.ID) async {
        let rows: [PactItem]? = try? await client.from("pact_items")
            .select("item_id, kind, title, location, starts_on, ends_on, link, price_each, source, created_by")
            .eq("pact_id", value: id)
            .order("starts_on", ascending: true, nullsFirst: false)
            .order("created_at", ascending: true)
            .execute().value
        withAnimation(.smooth) { items[id] = rows ?? [] }
    }

    /// What everyone pays for all the items, or nil while none has a price.
    func itemsTotal(_ id: Pact.ID) -> Double? {
        let prices = (items[id] ?? []).compactMap(\.priceEach)
        return prices.isEmpty ? nil : prices.reduce(0, +)
    }

    /// Adds one item. Returns an error message, or nil.
    func addItem(_ draft: ItemDraft, to id: Pact.ID, source: String = "manual") async -> String? {
        struct Row: Encodable {
            let pact_id: UUID; let kind: String; let title: String; let location: String?
            let starts_on: String?; let ends_on: String?; let link: String?; let price_each: Double?; let source: String
        }
        let link = draft.link.trimmingCharacters(in: .whitespaces)
        let place = draft.location.trimmingCharacters(in: .whitespaces)
        let format = Date.ISO8601FormatStyle().year().month().day()
        do {
            try await client.from("pact_items").insert(Row(
                pact_id: id, kind: draft.kind.rawValue, title: draft.title.trimmingCharacters(in: .whitespaces),
                location: place.isEmpty ? nil : place,
                starts_on: draft.hasDates ? draft.startsOn.formatted(format) : nil,
                ends_on: draft.hasDates ? max(draft.startsOn, draft.endsOn).formatted(format) : nil,
                link: link.isEmpty ? nil : (link.hasPrefix("http") ? link : "https://\(link)"),
                price_each: draft.priceEach, source: source
            )).execute()
            await loadItems(id)
            return nil
        } catch {
            let text = String(describing: error).lowercased()
            if text.contains("pact_items") && (text.contains("does not exist") || text.contains("pgrst205")) {
                return "Items need the latest database update."
            }
            if text.contains("row-level security") { return "Items are locked once the split is set up." }
            return friendly(error, "Couldn't add that item.")
        }
    }

    func removeItem(_ item: PactItem, from id: Pact.ID) async {
        do {
            try await client.from("pact_items").delete().eq("item_id", value: item.id).execute()
            await loadItems(id)
        } catch {
            self.error = friendly(error, "Couldn't remove that item.")
        }
    }

    /// Grok reads the chat and each thing the group agreed on becomes an item. Returns an error message, or nil.
    func addItemsWithGrok(_ id: Pact.ID) async -> String? {
        if messages[id] == nil { await loadMessages(id) }
        do {
            let answer: PilotAnswer = try await invoke("pactpilot", ["pact_id": key(id), "question": withChat(itemsQuestion, in: id)])
            guard !answer.options.isEmpty else {
                return "Grok didn't find anything agreed in the chat yet. Add an item by hand, or agree on one in the chat first."
            }
            for option in answer.options {
                var draft = ItemDraft()
                draft.kind = ItemKind(guessing: option.title + " " + option.description)
                draft.title = String(option.title.prefix(120))
                draft.link = option.link ?? ""
                draft.priceEach = option.pricePerPerson
                if let failure = await addItem(draft, to: id, source: "grok") { return failure }
            }
            return nil
        } catch let failure as FunctionFailure {
            return failure.message
        } catch {
            return friendly(error, "Grok couldn't read the chat. Try again.")
        }
    }

    /// Book it from the items: one write-up of everything, priced at the items' total each, for everyone to approve.
    func bookItems(_ id: Pact.ID) async -> String? {
        let list = items[id] ?? []
        guard let total = itemsTotal(id) else { return "Add a price to at least one item first." }
        let name = pacts.first { $0.id == id }?.name ?? "The trip"
        let lines = list.map { item in
            [item.kind.title + ": " + item.title, item.dates, item.priceEach.map { dollars($0) + " each" }]
                .compactMap { $0 }.joined(separator: " · ")
        }
        let option = PilotOption(title: name, description: lines.joined(separator: "\n"), tradeoff: "",
                                 pricePerPerson: total, link: list.compactMap(\.link).first)
        struct Params: Encodable {
            let p_pact_id: UUID; let p_summary: String; let p_options: [PilotOption]
            let p_tasks: [PilotTask]; let p_costs: [PilotCost]; let p_next_steps: [String]
        }
        do {
            try await client.rpc("save_pact_recommendation", params: Params(
                p_pact_id: id,
                p_summary: "Everything you're booking: \(list.count) item\(list.count == 1 ? "" : "s"), \(dollars(total)) each.",
                p_options: [option], p_tasks: [], p_costs: [], p_next_steps: ["Everyone approves", "Everyone approves their share"]
            )).execute()
            await loadPlan(id)
        } catch {
            return friendly(error, "Couldn't put the items up for approval.")
        }
        guard let booking = booking(id) else { return nil }
        await createDecision(id, question: booking.question, options: ["Approve", "Not yet"], rule: "unanimous",
                             recommendationId: booking.recommendation.id)
        return nil
    }
}
