import SwiftUI

/// The pact on one page: what the group agreed, where the money went, and a receipt line for each person,
/// with links to check it on Arc.
struct PactSummaryView: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID

    var body: some View {
        let pact = store.pacts.first { $0.id == id }
        let people = store.members[id] ?? []
        let plan = store.fundingPlans[id]
        let chain = store.pactSplit[id]
        let approved = (store.decisions[id] ?? []).filter { $0.status == "approved" }

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Summary").font(.system(size: 36, weight: .heavy)).silver()

                if let pact {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(pact.name).font(.title2.weight(.heavy))
                        if let note = pact.description, !note.isEmpty { Text(note).font(.subheadline) }
                        Text([pact.budget.map { "Budget \(dollars($0))" }, "\(people.count) people"].compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .pactCard()
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("What you agreed").font(.headline).foregroundStyle(.secondary)
                    if approved.isEmpty {
                        Text("Nothing agreed yet. Votes that pass show up here.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(approved) { decision in
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(agreedText(decision)).font(.subheadline.weight(.semibold))
                                Text("\(decision.approvals) of \(decision.eligible) said yes").font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(PactColor.paid)
                        }
                    }
                }
                .pactCard()

                if let plan {
                    PactProgressCard(plan: plan, chain: chain)
                    receipt(plan: plan, chain: chain, people: people)
                } else {
                    Text("No payments set up for this pact yet.").font(.subheadline).foregroundStyle(.secondary).pactCard()
                }
            }
            .padding(20)
        }
        .refreshable { await load() }
        .background(AmbientBackdrop())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if let pact, plan != nil {
                ShareLink(item: receiptText(pact: pact, plan: plan!, chain: chain, people: people)) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .task { await load() }
        .errorAlert()
    }

    private func load() async {
        await store.loadMembers(id)
        await store.loadPlan(id)
        await store.loadPactSplit(id)
    }

    private func agreedText(_ decision: Decision) -> String {
        if decision.question == agreeQuestion { return "Everyone agreed on the plan" }
        guard let summary = store.recommendations[id]?.first(where: { $0.id == decision.recommendationId })?.summary else {
            return decision.question
        }
        return summary
    }

    /// One line per person: paid, refunded or not, and their payment on Arc when it was recorded.
    private func receipt(plan: FundingPlan, chain: PactSplitStatus?, people: [Member]) -> some View {
        let receipts = store.shareReceipts[id] ?? []
        return VStack(alignment: .leading, spacing: 14) {
            Text("Receipt").font(.headline).foregroundStyle(.secondary)
            Text(outcome(plan: plan, chain: chain)).font(.subheadline.weight(.semibold))
            ForEach(people) { member in
                let line = status(of: member, chain: chain, receipts: receipts)
                HStack(spacing: 12) {
                    Avatar(name: member.name, url: member.avatarUrl, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(member.userId == store.myId ? "You" : (member.name ?? "Someone")).font(.body.weight(.semibold))
                        if let hash = receipts.first(where: { $0.userId == member.userId })?.txHash, let url = arcTxURL(hash) {
                            Link(shortAddress(hash), destination: url).font(.caption.monospaced()).silver()
                        }
                    }
                    Spacer()
                    Text(line).font(.subheadline.weight(.bold))
                        .foregroundStyle(line == "Paid" ? PactColor.paid : .secondary)
                }
            }
            Divider().overlay(Color.white.opacity(0.15))
            if let contract = receipts.compactMap(\.contractAddress).first, let url = URL(string: "https://explorer.testnet.arc.io/address/\(contract)") {
                Link(destination: url) {
                    Label("PactSplit \(shortAddress(contract)) on Arc explorer", systemImage: "arrow.up.right.square")
                        .font(.footnote.weight(.semibold))
                }
                .silver()
            }
            Text("Who paid is read live from PactSplit on Arc, not from the app.").font(.caption).foregroundStyle(.secondary)
        }
        .pactCard()
    }

    private func outcome(plan: FundingPlan, chain: PactSplitStatus?) -> String {
        let payee = shortAddress(chain?.payee ?? plan.payeeAddress)
        switch chain?.state {
        case "released": return "Released \(chain?.total.usdc ?? "") USDC to \(payee)."
        case "cancelled": return "Cancelled. Everyone who paid can take their share back."
        case "open": return "\(chain?.sharesPaid ?? 0) of \(chain?.sharesNeeded ?? plan.sharesNeeded) paid so far, going to \(payee)."
        default: return "Not opened on chain yet."
        }
    }

    private func status(of member: Member, chain: PactSplitStatus?, receipts: [ShareReceipt]) -> String {
        let paid = chain?.paid(member.userId) == true
        // The plan gives a share only to members who had a wallet when it was saved.
        if !paid && !receipts.isEmpty && !receipts.contains(where: { $0.userId == member.userId }) { return "No share" }
        if chain?.state == "cancelled" {
            if receipts.first(where: { $0.userId == member.userId })?.status == "refunded" { return "Refunded" }
            return paid ? "Refund to claim" : "Didn't pay"
        }
        return paid ? "Paid" : "Not paid"
    }

    private func receiptText(pact: Pact, plan: FundingPlan, chain: PactSplitStatus?, people: [Member]) -> String {
        let receipts = store.shareReceipts[id] ?? []
        var lines = ["\(pact.name) · Pact receipt", outcome(plan: plan, chain: chain),
                     "\(plan.shareUsdc.formatted(.number.precision(.fractionLength(0...6)))) USDC each", ""]
        for member in people {
            var line = "\(member.name ?? "Someone"): \(status(of: member, chain: chain, receipts: receipts))"
            if let hash = receipts.first(where: { $0.userId == member.userId })?.txHash, let url = arcTxURL(hash) {
                line += " \(url.absoluteString)"
            }
            lines.append(line)
        }
        return lines.joined(separator: "\n")
    }
}
