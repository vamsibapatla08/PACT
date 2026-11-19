import SwiftUI

/// One pact, which is a group chat. The group talks, Grok writes up the one thing to book as a card,
/// everyone approves it, then everyone approves their share and the coordinator finalises.
struct PactView: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: Pact.ID
    @State private var draft = ""
    @State private var working: String?
    @State private var failure: String?
    @State private var sheet: PactSheet?
    @FocusState private var typing: Bool
    @State private var dictation = Dictation()
    /// What was in the box before talking started, so speech adds to it instead of replacing it.
    @State private var beforeTalking = ""

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
            // The system bar's touch area reaches over the floating Grok button on iOS 26, so the pact draws its own.
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top) {
                VStack(spacing: 10) {
                    topBar(pact, step: step)
                    faces
                    FloatingStep(step: step, hasGrok: !(store.recommendations[id] ?? []).isEmpty,
                                 working: working, failure: failure, act: { act(step) }, decline: decline)
                    ActionBar(busy: working != nil) { use($0) }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 4).padding(.horizontal, 16).padding(.bottom, 18)
                // Solid behind the buttons, then a long eased fade into the backdrop well below them, so there's no edge.
                .background(alignment: .top) {
                    LinearGradient(stops: [
                        .init(color: .black.opacity(0.96), location: 0),
                        .init(color: .black.opacity(0.92), location: 0.45),
                        .init(color: .black.opacity(0.7), location: 0.6),
                        .init(color: .black.opacity(0.4), location: 0.75),
                        .init(color: .black.opacity(0.15), location: 0.88),
                        .init(color: .clear, location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                    .padding(.bottom, -220)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
                }
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
                await store.loadItems(id)
                await store.listen(id)
            }
            // Approvals and payments come from other phones, so the pact re-reads itself while it's open. Every
            // 20 seconds, not 6: each read hits the database and the blockchain, and a whole group polling fast
            // overloads the server for everyone.
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
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
                case .person(let member): PersonSheet(id: id, member: member)
                case .grok: GrokSheet()
                case .action(let action): PactActionSheet(id: id, action: action, chain: store.pactSplit[id], plan: store.fundingPlans[id])
                case .booking(let booking): BookingDetail(id: id, booking: booking)
                case .summary(let rec): GrokSummary(recommendation: rec)
                case .addItem: AddItemSheet(id: id)
                }
            }
            .errorAlert()
        }
    }

    // MARK: Header

    /// Back, the pact's name, and the receipt and settings buttons.
    private func topBar(_ pact: Pact, step: PactStep) -> some View {
        HStack(spacing: 10) {
            Button("Back", systemImage: "chevron.left") { dismiss() }
                .labelStyle(.iconOnly).font(.headline.weight(.semibold))
                .frame(width: 44, height: 44).glassCircle()
            Spacer()
            Text(pact.name).font(.headline.weight(.bold)).lineLimit(1)
            Spacer()
            if case .done = step {
                NavigationLink { PactSummaryView(id: id) } label: {
                    Image(systemName: "doc.text").font(.headline).frame(width: 44, height: 44).glassCircle()
                }
                .buttonStyle(.plain)
            }
            Button("Pact settings", systemImage: "gearshape") { sheet = .settings }
                .labelStyle(.iconOnly).font(.headline)
                .frame(width: 44, height: 44).glassCircle()
        }
        .foregroundStyle(.primary)
    }

    /// Everyone in the pact, then Grok, then anyone asked in who hasn't answered, faded. Tap a face for their profile.
    private var faces: some View {
        let people = store.members[id] ?? []
        let asked = (store.joinRequests[id] ?? []).filter { request in !people.contains { $0.userId == request.userId } }
        return HStack(spacing: -10) {
            ForEach(people) { member in
                Button { sheet = .person(member) } label: {
                    Avatar(name: member.name, url: member.avatarUrl, size: 38)
                        .overlay(Circle().strokeBorder(.black, lineWidth: 2))
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
            }
            Button { sheet = .grok } label: {
                GrokMark(size: 38).overlay(Circle().strokeBorder(.black, lineWidth: 2))
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
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
        // Grok keeps one box in the chat: its newest write-up. Older ones are replaced, not stacked.
        let latestRec = store.recommendations[id]?.first
        let items = ((store.messages[id] ?? []).map(Item.message) + (latestRec.map { [Item.booking($0)] } ?? []))
            .sorted { $0.at < $1.at }
        let latest = latestRec?.id
        return VStack(alignment: .leading, spacing: 10) {
            if items.isEmpty {
                Text("Talk it through, then tap Add item for each stay, flight or ticket, or let Grok add them from the chat. Book it when you're ready.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            }
            ForEach(items) { item in
                switch item {
                case .message(let message): bubble(message)
                case .booking(let rec):
                    if rec.options.isEmpty {
                        Button { sheet = .summary(rec) } label: { GrokNote(text: rec.summary) }.buttonStyle(.plain)
                    }
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
            TextField(dictation.listening ? "Listening…" : "Message the group", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .focused($typing)
                .padding(.leading, 18).padding(.vertical, 14)
            Button(dictation.listening ? "Stop" : "Talk", systemImage: dictation.listening ? "stop.fill" : "waveform") {
                if dictation.listening { dictation.stop(); return }
                beforeTalking = draft.isEmpty ? "" : draft + " "
                Task { await dictation.start { draft = beforeTalking + $0 } }
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 16, weight: .semibold))
            .symbolEffect(.variableColor.iterative, isActive: dictation.listening)
            .foregroundStyle(dictation.listening ? AnyShapeStyle(Color.black) : AnyShapeStyle(LinearGradient.pactSilver))
            .frame(width: 36, height: 36)
            .background { if dictation.listening { LiquidMetal(shape: Circle()) } else { Circle().fill(.white.opacity(0.08)) } }
            .padding(.vertical, 6)
            .sensoryFeedback(.impact, trigger: dictation.listening)
            Button("Send", systemImage: "arrow.up") {
                dictation.stop()
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
        .overlay(alignment: .top) {
            if let failure = dictation.failure {
                Text(failure).font(.caption.weight(.semibold)).foregroundStyle(.red).offset(y: -22)
            }
        }
        .onDisappear { dictation.stop() }
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

    /// An action item: Book it, add an item, or Grok's summary. The itinerary lives in Settings.
    private func use(_ action: ChatAction) {
        failure = nil
        switch action {
        case .book:
            if store.items[id]?.isEmpty == false { run("Putting it up to approve…") { await store.bookItems(id) } }
            else { run("Grok is reading the chat…") { await store.askGrokToBook(id) } }
        case .items: sheet = .addItem
        case .summary:
            if let rec = store.recommendations[id]?.first { sheet = .summary(rec) }
            else { run("Grok is summing up…") { await store.askPilot(id, question: summaryQuestion) } }
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
    case settings, grok, addItem, action(PactSplitAction), booking(Booking), person(Member), summary(Recommendation)
    var id: String {
        switch self {
        case .settings: "settings"
        case .grok: "grok"
        case .addItem: "add-item"
        case .summary(let rec): "summary-\(rec.id)"
        case .person(let member): "person-\(member.userId)"
        case .action(let action): action.rawValue
        case .booking(let booking): "booking-\(booking.recommendation.id)"
        }
    }
}

/// The one thing I can do right now, floating at the top like the tab bar: a black capsule for an action,
/// or a quiet glass chip saying what the pact is waiting on.
private struct FloatingStep: View {
    let step: PactStep
    /// Once Grok has written something, Set up with Grok steps aside for the Book it action item.
    let hasGrok: Bool
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
            .contentShape(.capsule)
            .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
    }

    private var action: String? {
        switch step {
        case .talk: hasGrok ? nil : "Set up with Grok"
        case .declined: "Set up with Grok again"
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

/// The action items under the faces: Book it on its own, then Add item and Grok's summary.
enum ChatAction: String, CaseIterable, Identifiable {
    case book, items, summary

    var id: String { rawValue }
    var title: String {
        switch self {
        case .book: "Book it"
        case .items: "Add item"
        default: rawValue.capitalized
        }
    }
    var symbol: String {
        switch self {
        case .book: "sparkles"
        case .items: "plus.square.on.square"
        case .summary: "text.alignleft"
        }
    }
}

let summaryQuestion = "Sum up what our group has agreed so far and what is still missing. Don't suggest places."

/// A row of small glass action items, like mini apps for the chat.
private struct ActionBar: View {
    let busy: Bool
    let use: (ChatAction) -> Void

    var body: some View {
        HStack(spacing: 8) {
                ForEach(ChatAction.allCases) { action in
                    Button { use(action) } label: {
                        VStack(spacing: 5) {
                            Image(systemName: action.symbol)
                                .font(.system(size: 17, weight: .medium))
                                .frame(width: 46, height: 46)
                                .background(action == .book ? AnyShapeStyle(Color.black) : AnyShapeStyle(.white.opacity(0.06)), in: .circle)
                                .overlay { if action == .book { Circle().strokeBorder(LinearGradient.pactSilver.opacity(0.6), lineWidth: 1) } }
                                .foregroundStyle(LinearGradient.pactSilver)
                            Text(action.title).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .frame(width: 58)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy && action == .book)
                    .frame(maxWidth: .infinity)
                }
        }
        .frame(height: 72)
    }
}

/// Add one thing the pact is booking: pick a preset, fill it in, or let Grok add everything from the chat.
private struct AddItemSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: Pact.ID
    @State private var draft = ItemDraft()
    @State private var working: String?
    @State private var failure: String?

    var body: some View {
        let kind = PactKind(rawValue: store.pacts.first { $0.id == id }?.pactType ?? "") ?? .trip
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetTitle(title: "Add item")
                HStack(spacing: 8) {
                    ForEach(kind.presets) { preset in
                        let on = draft.kind == preset
                        Button { draft.kind = preset } label: {
                            VStack(spacing: 6) {
                                Image(systemName: preset.symbol).font(.system(size: 18, weight: .medium))
                                    .frame(width: 48, height: 48)
                                    .foregroundStyle(on ? AnyShapeStyle(Color.black) : AnyShapeStyle(LinearGradient.pactSilver))
                                    .background { if on { LiquidMetal(shape: Circle()) } else { Circle().fill(.white.opacity(0.06)) } }
                                Text(preset.title).font(.caption.weight(.semibold)).foregroundStyle(on ? .primary : .secondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                        .sensoryFeedback(.selection, trigger: on)
                    }
                }
                PactField(label: "What") { TextField(placeholder, text: $draft.title) }
                PactField(label: "Where") { TextField("Optional", text: $draft.location) }
                VStack(alignment: .leading, spacing: 10) {
                    DatesField(on: $draft.hasDates, from: $draft.startsOn, to: $draft.endsOn)
                }
                PactField(label: "Price each") {
                    TextField("$0", value: $draft.priceEach, format: .currency(code: "USD")).keyboardType(.decimalPad)
                }
                PactField(label: "Link") {
                    TextField("Booking link", text: $draft.link)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if let failure { Text(failure).font(.footnote.weight(.semibold)).foregroundStyle(.red) }
                Button(working == "add" ? "Adding…" : "Add \(draft.kind.title.lowercased())") {
                    run("add") { await store.addItem(draft, to: id) }
                }
                .pactAction()
                .disabled(working != nil || draft.title.trimmingCharacters(in: .whitespaces).isEmpty)
                Button { run("grok") { await store.addItemsWithGrok(id) } } label: {
                    HStack(spacing: 8) {
                        if working == "grok" { ProgressView().tint(PactColor.silver) } else { GrokMark(size: 22) }
                        Text(working == "grok" ? "Grok is reading the chat…" : "Add from the chat with Grok")
                    }
                }
                .pactGhost()
                .disabled(working != nil)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear { if let first = kind.presets.first { draft.kind = first } }
    }

    private var placeholder: String {
        switch draft.kind {
        case .stay: "South Congress house"
        case .flight: "Austin to San Antonio"
        case .ticket: "Blockchain summit passes"
        case .dinner: "Team dinner"
        case .other: "Anything else"
        }
    }

    private func run(_ what: String, _ work: @escaping () async -> String?) {
        working = what
        failure = nil
        Task {
            failure = await work()
            working = nil
            if failure == nil { dismiss() }
        }
    }
}

/// Ask more friends into the pact. Anyone already in it or already asked isn't shown.
private struct AddPeopleSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: Pact.ID
    @State private var picked: Set<Friend.ID> = []
    @State private var sending = false

    var body: some View {
        let taken = Set((store.members[id] ?? []).map(\.userId) + (store.joinRequests[id] ?? []).map(\.userId))
        let choices = store.friends.filter { !taken.contains($0.id) }
        VStack(alignment: .leading, spacing: 18) {
            SheetTitle(title: "Add people")
            if choices.isEmpty {
                Text(store.friends.isEmpty ? "Add friends in the Friends tab first." : "All your friends are already in or asked.")
                    .foregroundStyle(.secondary).pactCard()
            } else {
                VStack(spacing: 14) {
                    ForEach(choices) { friend in
                        let on = picked.contains(friend.id)
                        Button {
                            if on { picked.remove(friend.id) } else { picked.insert(friend.id) }
                        } label: {
                            HStack(spacing: 12) {
                                Avatar(name: friend.member.name, url: friend.member.avatarUrl, size: 40)
                                Text(friend.member.name ?? "Someone").font(.body.weight(.semibold))
                                Spacer()
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.title3).foregroundStyle(on ? AnyShapeStyle(LinearGradient.pactSilver) : AnyShapeStyle(.secondary))
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .sensoryFeedback(.selection, trigger: on)
                    }
                }
                .pactCard()
            }
            Spacer()
            Button(sending ? "Asking…" : picked.isEmpty ? "Ask them in" : "Ask \(picked.count) in") {
                sending = true
                Task {
                    await store.invite(store.friends.filter { picked.contains($0.id) }, to: id)
                    sending = false
                    dismiss()
                }
            }
            .pactAction()
            .disabled(picked.isEmpty || sending)
        }
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.medium, .large])
        .errorAlert()
    }
}

/// The pact's items as a list, the total each, and Add item. Long-press an item to remove it.
private struct ItemList: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var adding = false

    var body: some View {
        let list = store.items[id] ?? []
        VStack(alignment: .leading, spacing: 12) {
            if list.isEmpty {
                Text("Nothing added yet.").foregroundStyle(.secondary).pactCard()
            } else {
                VStack(spacing: 14) {
                    ForEach(list) { item in
                        HStack(spacing: 12) {
                            Image(systemName: item.kind.symbol).font(.system(size: 16, weight: .medium))
                                .frame(width: 38, height: 38).background(Circle().fill(.white.opacity(0.06)))
                                .foregroundStyle(LinearGradient.pactSilver)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title).font(.body.weight(.semibold)).lineLimit(1)
                                if let detail = [item.dates, item.location].compactMap({ $0 }).first {
                                    Text(detail).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if item.source == "grok" { GrokMark(size: 18) }
                            Text(item.priceEach.map(dollars) ?? "—").font(.subheadline.weight(.heavy)).monospacedDigit()
                        }
                        .contentShape(.rect)
                        .contextMenu {
                            if let link = item.link.flatMap(URL.init(string:)) { Link(destination: link) { Label("Open link", systemImage: "arrow.up.right") } }
                            Button("Remove", systemImage: "trash", role: .destructive) { Task { await store.removeItem(item, from: id) } }
                        }
                    }
                    if let total = store.itemsTotal(id) {
                        Divider().overlay(.white.opacity(0.1))
                        HStack {
                            Text("Each person pays").font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(dollars(total)).font(.title3.weight(.heavy)).monospacedDigit()
                        }
                    }
                }
                .pactCard()
            }
            Button("Add item", systemImage: "plus") { adding = true }.pactGhost()
        }
        .sheet(isPresented: $adding) { AddItemSheet(id: id) }
    }
}

/// Grok's latest summary on its own page, in short paragraphs, with what's next.
private struct GrokSummary: View {
    let recommendation: Recommendation

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetTitle(title: "")
                HStack(spacing: 10) { GrokMark(size: 34); Text("Grok's summary").font(.title2.weight(.heavy)).silver() }
                ForEach(Array(paragraphs(recommendation.summary).enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                }
                if !recommendation.nextSteps.isEmpty {
                    Text("Next steps").font(.headline).foregroundStyle(.secondary)
                    ForEach(recommendation.nextSteps, id: \.self) { step in
                        Label(step, systemImage: "circle.fill").labelStyle(Bullet())
                    }
                }
            }
            .padding(24)
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// Grok writes one long block. Two sentences a paragraph reads easier on a phone.
func paragraphs(_ text: String) -> [String] {
    var sentences: [String] = []
    text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { sentence, _, _, _ in
        if let sentence = sentence?.trimmingCharacters(in: .whitespaces), !sentence.isEmpty { sentences.append(sentence) }
    }
    return stride(from: 0, to: sentences.count, by: 2).map { sentences[$0..<min($0 + 2, sentences.count)].joined(separator: " ") }
}

/// What Grok said when it couldn't find one thing the group agreed to book.
private struct GrokNote: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GrokMark(size: 30)
            VStack(alignment: .leading, spacing: 4) {
                Text("Grok · Summary").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(text).font(.subheadline).lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
                .frame(maxHeight: .infinity)
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
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

/// People in the pact, anyone asked in who hasn't answered, and the trip's info.
/// The coordinator can take people out until the split is set up, and edit the trip info.
private struct PactSettingsSheet: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var removing: Member?
    @State private var adding = false

    var body: some View {
        let people = store.members[id] ?? []
        let pending = (store.joinRequests[id] ?? []).filter { request in !people.contains { $0.userId == request.userId } }
        let iCoordinate = store.amCoordinator(id)
        let locked = store.fundingPlans[id] != nil || (store.pactSplit[id]?.state ?? "none") != "none"
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SheetTitle(title: "Settings")

                HStack {
                    Text("People").font(.headline).foregroundStyle(.secondary)
                    Spacer()
                    Button("Add people", systemImage: "person.badge.plus") { adding = true }
                        .font(.subheadline.weight(.semibold)).silver()
                }
                VStack(spacing: 16) {
                    ForEach(people) { member in
                        HStack(spacing: 12) {
                            Avatar(name: member.name, url: member.avatarUrl, size: 40)
                            Text(member.userId == store.myId ? "You" : (member.name ?? "Someone")).font(.body.weight(.semibold))
                            Spacer()
                            Text(member.isHost ? "Coordinator" : "Member").font(.subheadline.weight(.semibold))
                                .foregroundStyle(member.isHost ? AnyShapeStyle(LinearGradient.pactSilver) : AnyShapeStyle(.secondary))
                            if iCoordinate && !locked && !member.isHost {
                                Menu {
                                    Button("Remove from pact", systemImage: "person.badge.minus", role: .destructive) { removing = member }
                                } label: {
                                    Image(systemName: "ellipsis").font(.headline).frame(width: 34, height: 34).glassCircle()
                                }
                            }
                        }
                    }
                    ForEach(pending) { request in
                        HStack(spacing: 12) {
                            Avatar(name: request.name, url: request.avatarUrl, size: 40).opacity(0.45)
                            Text(request.name ?? "Someone").font(.body.weight(.semibold)).foregroundStyle(.secondary)
                            Spacer()
                            Label("Pending", systemImage: "clock").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }
                    HStack(spacing: 12) {
                        GrokMark(size: 40)
                        Text("Grok").font(.body.weight(.semibold))
                        Spacer()
                        Text("Planner").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }
                .pactCard()

                Text("Overview").font(.headline).foregroundStyle(.secondary)
                TripInfo(id: id)

                HStack {
                    Text("Itinerary").font(.headline).foregroundStyle(.secondary)
                    Spacer()
                    if let total = store.itemsTotal(id) {
                        Text("\(dollars(total)) each").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }
                ItemList(id: id)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { await store.loadJoinRequests(id); await store.loadItems(id) }
        .sheet(isPresented: $adding) { AddPeopleSheet(id: id) }
        .confirmationDialog("Remove \(firstName(removing?.name)) from this pact?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                if let member = removing { Task { await store.removeMember(member, from: id) } }
            }
        }
        .errorAlert()
    }
}

/// The trip's details and what Grok took from the chat. The coordinator edits them right here.
private struct TripInfo: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    @State private var editing = false
    @State private var draft = PactDetails()
    @State private var saving = false
    @State private var failure: String?

    var body: some View {
        let pact = store.pacts.first { $0.id == id }
        VStack(alignment: .leading, spacing: 16) {
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
                    Button("Edit trip info") {
                        draft = PactDetails(pact)
                        withAnimation(.smooth) { editing = true }
                    }
                    .pactGhost()
                }
            }
        }
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

/// Grok's place in a pact: Grok's logo from the `GrokLogo` asset on black, or a sparkle until the asset is added.
struct GrokMark: View {
    var size: CGFloat = 38

    var body: some View {
        Group {
            if let logo = UIImage(named: "GrokLogo") {
                Image(uiImage: logo).resizable().renderingMode(.template).scaledToFit()
                    .foregroundStyle(.white).padding(size * 0.22)
            } else {
                Image(systemName: "sparkle").font(.system(size: size * 0.45, weight: .bold))
                    .foregroundStyle(LinearGradient.pactSilver)
            }
        }
        .frame(width: size, height: size)
        .background(Color.black, in: .circle)
        .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: 1))
    }
}

/// Someone in the pact: their photo, name, role, the pacts you share, and Add friend if you aren't yet.
private struct PersonSheet: View {
    @Environment(PactStore.self) private var store
    let id: Pact.ID
    let member: Member

    var body: some View {
        let me = member.userId == store.myId
        let shared = store.pacts.filter { pact in store.members[pact.id]?.contains { $0.userId == member.userId } == true }
        let friend = store.addedFriends.contains { $0.userId == member.userId }
        ScrollView {
            VStack(spacing: 22) {
                SheetTitle(title: "")
                Avatar(name: member.name, url: member.avatarUrl, size: 112)
                    .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: 2))
                VStack(spacing: 6) {
                    Text(me ? "You" : (member.name ?? "Someone")).font(.system(size: 28, weight: .heavy)).silver()
                    Label(member.isHost ? "Coordinator" : "Member", systemImage: member.isHost ? "crown.fill" : "person.fill")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text(me ? "Your pacts" : "Pacts you share").font(.headline).foregroundStyle(.secondary)
                    ForEach(shared) { pact in
                        HStack {
                            Text(pact.name).font(.body.weight(.semibold))
                            Spacer()
                            if pact.id == id { Text("This one").font(.caption.weight(.bold)).foregroundStyle(.secondary) }
                        }
                    }
                }
                .pactCard()
                if !me {
                    Label(friend ? "Friends" : "In this pact with you", systemImage: friend ? "person.2.fill" : "person.2")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .padding(24)
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// Grok in Pact: what it does here, how it's connected, and a way into your own Grok.
private struct GrokSheet: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                SheetTitle(title: "")
                GrokMark(size: 112)
                VStack(spacing: 6) {
                    Text("Grok").font(.system(size: 28, weight: .heavy)).silver()
                    Text("Your pact's planner").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 14) {
                    line("text.bubble", "Reads the group chat", "When you tap Set up with Grok, it reads what everyone said.")
                    line("checklist", "Writes up the booking", "The one thing you agreed on, its link, and the price for each person.")
                    line("lock.shield", "Never touches money", "Everyone approves their own share. Grok can't pay or book on its own.")
                }
                .pactCard()
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(PactColor.paid)
                    Text("Connected through Pact. Nothing to set up.").font(.subheadline.weight(.semibold))
                    Spacer()
                }
                .pactCard()
                Link(destination: URL(string: "https://grok.com")!) {
                    Label("Open your own Grok", systemImage: "arrow.up.right")
                }
                .pactGhost()
                Text("Opens Grok, where you can sign in with your own account. Your Grok account isn't linked to Pact.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(24)
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func line(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).frame(width: 24).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
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
