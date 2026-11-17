import SwiftUI

/// A pact's money on PactSplit: how much is in, who has paid, and the one next step for me.
struct PactMoneyView: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var acting: PactSplitAction?

    var body: some View {
        let people = store.members[id] ?? []
        let amHost = people.contains { $0.userId == store.myId && $0.isHost }
        let plan = store.fundingPlans[id]
        let chain = store.pactSplit[id]
        let actions = nextActions(plan: plan, chain: chain, amHost: amHost)

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Payments").font(.system(size: 36, weight: .heavy)).silver()

                if store.walletLoaded && store.wallet == nil {
                    Text("Make your wallet in the Wallet tab to pay into this pact.")
                        .font(.subheadline).foregroundStyle(.secondary).pactCard()
                }
                if chain?.openedByHost == false {
                    Label("Someone other than the host opened this pact on chain. Don't pay into it.", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)
                        .pactCard()
                }

                if let plan { PactProgressCard(plan: plan, chain: chain) }

                if let chain, chain.state != "none" { paidList(chain, people: people) }

                if amHost && (chain?.state ?? "none") == "none" {
                    FundingPlanForm(id: id, plan: plan)
                } else if plan == nil {
                    Text("The host hasn't set up payments for this pact yet.")
                        .font(.subheadline).foregroundStyle(.secondary).pactCard()
                }
            }
            .padding(20)
        }
        .refreshable { await store.loadPactSplit(id) }
        .background(AmbientBackdrop())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom) {
            if !actions.isEmpty && store.wallet != nil {
                HStack(spacing: 12) {
                    ForEach(actions) { action in
                        if action == .cancel {
                            Button(title(action, chain: chain)) { acting = action }.pactGhost()
                        } else {
                            Button(title(action, chain: chain)) { acting = action }.pactAction()
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 8)
            }
        }
        .sheet(item: $acting) { action in
            PactActionSheet(id: id, action: action, chain: chain, plan: plan)
        }
        .task {
            await store.loadMembers(id)
            await store.loadPactSplit(id)
        }
        .errorAlert()
    }

    /// The same steps the website offers: open it, pay, release once full, cancel, then refunds.
    private func nextActions(plan: FundingPlan?, chain: PactSplitStatus?, amHost: Bool) -> [PactSplitAction] {
        guard plan != nil, let chain else { return [] }
        let iPaid = chain.paid(store.myId)
        let pastDeadline = (chain.deadlineDate ?? .distantFuture) < .now
        switch chain.state {
        case "none":
            return amHost ? [.createPact] : []
        case "open":
            var steps: [PactSplitAction] = []
            if !iPaid && !pastDeadline && chain.sharesPaid < chain.sharesNeeded { steps.append(.payShare) }
            if amHost && chain.funded { steps.append(.release) }
            if amHost || pastDeadline { steps.append(.cancel) }
            return steps
        case "cancelled":
            return iPaid ? [.claimRefund] : []
        default:
            return []
        }
    }

    private func title(_ action: PactSplitAction, chain: PactSplitStatus?) -> String {
        switch action {
        case .createPact: "Open on chain"
        case .payShare: "Pay \(chain?.share.usdc ?? "") USDC"
        case .release: "Release"
        case .cancel: "Cancel"
        case .claimRefund: "Get my refund"
        }
    }

    private func paidList(_ chain: PactSplitStatus, people: [Member]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Who's paid").font(.headline).foregroundStyle(.secondary)
            ForEach(people) { member in
                let status = chain.members.first { $0.userId == member.userId }
                HStack(spacing: 12) {
                    Avatar(name: member.name, url: member.avatarUrl)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(member.userId == store.myId ? "You" : (member.name ?? "Someone")).font(.body.weight(.semibold))
                        if status?.address == nil {
                            Text("No wallet yet").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if status?.paid == true {
                        Label("Paid", systemImage: "checkmark.circle.fill")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(PactColor.paid)
                    } else if let receipts = store.shareReceipts[id], !receipts.isEmpty, !receipts.contains(where: { $0.userId == member.userId }) {
                        Text("No share").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    } else if status?.address != nil {
                        Text(chain.state == "cancelled" ? "Refunded" : chain.state == "released" ? "Didn't pay" : "Owes \(chain.share.usdc)")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .pactCard()
    }
}

/// The silver hero: money in against the goal, the N of M bar, and where the pact stands on chain.
struct PactProgressCard: View {
    let plan: FundingPlan
    let chain: PactSplitStatus?

    var body: some View {
        let state = chain?.state ?? "none"
        let paid = chain?.sharesPaid ?? 0
        let needed = chain?.sharesNeeded ?? plan.sharesNeeded
        let goal = plan.shareUsdc * Double(plan.sharesNeeded)

        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("PactSplit on Base", systemImage: "lock.shield.fill").font(.subheadline.weight(.semibold))
                Spacer()
                Text(stateText(state))
                    .font(.caption.weight(.heavy))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.black.opacity(0.82), in: .capsule)
                    .overlay(Capsule().strokeBorder(.white.opacity(0.15), lineWidth: 0.6))
                    .foregroundStyle(state == "released" || chain?.funded == true ? PactColor.paid : PactColor.silverPale)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(chain.map { $0.state == "none" ? "0" : $0.paidIn.usdc } ?? "0").font(.system(size: 38, weight: .heavy))
                    .contentTransition(.numericText())
                Text("of \(goal.formatted(.number.precision(.fractionLength(0...6)))) USDC").font(.headline.weight(.bold))
            }
            ProgressView(value: chain?.progress ?? 0)
                .tint(.black)
                .scaleEffect(y: 1.6)
            HStack {
                Text("\(paid) of \(needed) paid").font(.subheadline.weight(.bold))
                Spacer()
                if let deadline = chain?.deadlineDate ?? plan.deadlineDate {
                    Text("Due \(deadline.formatted(date: .abbreviated, time: .shortened))").font(.subheadline)
                }
            }
            Text("\(plan.shareUsdc.formatted(.number.precision(.fractionLength(0...6)))) USDC each, paid to \(shortAddress(chain?.payee ?? plan.payeeAddress))")
                .font(.footnote)
        }
        .foregroundStyle(.black)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .liquidMetal()
        .animation(.smooth, value: chain)
    }

    private func stateText(_ state: String) -> String {
        switch state {
        case "open": chain?.funded == true ? "Funded" : "Open"
        case "released": "Released"
        case "cancelled": "Cancelled"
        default: "Not opened"
        }
    }
}

/// The host's plan: each share, the deadline and who gets paid. It can change until it's opened on chain.
private struct FundingPlanForm: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    let plan: FundingPlan?
    @State private var share = ""
    @State private var deadline = Date.now.addingTimeInterval(7 * 24 * 3600)
    @State private var payee = ""
    @State private var saving = false
    @State private var failure: String?

    private var valid: Bool {
        share.range(of: #"^\d+(\.\d{1,6})?$"#, options: .regularExpression) != nil && (Double(share) ?? 0) > 0
            && payee.trimmingCharacters(in: .whitespaces).range(of: #"^0x[0-9a-fA-F]{40}$"#, options: .regularExpression) != nil
            && deadline > .now
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(plan == nil ? "Set up payments" : "Change the plan").font(.headline).foregroundStyle(.secondary)

            field("Each person pays (USDC)") {
                TextField("25.00", text: $share).keyboardType(.decimalPad)
            }
            field("Paid to") {
                HStack {
                    TextField("0x… wallet address", text: $payee)
                        .font(.footnote.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if let mine = store.wallet?.address, payee != mine {
                        Button("Me") { payee = mine }.font(.caption.weight(.bold)).silver()
                    }
                }
            }
            DatePicker("Deadline", selection: $deadline, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                .font(.subheadline.weight(.semibold))

            if let failure {
                Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red)
            }
            Button(saving ? "Saving…" : (plan == nil ? "Save plan" : "Replace plan")) {
                saving = true
                failure = nil
                Task {
                    failure = await store.saveFundingPlan(id, shareUsdc: share, deadline: deadline, payee: payee)
                    saving = false
                }
            }
            .pactGhost()
            .disabled(!valid || saving || store.wallet == nil)
            Text("Everyone with a wallet gets one share. Open it on chain once the plan is right.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .pactCard()
        .onAppear {
            guard let plan, share.isEmpty else { return }
            share = plan.shareUsdc.formatted(.number.precision(.fractionLength(0...6)).grouping(.never).locale(Locale(identifier: "en_US")))
            payee = plan.payeeAddress
            if let date = plan.deadlineDate, date > .now { deadline = date }
        }
    }

    private func field(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            content()
                .padding(14)
                .pactWell(14)
        }
    }
}

/// One PactSplit step: what the PIN approves, the PIN, Base confirming it, and the receipt.
struct PactActionSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: Pact.ID
    let action: PactSplitAction
    let chain: PactSplitStatus?
    let plan: FundingPlan?
    @State private var step: String?
    @State private var outcome: ActionOutcome?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text(heading).font(.system(size: 30, weight: .heavy)).silver()
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .glassCircle()
                    .disabled(step != nil)
            }
            if let outcome { done(outcome) } else { confirm }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(step != nil)
    }

    private var heading: String {
        switch action {
        case .createPact: "Start collecting"
        case .payShare: "Approve your share"
        case .release: "Finalise and book"
        case .cancel: "Cancel pact"
        case .claimRefund: "Get your refund"
        }
    }

    private var share: String {
        if let chain, chain.state != "none" { return chain.share.usdc }
        return plan.map { $0.shareUsdc.formatted(.number.precision(.fractionLength(0...6))) } ?? ""
    }

    private var each: String { dollars(Double(share) ?? 0) }
    private var total: String { dollars(Double(chain?.total.usdc ?? "") ?? (plan.map { $0.shareUsdc * Double($0.sharesNeeded) } ?? 0)) }

    /// What the PIN will approve, said plainly before Circle's screen opens.
    private var summary: String {
        switch action {
        case .createPact: "Starts collecting \(each) from each of \(plan?.sharesNeeded ?? 0) people, paid to you. The split can't change after this."
        case .payShare: "You send \(each) for the booking. It's held until the coordinator finalises, and comes back to you if the pact is cancelled."
        case .release: "Takes the \(total) everyone paid, so you can book it."
        case .cancel: "Stops the pact. Everyone who paid can take their \(each) back."
        case .claimRefund: "Sends your \(each) back to you."
        }
    }

    @ViewBuilder
    private var confirm: some View {
        Text(summary).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true).pactCard()
        if action == .payShare || action == .claimRefund {
            Text(each).font(.system(size: 56, weight: .heavy))
                .frame(maxWidth: .infinity)
        }
        Spacer(minLength: 8)
        if let step {
            HStack(spacing: 10) {
                ProgressView().tint(PactColor.silver)
                Text(step).font(.headline)
            }
            .frame(maxWidth: .infinity)
        }
        Button(step == nil ? "Approve with PIN" : "Working…") { run() }
            .pactAction()
            .disabled(step != nil)
    }

    private func run() {
        step = "Checking…"
        Task {
            let result = await store.runPactAction(action, in: id) { step = $0 }
            step = nil
            withAnimation(.smooth) { outcome = result }
        }
    }

    private var doneText: String {
        switch action {
        case .createPact: "Collecting. Everyone can approve their share now."
        case .payShare: "Your share is in, confirmed on chain."
        case .release: "The money is yours to book it."
        case .cancel: "Cancelled. Payers can take their share back."
        case .claimRefund: "Your refund is back in your wallet."
        }
    }

    @ViewBuilder
    private func done(_ outcome: ActionOutcome) -> some View {
        Spacer()
        VStack(spacing: 14) {
            switch outcome {
            case .confirmed(let txHash):
                Image(systemName: "checkmark.circle.fill").font(.system(size: 72)).foregroundStyle(PactColor.paid)
                    .symbolEffect(.bounce, value: true)
                Text("Done").font(.title.weight(.heavy))
                Text(doneText).foregroundStyle(.secondary)
                if let txHash, let url = arcTxURL(txHash) {
                    Link(destination: url) {
                        Label("Check it on chain", systemImage: "arrow.up.right.square")
                            .font(.footnote.monospaced().weight(.semibold))
                    }
                    .silver()
                }
            case .pending:
                Image(systemName: "clock.fill").font(.system(size: 64)).silver()
                Text("On its way").font(.title.weight(.heavy))
                Text("It's still confirming. Check back in a minute.").foregroundStyle(.secondary)
            case .failed(let reason):
                Image(systemName: "xmark.circle.fill").font(.system(size: 64)).foregroundStyle(.red)
                Text("Didn't go through").font(.title.weight(.heavy))
                Text(reason).foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .sensoryFeedback(.success, trigger: { if case .confirmed = outcome { true } else { false } }())
        Spacer()
        if case .failed = outcome {
            Button("Try again") { withAnimation(.smooth) { self.outcome = nil } }.pactGhost()
        }
        Button("Done") { dismiss() }.pactAction()
    }
}
