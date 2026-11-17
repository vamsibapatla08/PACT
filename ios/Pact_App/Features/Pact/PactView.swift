import SwiftUI

/// One pact, which is a group chat. The group talks, Grok writes up the one thing to book as a card,
/// everyone approves it, then everyone approves their share and the coordinator finalises.
struct PactView: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var draft = ""
    @State private var working: String?
    @State private var failure: String?
    @State private var sheet: PactSheet?

    var body: some View {
        if let pact = store.pacts.first(where: { $0.id == id }) {
            let step = store.step(id)
            ScrollView {
                thread
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .background(AmbientBackdrop())
            .navigationTitle(pact.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                if case .done = step {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink { PactSummaryView(id: id) } label: { Image(systemName: "doc.text") }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Pact settings", systemImage: "gearshape") { sheet = .settings }
                }
            }
            .safeAreaInset(edge: .top) {
                VStack(spacing: 10) {
                    FloatingStep(step: step, working: working, failure: failure, act: { act(step) }, decline: decline)
                    faces
                    DetailChips(pact: pact) { sheet = .info }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 4).padding(.horizontal, 16).padding(.bottom, 6)
            }
            .safeAreaInset(edge: .bottom) {
                composer.padding(.horizontal, 12).padding(.bottom, 8)
            }
            .onAppear { store.inChat = true }
            .onDisappear { store.inChat = false }
            .animation(.smooth, value: step)
            .task {
                await store.loadMembers(id)
                await store.loadMessages(id)
                await store.loadPlan(id)
                await store.loadPactSplit(id)
                await store.loadJoinRequests(id)
                await store.listen(id)
            }
            // Approvals and payments come from other phones, so the pact re-reads itself while it's open.
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(6))
                    await store.loadPlan(id)
                    await store.loadPactSplit(id)
                }
            }
            // Once everyone approves, the coordinator's phone saves the split without being asked.
            .task(id: step) {
                guard step == .settingUp, working == nil else { return }
                working = "Setting up the split…"
                failure = await store.setUpSplit(id)
                working = nil
            }
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .settings: PactSettingsSheet(id: id)
                case .info: PactInfoSheet(id: id)
                case .action(let action): PactActionSheet(id: id, action: action, chain: store.pactSplit[id], plan: store.fundingPlans[id])
                case .booking(let booking): BookingDetail(id: id, booking: booking)
                }
            }
            .errorAlert()
        }
    }

    // MARK: Header

    /// Everyone in the pact, then Grok, then anyone asked in who hasn't answered, faded.
    private var faces: some View {
        let people = store.members[id] ?? []
        let asked = (store.joinRequests[id] ?? []).filter { request in !people.contains { $0.userId == request.userId } }
        return HStack(spacing: -10) {
            ForEach(people) { member in
                Avatar(name: member.name, url: member.avatarUrl, size: 38)
                    .overlay(Circle().strokeBorder(.black, lineWidth: 2))
            }
            GrokMark(size: 38).overlay(Circle().strokeBorder(.black, lineWidth: 2))
            ForEach(asked) { request in
                Avatar(name: request.name, url: request.avatarUrl, size: 38).opacity(0.35)
                    .overlay(Circle().strokeBorder(.black, lineWidth: 2))
            }
        }
    }

    // MARK: Thread

    private enum Item: Identifiable {
        case message(Message), booking(Recommendation)
        var id: String {
            switch self {
            case .message(let m): "m\(m.id)"
            case .booking(let r): "r\(r.id)"
            }
        }
        var at: String {
            switch self {
            case .message(let m): m.createdAt
            case .booking(let r): r.createdAt
            }
        }
    }

    private var thread: some View {
        let items = ((store.messages[id] ?? []).map(Item.message) + (store.recommendations[id] ?? []).map(Item.booking))
            .sorted { $0.at < $1.at }
        let latest = store.recommendations[id]?.first?.id
        return VStack(alignment: .leading, spacing: 10) {
            if items.isEmpty {
                Text("Agree on what you're booking. Paste the link and the price. When everyone's happy, tap Set up with Grok.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            }
            ForEach(items) { item in
                switch item {
                case .message(let message): bubble(message)
                case .booking(let rec):
                    if let option = rec.options.first {
                        let booking = Booking(recommendation: rec, option: option, people: max(1, store.members[id]?.count ?? 1))
                        Button { sheet = .booking(booking) } label: {
                            BookingRow(booking: booking, consent: store.consent(id, for: booking))
                        }
                        .buttonStyle(.plain)
                        .opacity(rec.id == latest ? 1 : 0.55)
                        if rec.id == latest, store.fundingPlans[id] != nil || (store.pactSplit[id]?.state ?? "none") != "none" {
                            SplitCard(id: id)
                        }
                    }
                }
            }
        }
        .animation(.smooth, value: items.count)
    }

    private func bubble(_ message: Message) -> some View {
        let mine = message.senderId == store.myId
        return VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if !mine {
                Text(store.name(of: message.senderId, in: id)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            Text(message.body)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .foregroundStyle(mine ? .black : .primary)
                .background { if mine { LiquidMetal(shape: RoundedRectangle(cornerRadius: 20, style: .continuous)) } }
                .glassEffect(mine ? .identity : .regular, in: .rect(cornerRadius: 20))
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }

    /// A message box like a chatbot's: one rounded field that grows as you type, with send inside it.
    private var composer: some View {
        let empty = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(alignment: .bottom, spacing: 8) {
            TextField("Message the group", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .padding(.leading, 18).padding(.vertical, 14)
            Button("Send", systemImage: "arrow.up") {
                let text = draft
                draft = ""
                Task { await store.send(id, text: text) }
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(empty ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.black))
            .frame(width: 36, height: 36)
            .background { if empty { Circle().fill(.white.opacity(0.08)) } else { LiquidMetal(shape: Circle()) } }
            .padding(6)
            .disabled(empty)
            .animation(.snappy(duration: 0.15), value: empty)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }

    // MARK: Actions

    private func act(_ step: PactStep) {
        failure = nil
        switch step {
        case .talk, .declined:
            run("Grok is reading the chat…") { await store.askGrokToBook(id) }
        case .approve(let decision):
            run(store.wallet == nil ? "Set your PIN…" : "Approving…") { await store.approve(decision, in: id); return nil }
        case .needsWallet:
            run("Set your PIN…") { await store.createWallet(); return nil }
        case .startCollecting: sheet = .action(.createPact)
        case .pay: sheet = .action(.payShare)
        case .finalise: sheet = .action(.release)
        default: break
        }
    }

    private func decline() {
        guard case .approve(let decision) = store.step(id) else { return }
        run("Saying not yet…") { await store.vote(decision, approve: false, in: id); return nil }
    }

    private func run(_ label: String, _ work: @escaping () async -> String?) {
        working = label
        Task {
            failure = await work()
            working = nil
        }
    }
}

/// One sheet at a time: the pact's settings, or a PIN step.
private enum PactSheet: Identifiable {
    case settings, info, action(PactSplitAction), booking(Booking)
    var id: String {
        switch self {
        case .settings: "settings"
        case .info: "info"
        case .action(let action): action.rawValue
        case .booking(let booking): "booking-\(booking.recommendation.id)"
        }
    }
}

/// The one thing I can do right now, floating at the top like the tab bar: a black capsule for an action,
/// or a quiet glass chip saying what the pact is waiting on.
private struct FloatingStep: View {
    let step: PactStep
    let working: String?
    let failure: String?
    let act: () -> Void
    let decline: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            if let working {
                capsule { ProgressView().tint(PactColor.silver); Text(working) }
            } else if let action {
                HStack(spacing: 8) {
                    Button(action: act) {
                        capsule {
                            if step == .talk || step == .declined { Image(systemName: "sparkle") }
                            Text(action)
                        }
                    }
                    .buttonStyle(.plain)
                    if case .approve = step {
                        Button("Not yet", action: decline)
                            .font(.subheadline.weight(.bold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 16).padding(.vertical, 13)
                            .glassEffect(.regular.interactive(), in: .capsule)
                    }
                }
            } else if let text {
                Text(text)
                    .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(Color.black.opacity(0.8), in: .capsule)
            }
            if let failure {
                Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .sensoryFeedback(.impact, trigger: working != nil)
    }

    private func capsule(@ViewBuilder _ content: () -> some View) -> some View {
        HStack(spacing: 8) { content() }
            .font(.headline.weight(.bold))
            .foregroundStyle(LinearGradient.pactSilver)
            .padding(.horizontal, 22).padding(.vertical, 13)
            .background(Color.black, in: .capsule)
            .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
    }

    private var action: String? {
        switch step {
        case .talk, .declined: "Set up with Grok"
        case .approve: "Approve"
        case .needsWallet: "Set my PIN to collect"
        case .startCollecting: "Start collecting"
        case .pay(let amount): "Approve \(dollars(amount))"
        case .finalise(let total): "Finalise and book · \(dollars(total))"
        default: nil
        }
    }

    private var text: String? {
        switch step {
        case .waitingApprovals(let approved, let of): "You approved · \(approved) of \(of)"
        case .settingUp: "Setting up the split"
        case .waitSetup(let host): "Waiting for \(host) to set up the split"
        case .waitStart(let host): "Waiting for \(host) to start collecting"
        case .waitPay(let paid, let of): "You're in · \(paid) of \(of) paid"
        case .waitFinalise(let host): "Everyone's paid · waiting for \(host)"
        case .done(let total, let host): "Done · \(dollars(total)) to \(host)"
        case .cancelled: "Cancelled · everyone can take their share back"
        default: nil
        }
    }
}

/// Grok's write-up in the chat, on one line: who wrote it, where it's up to, what it is and the price. Tap for the rest.
private struct BookingRow: View {
    let booking: Booking
    let consent: Decision?

    var body: some View {
        HStack(spacing: 12) {
            GrokMark(size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text("Grok · \(status)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(booking.option.title).font(.headline.weight(.bold)).lineLimit(1)
            }
            Spacer(minLength: 8)
            if let each = booking.perPerson {
                Text(dollars(each)).font(.headline.weight(.heavy)).monospacedDigit()
            }
            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }

    private var status: String {
        guard let consent else { return "Wrote this up" }
        switch consent.status {
        case "approved": return "Everyone approved"
        case "rejected": return "Not yet"
        default: return "Approving · \(consent.approvals) of \(consent.eligible)"
        }
    }
}

/// Everything Grok wrote about the booking, in sections. Swipe down or tap Back to close.
private struct BookingDetail: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: Pact.ID
    let booking: Booking

    var body: some View {
        let consent = store.consent(id, for: booking)
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Button { dismiss() } label: {
                    Label("Back", systemImage: "chevron.left").font(.headline.weight(.semibold))
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) { GrokMark(size: 26); Text("Grok").font(.subheadline.weight(.heavy)) }
                    Text(booking.option.title).font(.system(size: 32, weight: .heavy)).silver()
                    if let each = booking.perPerson {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(dollars(each)).font(.system(size: 44, weight: .heavy))
                            Text("each").font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        Text("\(booking.people) people · \(dollars(booking.total ?? 0)) in total")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }

                section("What it is") { Text(booking.option.description) }
                if !booking.option.tradeoff.isEmpty { section("Worth knowing") { Text(booking.option.tradeoff) } }
                section("Grok's summary") {
                    ForEach(Array(paragraphs(booking.recommendation.summary).enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                    }
                }
                if !booking.recommendation.nextSteps.isEmpty {
                    section("Next steps") {
                        ForEach(booking.recommendation.nextSteps, id: \.self) { step in
                            Label(step, systemImage: "circle.fill").labelStyle(Bullet())
                        }
                    }
                }
                if let consent {
                    section("Approvals") {
                        Text(consent.status == "approved" ? "Everyone approved." : "\(consent.approvals) of \(consent.eligible) have approved.")
                    }
                }
                if let link = booking.option.link.flatMap(URL.init(string:)) {
                    Link(destination: link) {
                        Label("Open \(link.host() ?? "the link")", systemImage: "arrow.up.right")
                    }
                    .pactGhost()
                }
            }
            .padding(24)
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 12) { content() }
                .font(.body.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Grok writes one long block. Two sentences a paragraph reads easier on a phone.
    private func paragraphs(_ text: String) -> [String] {
        var sentences: [String] = []
        text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { sentence, _, _, _ in
            if let sentence = sentence?.trimmingCharacters(in: .whitespaces), !sentence.isEmpty { sentences.append(sentence) }
        }
        return stride(from: 0, to: sentences.count, by: 2).map { sentences[$0..<min($0 + 2, sentences.count)].joined(separator: " ") }
    }
}

private struct Bullet: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            configuration.icon.font(.system(size: 6)).foregroundStyle(.secondary)
            configuration.title
        }
    }
}

/// The money for the booking: how much is in, who's approved their share, and who collects it.
private struct SplitCard: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID

    var body: some View {
        let chain = store.pactSplit[id]
        let plan = store.fundingPlans[id]
        let share = chain.map { Double($0.share.usdc) ?? 0 } ?? plan?.shareUsdc ?? 0
        let needed = chain?.sharesNeeded ?? plan?.sharesNeeded ?? 0
        let paid = chain?.sharesPaid ?? 0
        let host = store.coordinator(id)

        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(chain?.state == "released" ? "Paid out" : "The split").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Text("Collected by \(host?.userId == store.myId ? "you" : firstName(host?.name))").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(dollars(share * Double(paid))).font(.system(size: 36, weight: .heavy)).contentTransition(.numericText())
                Text("of \(dollars(share * Double(needed)))").font(.headline.weight(.bold)).foregroundStyle(.secondary)
            }
            ProgressView(value: needed > 0 ? Double(paid) / Double(needed) : 0).tint(PactColor.silver)
            VStack(spacing: 8) {
                ForEach(store.members[id] ?? []) { member in
                    HStack(spacing: 10) {
                        Avatar(name: member.name, url: member.avatarUrl, size: 26)
                        Text(member.userId == store.myId ? "You" : firstName(member.name)).font(.subheadline.weight(.semibold))
                        Spacer()
                        if chain?.paid(member.userId) == true {
                            Label("Approved", systemImage: "checkmark.circle.fill").font(.caption.weight(.heavy)).foregroundStyle(PactColor.paid)
                        } else if let receipts = store.shareReceipts[id], !receipts.isEmpty, !receipts.contains(where: { $0.userId == member.userId }) {
                            Text("No share").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        } else {
                            Text(dollars(share)).font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .pactCard()
        .animation(.smooth, value: chain)
    }
}

/// Who's in the pact and their role. The coordinator collects the money and can hand that role on.
private struct PactSettingsSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: Pact.ID
    @State private var handingTo: Member?

    var body: some View {
        let people = store.members[id] ?? []
        let iCoordinate = store.amCoordinator(id)
        let locked = store.fundingPlans[id] != nil || (store.pactSplit[id]?.state ?? "none") != "none"
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Settings").font(.system(size: 30, weight: .heavy)).silver()
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly).font(.headline).foregroundStyle(.secondary)
                    .frame(width: 36, height: 36).glassCircle()
            }
            Text("Roles").font(.headline).foregroundStyle(.secondary)
            VStack(spacing: 14) {
                ForEach(people) { member in
                    HStack(spacing: 12) {
                        Avatar(name: member.name, url: member.avatarUrl, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.userId == store.myId ? "You" : (member.name ?? "Someone")).font(.body.weight(.semibold))
                            Text(member.isHost ? "Coordinator · collects the money" : "Member").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if member.isHost {
                            Image(systemName: "crown.fill").silver()
                        } else if iCoordinate && !locked {
                            Menu {
                                Button("Make coordinator", systemImage: "crown") { handingTo = member }
                            } label: {
                                Image(systemName: "ellipsis").font(.headline).frame(width: 34, height: 34).glassCircle()
                            }
                        }
                    }
                }
                HStack(spacing: 12) {
                    GrokMark(size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Grok").font(.body.weight(.semibold))
                        Text("Writes up the booking. Never touches money.").font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                }
            }
            .pactCard()
            Text(locked ? "Roles are locked now that the split is set up."
                 : iCoordinate ? "You're the coordinator. You can hand the role to someone else until the split is set up."
                 : "Only the coordinator can change roles.")
                .font(.footnote).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.medium, .large])
        .confirmationDialog("Make \(firstName(handingTo?.name)) the coordinator?", isPresented: Binding(get: { handingTo != nil }, set: { if !$0 { handingTo = nil } }), titleVisibility: .visible) {
            Button("Make coordinator") {
                if let member = handingTo { Task { await store.makeCoordinator(member, in: id) } }
            }
        } message: {
            Text("They'll collect everyone's share and finalise the booking. You become a member.")
        }
        .errorAlert()
    }
}

/// The pact's setup at a glance: what kind of plan, where, when, the budget each, and Info for the rest.
private struct DetailChips: View {
    let pact: Pact
    let openInfo: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(compact: false)
            row(compact: true)
        }
        .frame(maxWidth: .infinity)
    }

    /// Every detail when it fits on one line, otherwise just the kind, the dates and Info.
    private func row(compact: Bool) -> some View {
        let kind = PactKind(rawValue: pact.pactType ?? "") ?? .trip
        return HStack(spacing: 8) {
            chip(kind.title, kind.symbol)
            if !compact, let place = pact.location, !place.isEmpty { chip(place, "mappin") }
            if let dates = dateRange(pact) { chip(dates, "calendar") }
            if !compact, let budget = pact.budget { chip("\(dollars(budget)) each", "dollarsign") }
            Button(action: openInfo) { chip("Info", "info.circle") }.buttonStyle(.plain)
        }
        .fixedSize()
    }

    private func chip(_ text: String, _ symbol: String) -> some View {
        Label(text, systemImage: symbol)
            .font(.caption.weight(.bold))
            .foregroundStyle(LinearGradient.pactSilver)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.black.opacity(0.75), in: .capsule)
    }
}

/// Everything about the pact: its details, what Grok imported from the chat, and who's in.
/// The coordinator can edit the details from here.
private struct PactInfoSheet: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var editing = false
    @State private var draft = PactDetails()
    @State private var saving = false
    @State private var failure: String?

    var body: some View {
        let pact = store.pacts.first { $0.id == id }
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                SheetTitle(title: pact?.name ?? "Info")
                if editing {
                    PactDetailsForm(details: $draft)
                    if let failure { Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red) }
                    HStack(spacing: 10) {
                        Button(saving ? "Saving…" : "Save") {
                            saving = true
                            Task {
                                failure = await store.saveDetails(draft, for: id)
                                saving = false
                                if failure == nil { withAnimation(.smooth) { editing = false } }
                            }
                        }
                        .pactAction().disabled(saving)
                        Button("Cancel") { withAnimation(.smooth) { editing = false } }.pactGhost()
                    }
                } else if let pact {
                    details(pact)
                    if store.amCoordinator(id) {
                        Button("Edit details") {
                            draft = PactDetails(pact)
                            withAnimation(.smooth) { editing = true }
                        }
                        .pactGhost()
                    }
                }
            }
            .padding(24)
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private func details(_ pact: Pact) -> some View {
        let kind = PactKind(rawValue: pact.pactType ?? "") ?? .trip
        VStack(alignment: .leading, spacing: 14) {
            row(kind.symbol, "Kind", kind.title)
            row("text.alignleft", "What it is", pact.description)
            row("mappin", "Where", pact.location)
            row("calendar", "When", dateRange(pact))
            row("dollarsign", "Budget each", pact.budget.map(dollars))
            if let link = pact.link.flatMap(URL.init(string:)) {
                Link(destination: link) {
                    HStack(spacing: 12) {
                        Image(systemName: "link").frame(width: 22).foregroundStyle(.secondary)
                        Text(link.host() ?? link.absoluteString).font(.body.weight(.semibold)).silver()
                        Spacer()
                        Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
                    }
                }
            }
        }
        .pactCard()

        if let booking = store.booking(id) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) { GrokMark(size: 22); Text("From the chat").font(.headline).foregroundStyle(.secondary) }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(booking.option.title).font(.headline.weight(.bold))
                        Spacer()
                        if let each = booking.perPerson { Text("\(dollars(each)) each").font(.subheadline.weight(.heavy)) }
                    }
                    Text(booking.recommendation.summary).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .pactCard()
            }
        }
    }

    private func row(_ symbol: String, _ label: String, _ value: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol).frame(width: 22).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(value?.isEmpty == false ? value! : "Not set").font(.body.weight(.semibold))
                    .foregroundStyle(value?.isEmpty == false ? .primary : .secondary)
            }
        }
    }
}

/// Grok's place in a pact: a dark sparkle in a silver ring.
struct GrokMark: View {
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: "sparkle")
            .font(.system(size: size * 0.45, weight: .bold))
            .foregroundStyle(LinearGradient.pactSilver)
            .frame(width: size, height: size)
            .background(Color.black, in: .circle)
            .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: 1))
    }
}

/// Someone's Google photo from `profiles`, or their first initial on silver.
struct Avatar: View {
    let name: String?
    let url: String?
    var size: CGFloat = 38

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String((name ?? "?").prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .heavy))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(LinearGradient.pactSilver)
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
    }
}
