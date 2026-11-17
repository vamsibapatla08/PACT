import SwiftUI
import CoreImage.CIFilterBuiltins

/// The Wallet tab, the same as the website: the card, copy address and test USDC, then every USDC in and out.
struct WalletView: View {
    @Environment(PactStore.self) private var store
    @State private var ledger: Ledger?
    @State private var ledgerError: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            TabScreen(title: "Wallet") {
                // Nothing shows until the wallet has been checked, so "Create wallet" never flashes.
                if store.walletLoaded {
                    if let wallet = store.wallet {
                        WalletCard(balance: wallet.usdcBalance, address: wallet.address, name: store.profile?.name)
                        addressRow(wallet)
                        Text("Activity").font(.title3.weight(.bold)).foregroundStyle(.white).padding(.top, 6)
                        activity
                    } else {
                        create
                    }
                }
            }
            .refreshable { await store.loadWallet(); await reloadLedger() }
            .task(id: "\(store.wallet?.address ?? "")|\(store.pactSplit.count)|\(store.pacts.count)") { await reloadLedger() }
            .navigationDestination(for: Pact.ID.self) { PactView(id: $0) }
        }
    }

    private func reloadLedger() async {
        guard store.wallet != nil else { return }
        do { ledger = try await store.loadLedger(); ledgerError = nil }
        catch { ledgerError = (error as? FunctionFailure)?.message ?? "The Arc explorer could not be reached. Your balance is still right." }
    }

    private func addressRow(_ wallet: Wallet) -> some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            Text(wallet.shortAddress).font(.caption.monospaced()).foregroundStyle(.white.opacity(0.55)).lineLimit(1).fixedSize()
            Button(copied ? "Copied" : "Copy address") {
                UIPasteboard.general.string = wallet.address
                copied = true
                Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
            }
            .font(.footnote.weight(.semibold)).foregroundStyle(.white)
            .lineLimit(1).fixedSize()
            .padding(.horizontal, 12).padding(.vertical, 7)
            .glassEffect(.regular, in: .capsule)
            Link("Get free test USDC", destination: URL(string: "https://faucet.circle.com")!)
                .font(.footnote.weight(.semibold)).foregroundStyle(.white)
                .lineLimit(1).fixedSize()
                .padding(.horizontal, 12).padding(.vertical, 7)
                .glassEffect(.regular, in: .capsule)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var activity: some View {
        if let ledgerError, ledger == nil {
            VStack(spacing: 10) {
                Text(ledgerError).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Try again") { Task { await reloadLedger() } }.font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity).pactCard()
        } else if let ledger {
            VStack(spacing: 0) {
                if ledger.rows.isEmpty {
                    Text("Money you send and get shows up here.").font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8)
                }
                ForEach(ledger.rows) { row in
                    rowLink(row)
                    Divider().overlay(.white.opacity(0.06))
                }
                if ledger.fees > 0 {
                    HStack(spacing: 12) {
                        icon("sparkles", tint: .white)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Network fees").font(.body.weight(.semibold))
                            Text("Arc charges a tiny fee in USDC for each payment you send").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("−\(ledger.fees.formatted(.number.precision(.fractionLength(4))))").font(.body.weight(.bold)).monospacedDigit()
                    }
                    .padding(.vertical, 10)
                    Divider().overlay(.white.opacity(0.14))
                }
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Balance").font(.title3.weight(.heavy))
                        Text("Everything above, added up").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\((floor(ledger.total * 100) / 100).formatted(.number.precision(.fractionLength(2)))) USDC")
                        .font(.title3.weight(.heavy)).monospacedDigit()
                }
                .padding(.top, 12)
            }
            .pactCard()
        } else {
            ProgressView().tint(PactColor.silver).frame(maxWidth: .infinity).padding(30).pactCard()
        }
    }

    /// A pact payment opens that pact; everything else opens the transaction on the Arc explorer.
    @ViewBuilder private func rowLink(_ row: LedgerRow) -> some View {
        if let id = row.pactId, store.pacts.contains(where: { $0.id == id }) {
            NavigationLink(value: id) { line(row) }.buttonStyle(.plain)
        } else if let url = explorerTx(row.txHash) {
            Link(destination: url) { line(row) }.buttonStyle(.plain)
        } else {
            line(row)
        }
    }

    private func line(_ row: LedgerRow) -> some View {
        let short = "\(row.address.prefix(6))…\(row.address.suffix(4))"
        let pact = row.pactId.flatMap { id in store.pacts.first { $0.id == id } }
        let title: String = switch row.kind {
        case .person: "\(row.incoming ? "From" : "To") \(store.displayName(row.userId!))"
        case .share: "Paid your share into \(pact?.name ?? "a pact")"
        case .payout: "Paid out from \(pact?.name ?? "a pact")"
        case .deposit: "Test USDC added"
        case .address: "Sent to \(short)"
        }
        let when = row.at.formatted(.dateTime.month(.abbreviated).day().hour().minute())
        let detail = row.kind == .deposit ? "\(when) · from \(short)" : pact != nil ? "\(when) · open the pact" : when
        return HStack(spacing: 12) {
            if row.kind == .person, let user = row.userId {
                Avatar(name: store.displayName(user), url: store.avatarUrl(user), size: 40)
            } else if let pact {
                Image(systemName: (PactKind(rawValue: pact.pactType ?? "") ?? .trip).symbol)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(.black)
                    .frame(width: 40, height: 40).background(Circle().fill(LinearGradient.pactSilver))
            } else {
                icon(row.incoming ? "arrow.up" : "arrow.down", tint: row.incoming ? PactColor.paid : .white)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold)).lineLimit(2)
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Text("\(row.incoming ? "+" : "−")\(row.amount.formatted(.number.precision(.fractionLength(2))))")
                .font(.body.weight(.bold)).monospacedDigit()
                .foregroundStyle(row.incoming ? PactColor.paid : .white)
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
    }

    private func icon(_ symbol: String, tint: Color) -> some View {
        Image(systemName: symbol).font(.system(size: 15, weight: .bold)).foregroundStyle(tint)
            .frame(width: 40, height: 40)
            .background(Circle().fill(tint == PactColor.paid ? PactColor.paid.opacity(0.22) : .white.opacity(0.1)))
    }

    private var create: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Arc Testnet", systemImage: "wallet.bifold").font(.subheadline.weight(.semibold))
            Text("Make a wallet so you can send and get test USDC. Circle keeps it safe with your own PIN.")
                .font(.subheadline)
            Button {
                Task { await store.createWallet() }
            } label: {
                HStack {
                    if store.walletBusy { ProgressView().tint(PactColor.silver) }
                    Text(store.walletBusy ? "Setting up…" : "Create wallet")
                }
                .font(.headline.weight(.bold))
                .silver()
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(.black, in: .capsule)
            }
            .buttonStyle(.plain)
            .disabled(store.walletBusy)
        }
        .foregroundStyle(.black)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .liquidMetal()
    }
}

/// Send: pick a friend, type an amount, confirm with the PIN, then watch it land.
struct SendSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var to: Friend?
    @State private var amount = ""
    @State private var step: String?
    @State private var outcome: SendOutcome?

    private var value: Double { Double(amount) ?? 0 }
    private var canSend: Bool {
        to != nil && amount.range(of: #"^\d+(\.\d{1,6})?$"#, options: .regularExpression) != nil
            && value > 0 && value <= (store.wallet?.balance ?? 0) && step == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Send").font(.system(size: 30, weight: .heavy)).silver()
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .glassCircle()
                    .disabled(step != nil)
            }

            if let outcome { done(outcome) } else { form }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .interactiveDismissDisabled(step != nil)
    }

    @ViewBuilder
    private var form: some View {
        let friends = store.friends
        Text("To").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        if friends.isEmpty {
            Text("Join a pact with someone to send them money.").foregroundStyle(.secondary).pactCard()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(friends) { friend in
                        let picked = to?.id == friend.id
                        Button { to = friend } label: {
                            VStack(spacing: 6) {
                                Avatar(name: friend.member.name, url: friend.member.avatarUrl, size: 56)
                                    .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: picked ? 3 : 0))
                                Text(friend.member.name?.split(separator: " ").first.map(String.init) ?? "Someone")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(picked ? .primary : .secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        }

        VStack(spacing: 6) {
            // The amount comes from Pact's own keypad, so it works without the system keyboard
            // and always uses a "." whatever the phone's region.
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(amount.isEmpty ? "0" : amount)
                    .font(.system(size: 56, weight: .heavy))
                    .foregroundStyle(amount.isEmpty ? .secondary : .primary)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Text("USDC").font(.title3.weight(.bold)).foregroundStyle(.secondary)
            }
            Text("You have \(store.wallet?.usdcBalance ?? "0.00") USDC")
                .font(.footnote)
                .foregroundStyle(value > (store.wallet?.balance ?? 0) ? Color.red : .secondary)
        }
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.15), value: amount)

        HStack(spacing: 8) {
            ForEach(["1", "5", "10", "20"], id: \.self) { quick in
                Button(quick) { amount = quick }
                    .font(.subheadline.weight(.bold))
                    .silver()
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .glassEffect(.regular.interactive(), in: .capsule)
                    .overlay(GlassRim(shape: Capsule(), strength: 0.7))
                    .buttonStyle(.plain)
            }
        }
        .disabled(step != nil)

        Keypad(amount: $amount).disabled(step != nil)

        Spacer(minLength: 8)

        if let step {
            HStack(spacing: 10) {
                ProgressView().tint(PactColor.silver)
                Text(step).font(.headline)
            }
            .frame(maxWidth: .infinity)
        }
        Button(sendTitle) { send() }.pactAction().disabled(!canSend)
    }

    private var sendTitle: String {
        guard let to, value > 0 else { return "Send" }
        return "Send \(amount) USDC to \(to.member.name?.split(separator: " ").first.map(String.init) ?? "them")"
    }

    private func send() {
        guard let to else { return }
        let requestId = UUID()
        step = "Starting…"
        Task {
            let result = await store.send(to: to, amount: amount, requestId: requestId) { step = $0 }
            step = nil
            withAnimation(.smooth) { outcome = result }
        }
    }

    @ViewBuilder
    private func done(_ outcome: SendOutcome) -> some View {
        Spacer()
        VStack(spacing: 14) {
            switch outcome {
            case .confirmed:
                Image(systemName: "checkmark.circle.fill").font(.system(size: 72)).foregroundStyle(PactColor.paid)
                    .symbolEffect(.bounce, value: true)
                Text("Sent \(amount) USDC").font(.title.weight(.heavy))
                Text("to \(to?.member.name ?? "your friend"), confirmed on Arc.").foregroundStyle(.secondary)
            case .pending:
                Image(systemName: "clock.fill").font(.system(size: 64)).silver()
                Text("On its way").font(.title.weight(.heavy))
                Text("Arc is still confirming it. It'll show in Activity.").foregroundStyle(.secondary)
            case .failed(let reason):
                Image(systemName: "xmark.circle.fill").font(.system(size: 64)).foregroundStyle(.red)
                Text("Didn't send").font(.title.weight(.heavy))
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

/// A number pad for amounts: digits, one ".", at most 6 decimals (USDC's precision), and delete.
struct Keypad: View {
    @Binding var amount: String
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 6) {
            ForEach(keys, id: \.self) { key in
                Button { press(key) } label: {
                    Group {
                        if key == "delete" { Image(systemName: "delete.left") } else { Text(key) }
                    }
                    .font(.system(size: 26, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .contentShape(.rect)
                }
                .buttonStyle(KeyStyle())
            }
        }
        .sensoryFeedback(.selection, trigger: amount)
    }

    private func press(_ key: String) {
        switch key {
        case "delete":
            if !amount.isEmpty { amount.removeLast() }
        case ".":
            if !amount.contains(".") { amount = (amount.isEmpty ? "0" : amount) + "." }
        default:
            if let dot = amount.firstIndex(of: "."), amount[amount.index(after: dot)...].count >= 6 { return }
            guard amount.count < 10 else { return }
            amount = amount == "0" ? key : amount + key
        }
    }
}

private struct KeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.primary)
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : 0), in: .rect(cornerRadius: 16))
    }
}

/// Receive: my address as a QR code, with Copy and Share.
struct ReceiveSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Text("Receive").font(.system(size: 30, weight: .heavy)).silver()
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .glassCircle()
            }
            if let address = store.wallet?.address {
                Spacer()
                if let code = qrCode(address) {
                    Image(uiImage: code)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 220, height: 220)
                        .padding(16)
                        .background(.white, in: .rect(cornerRadius: 24))
                }
                Text(address)
                    .font(.footnote.monospaced().weight(.medium))
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                Text("Friends in your pacts can send to you straight from Pact. Others can send USDC on Arc Testnet to this address.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Spacer()
                HStack(spacing: 10) {
                    Button(copied ? "Copied" : "Copy") {
                        UIPasteboard.general.string = address
                        copied = true
                        Task { try? await Task.sleep(for: .seconds(2)); copied = false }
                    }
                    .pactGhost()
                    .sensoryFeedback(.success, trigger: copied)
                    ShareLink(item: address) { Text("Share") }.pactAction()
                }
            }
        }
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
    }

    private func qrCode(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}
