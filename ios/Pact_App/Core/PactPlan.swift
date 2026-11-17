import SwiftUI
import Supabase

/// One idea PactPilot offers.
struct PilotOption: Hashable, Codable {
    var title: String
    var description: String
    var tradeoff: String
    var pricePerPerson: Double?
    var link: String?

    enum CodingKeys: String, CodingKey { case title, description, tradeoff, pricePerPerson = "price_per_person", link }
}

/// One cost PactPilot estimates. Shared costs count for every option, the rest for the option they name.
struct PilotCost: Hashable, Codable {
    var item: String
    var estimatedAmount: Double
    var currency: String?
    var perPersonAmount: Double?
    var optionTitle: String?
    var isShared: Bool?

    enum CodingKeys: String, CodingKey {
        case item, currency, estimatedAmount = "estimated_amount", perPersonAmount = "per_person_amount"
        case optionTitle = "option_title", isShared = "is_shared"
    }
}

struct PilotTask: Hashable, Codable {
    var title: String
    var ownerSuggestion: String?
    var dueHint: String?

    enum CodingKeys: String, CodingKey { case title, ownerSuggestion = "owner_suggestion", dueHint = "due_hint" }
}

/// What `pactpilot` sends back, and the shape `save_pact_recommendation` keeps.
struct PilotAnswer: Codable {
    var summary: String
    var options: [PilotOption]
    var tasks: [PilotTask]?
    var costs: [PilotCost]?
    var nextSteps: [String]?

    enum CodingKeys: String, CodingKey { case summary, options, tasks, costs, nextSteps = "next_steps" }
}

/// A row in `pact_recommendations`: a PactPilot answer the group can vote on.
struct Recommendation: Identifiable, Hashable, Decodable {
    let id: UUID
    var summary: String
    var options: [PilotOption]
    var costs: [PilotCost]
    var nextSteps: [String]
    var createdAt: String

    enum CodingKeys: String, CodingKey {
        case id = "recommendation_id", summary, options, costs, nextSteps = "next_steps", createdAt = "created_at"
    }

    /// Shared costs plus this option's own, per person. Nil when PactPilot didn't know the group size.
    func perPerson(_ option: PilotOption) -> Double? {
        let counted = costs.filter { $0.isShared == true || $0.optionTitle == nil || $0.optionTitle == option.title }
        let amounts = counted.compactMap(\.perPersonAmount)
        guard !amounts.isEmpty, amounts.count == counted.count else { return nil }
        return amounts.reduce(0, +)
    }
}

/// A row in `pact_decisions`, with its vote counts and my vote.
struct Decision: Identifiable, Hashable, Decodable {
    let id: UUID
    var recommendationId: UUID?
    var question: String
    var options: [String]
    /// `majority`, `unanimous` or `host`.
    var approvalRule: String
    /// `open`, `approved` or `rejected`.
    var status: String
    var createdAt: String
    var approvals = 0
    var rejects = 0
    var eligible = 0
    var myVote: String?

    var isOpen: Bool { status == "open" }

    enum CodingKeys: String, CodingKey {
        case id = "decision_id", recommendationId = "recommendation_id", question, options
        case approvalRule = "approval_rule", status, createdAt = "created_at"
    }
}

/// One share's row from `get_pact_payment_status`, for the receipt.
struct ShareReceipt: Hashable, Decodable {
    var userId: UUID?
    var status: String?
    var amountUsdc: Double?
    var txHash: String?
    var paidAt: String?
    var contractAddress: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id", status = "share_status", amountUsdc = "amount_usdc", txHash = "tx_hash"
        case paidAt = "paid_at", contractAddress = "contract_address"
    }
}

/// The question that asks the group to sign off on what they talked about.
let agreeQuestion = "Agree on the plan?"

/// Planning together: PactPilot's options with a price each, group votes, and everyone tapping Agree.
/// Same tables and functions as the website's PactPilot and PactDecide.
extension PactStore {
    func loadPlan(_ id: Pact.ID) async {
        do {
            let recs: [Recommendation] = try await client.from("pact_recommendations")
                .select("recommendation_id, summary, options, costs, next_steps, created_at")
                .eq("pact_id", value: id)
                .order("created_at", ascending: false)
                .execute().value
            var rows: [Decision] = try await client.from("pact_decisions")
                .select("decision_id, recommendation_id, question, options, approval_rule, status, created_at")
                .eq("pact_id", value: id)
                .order("created_at", ascending: false)
                .execute().value

            struct Count: Decodable { let decision_id: UUID; let approve_count: Int; let reject_count: Int; let eligible_count: Int }
            struct Vote: Decodable { let decision_id: UUID; let vote: String }
            let counts: [Count] = try await client.rpc("get_pact_decision_counts", params: ["p_pact_id": id]).execute().value
            var votes: [Vote] = []
            if let myId, !rows.isEmpty {
                votes = try await client.from("pact_decision_votes")
                    .select("decision_id, vote")
                    .eq("user_id", value: myId)
                    .in("decision_id", values: rows.map(\.id))
                    .execute().value
            }
            for index in rows.indices {
                if let count = counts.first(where: { $0.decision_id == rows[index].id }) {
                    rows[index].approvals = count.approve_count
                    rows[index].rejects = count.reject_count
                    rows[index].eligible = count.eligible_count
                }
                rows[index].myVote = votes.first { $0.decision_id == rows[index].id }?.vote
            }
            withAnimation(.smooth) {
                recommendations[id] = recs
                decisions[id] = rows
            }
        } catch {
            self.error = friendly(error, "Couldn't load the plan.")
        }
    }

    /// Asks PactPilot, with the group's latest chat so it plans from what everyone said, then saves the answer
    /// so the whole group sees it. Returns an error message, or nil.
    func askPilot(_ id: Pact.ID, question: String) async -> String? {
        let asked = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !asked.isEmpty else { return nil }
        if messages[id] == nil { await loadMessages(id) }
        do {
            let answer: PilotAnswer = try await invoke("pactpilot", ["pact_id": key(id), "question": withChat(asked, in: id)])
            struct Params: Encodable {
                let p_pact_id: UUID; let p_summary: String; let p_options: [PilotOption]
                let p_tasks: [PilotTask]; let p_costs: [PilotCost]; let p_next_steps: [String]
            }
            try await client.rpc("save_pact_recommendation", params: Params(
                p_pact_id: id, p_summary: answer.summary, p_options: answer.options,
                p_tasks: answer.tasks ?? [], p_costs: answer.costs ?? [], p_next_steps: answer.nextSteps ?? []
            )).execute()
            await loadPlan(id)
            return nil
        } catch let failure as FunctionFailure {
            return failure.message
        } catch {
            return friendly(error, "PactPilot couldn't answer that. Try again.")
        }
    }

    /// The question, after as much of the newest chat as fits in PactPilot's 2,000 characters.
    func withChat(_ question: String, in id: Pact.ID) -> String {
        let tail = "\n\nQuestion: \(question)"
        var lines: [String] = []
        var room = 2000 - tail.count - 40
        for message in (messages[id] ?? []).reversed() {
            let line = "\(name(of: message.senderId, in: id)): \(message.body)"
            guard line.count + 1 <= room else { break }
            lines.insert(line, at: 0)
            room -= line.count + 1
        }
        guard !lines.isEmpty else { return String(question.prefix(2000)) }
        return "Our group chat so far:\n" + lines.joined(separator: "\n") + tail
    }

    /// Puts PactPilot's options to the group. Majority wins, like on the website.
    func putToVote(_ recommendation: Recommendation, in id: Pact.ID) async {
        await createDecision(id, question: "Approve recommendation: \(recommendation.summary)",
                             options: recommendation.options.map(\.title), rule: "majority",
                             recommendationId: recommendation.id)
    }

    /// Asks everyone to tap Agree on what the chat settled. It passes only when every member agrees.
    func askEveryoneToAgree(_ id: Pact.ID) async {
        await createDecision(id, question: agreeQuestion, options: ["Agree", "Not yet"], rule: "unanimous", recommendationId: nil)
    }

    func createDecision(_ id: Pact.ID, question: String, options: [String], rule: String, recommendationId: UUID?) async {
        struct Params: Encodable {
            let p_pact_id: UUID; let p_question: String; let p_options: [String]
            let p_approval_rule: String; let p_recommendation_id: UUID?
        }
        do {
            try await client.rpc("create_pact_decision", params: Params(
                p_pact_id: id, p_question: question, p_options: options,
                p_approval_rule: rule, p_recommendation_id: recommendationId
            )).execute()
            await loadPlan(id)
        } catch {
            self.error = friendly(error, "Couldn't start the vote.")
        }
    }

    /// One vote each, and it can't be changed.
    func vote(_ decision: Decision, approve: Bool, in id: Pact.ID) async {
        do {
            try await client.rpc("cast_pact_decision_vote", params: [
                "p_decision_id": decision.id.uuidString.lowercased(), "p_vote": approve ? "approve" : "reject",
            ]).execute()
            await loadPlan(id)
        } catch {
            self.error = friendly(error, "Your vote didn't count. Try again.")
        }
    }
}
