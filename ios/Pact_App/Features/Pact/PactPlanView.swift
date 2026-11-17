import SwiftUI

/// Planning together: everyone taps Agree on what the chat settled, PactPilot offers options with a price
/// per person, and the group votes on them.
struct PactPlanView: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var question = ""
    @State private var asking = false
    @State private var failure: String?

    private let suggestions = ["Give us 3 options with a price per person", "Check our dates, budget and place"]

    var body: some View {
        let decisions = store.decisions[id] ?? []
        let agree = decisions.first { $0.question == agreeQuestion }
        let recommendations = store.recommendations[id] ?? []
        let linked = Set(recommendations.map(\.id))
        let others = decisions.filter { $0.question != agreeQuestion && !($0.recommendationId.map(linked.contains) ?? false) }

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Plan").font(.system(size: 36, weight: .heavy)).silver()

                agreeCard(agree)
                pilotCard

                ForEach(recommendations) { recommendation in
                    RecommendationCard(id: id, recommendation: recommendation,
                                       decision: decisions.first { $0.recommendationId == recommendation.id })
                }

                if !others.isEmpty {
                    Text("Other votes").font(.headline).foregroundStyle(.secondary)
                    ForEach(others) { DecisionCard(id: id, decision: $0).pactCard() }
                }
            }
            .padding(20)
        }
        .refreshable { await store.loadPlan(id) }
        .background(AmbientBackdrop())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await store.loadPlan(id) }
        .errorAlert()
    }

    /// Everyone signs off on the dates, budget, place and people from the chat. Passes only if all agree.
    @ViewBuilder
    private func agreeCard(_ agree: Decision?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Everyone agrees").font(.headline).foregroundStyle(.secondary)
            if let agree, agree.status != "rejected" {
                DecisionCard(id: id, decision: agree, yes: "Agree", no: "Not yet", showQuestion: false)
            } else {
                Text(agree == nil
                     ? "Once the chat has settled dates, budget, place and people, ask everyone to tap Agree."
                     : "Someone said not yet. Keep talking in the chat, then ask again.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button("Ask everyone to agree") { Task { await store.askEveryoneToAgree(id) } }.pactGhost()
            }
        }
        .pactCard()
    }

    private var pilotCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("PactPilot", systemImage: "sparkles").font(.headline).foregroundStyle(.secondary)
            Text("Reads your chat and the pact's budget, then suggests options with a price per person.")
                .font(.subheadline).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button(suggestion) { question = suggestion }
                            .font(.caption.weight(.semibold))
                            .glassChip()
                            .buttonStyle(.plain)
                    }
                }
            }
            TextField("Ask PactPilot about this pact", text: $question, axis: .vertical)
                .lineLimit(1...4)
                .padding(14)
                .pactWell(14)
            if let failure {
                Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red)
            }
            Button(asking ? "PactPilot is thinking…" : "Ask PactPilot") {
                asking = true
                failure = nil
                Task {
                    failure = await store.askPilot(id, question: question)
                    if failure == nil { question = "" }
                    asking = false
                }
            }
            .pactAction()
            .disabled(asking || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Text("PactPilot only suggests. It can't approve anything or move money.").font(.caption).foregroundStyle(.secondary)
        }
        .pactCard()
    }
}

/// One PactPilot answer: its options with a price each, and the group's vote on it.
private struct RecommendationCard: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    let recommendation: Recommendation
    let decision: Decision?
    @State private var starting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(recommendation.summary).font(.body.weight(.semibold))
            ForEach(recommendation.options, id: \.title) { option in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(option.title).font(.headline.weight(.bold))
                        Spacer()
                        if let each = recommendation.perPerson(option) {
                            Text("~\(dollars(each)) each").font(.subheadline.weight(.heavy)).silver()
                        }
                    }
                    Text(option.description).font(.subheadline)
                    Text("Tradeoff: \(option.tradeoff)").font(.caption).foregroundStyle(.secondary)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .pactWell(20)
            }
            if !recommendation.nextSteps.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Next steps").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(recommendation.nextSteps, id: \.self) { Text("• \($0)").font(.subheadline) }
                }
            }
            if let decision, decision.status != "rejected" {
                DecisionCard(id: id, decision: decision, showQuestion: false)
            } else if recommendation.options.count >= 2 {
                Button(starting ? "Starting the vote…" : (decision == nil ? "Put to a vote" : "Vote again")) {
                    starting = true
                    Task { await store.putToVote(recommendation, in: id); starting = false }
                }
                .pactGhost()
                .disabled(starting)
            }
            Text("Prices are PactPilot's estimates, not quotes.").font(.caption).foregroundStyle(.secondary)
        }
        .pactCard()
    }
}

/// A group vote: where it stands, and my two buttons until I've voted.
struct DecisionCard: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    let decision: Decision
    var yes = "Approve"
    var no = "Reject"
    var showQuestion = true
    @State private var voting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showQuestion {
                Text(decision.question).font(.headline.weight(.bold))
                Text(decision.options.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack {
                Text(statusText).font(.subheadline.weight(.bold))
                    .foregroundStyle(decision.status == "approved" ? PactColor.paid : decision.status == "rejected" ? .red : .primary)
                Spacer()
                Text("\(decision.approvals) of \(decision.eligible)").font(.subheadline.weight(.heavy)).contentTransition(.numericText())
            }
            ProgressView(value: decision.eligible > 0 ? Double(decision.approvals) / Double(decision.eligible) : 0)
                .tint(decision.status == "approved" ? PactColor.paid : PactColor.silver)
            if decision.isOpen && decision.myVote == nil {
                HStack(spacing: 10) {
                    Button(no) { cast(false) }.pactGhost()
                    Button(yes) { cast(true) }.pactAction()
                }
                .disabled(voting)
            } else if let mine = decision.myVote {
                Text(mine == "approve" ? "You said \(yes.lowercased())." : "You said \(no.lowercased()).")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .animation(.smooth, value: decision)
        .sensoryFeedback(.success, trigger: decision.status == "approved")
    }

    private var statusText: String {
        switch decision.status {
        case "approved": decision.approvalRule == "unanimous" ? "Everyone agreed" : "Approved"
        case "rejected": "Not agreed"
        default: decision.approvalRule == "unanimous" ? "Waiting for everyone" : "Voting · majority wins"
        }
    }

    private func cast(_ approve: Bool) {
        voting = true
        Task { await store.vote(decision, approve: approve, in: id); voting = false }
    }
}
