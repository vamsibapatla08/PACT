import SwiftUI
import Supabase
import CircleProgrammableWalletSDK

/// My wallet as the `wallet` Edge Function reports it.
struct Wallet: Hashable {
    var address: String
    var blockchain: String
    var usdcBalance: String?

    var shortAddress: String { "\(address.prefix(6))…\(address.suffix(4))" }
    var balance: Double { Double(usdcBalance ?? "0") ?? 0 }
}

/// A send between pact members, from `pact_transfers`. I can read the ones I sent or received.
struct Transfer: Identifiable, Hashable, Decodable {
    let id: UUID
    var senderId: UUID
    var recipientId: UUID
    var amount: Double
    var status: String
    var createdAt: String

    enum CodingKeys: String, CodingKey {
        case id = "transfer_id", senderId = "sender_id", recipientId = "recipient_id"
        case amount = "amount_usdc", status, createdAt = "created_at"
    }
}

/// Where a send got to: confirmed on Base, failed, or still going when we stopped watching.
enum SendOutcome {
    case confirmed, pending, failed(String)
}

/// Everything the `wallet` Edge Function can send back.
private struct WalletReply: Decodable {
    var status: String?
    var address: String?
    var blockchain: String?
    var usdc_balance: String?
    var appId: String?
    var userToken: String?
    var encryptionKey: String?
    var challengeId: String?
    var transferId: String?
    var transfer: TransferState?
    var error: String?

    struct TransferState: Decodable { var status: String }

    var wallet: Wallet? {
        guard status == "ready", let address else { return nil }
        return Wallet(address: address, blockchain: blockchain ?? "BASE-SEPOLIA", usdcBalance: usdc_balance)
    }
}

/// The Circle wallet: the Edge Function talks to Circle's API, and Circle's SDK shows the PIN screens,
/// so only the person's own PIN can move money.
extension PactStore {
    func loadWallet() async {
        if let reply = try? await walletCall(["action": "status"]) { wallet = reply.wallet }
        walletLoaded = true
        await loadActivity()
    }

    /// My last 20 sends and receives. Sends still waiting on a PIN were backed out of, and nothing moved.
    func loadActivity() async {
        guard let rows: [Transfer] = try? await client.from("pact_transfers")
            .select("transfer_id, sender_id, recipient_id, amount_usdc, status, created_at")
            .neq("status", value: "awaiting_pin")
            .order("created_at", ascending: false)
            .limit(20)
            .execute().value else { return }
        withAnimation(.smooth) { activity = rows }
    }

    /// Sends USDC to someone in one of my pacts, the same way the website does: the server checks we're
    /// both members and looks up their address, Circle asks for my PIN, then we watch Base confirm it.
    /// `requestId` is made once per Send tap, so a retry never sends twice.
    func send(to friend: Friend, amount: String, requestId: UUID, onStep: (String) -> Void) async -> SendOutcome {
        guard let pact = friend.pacts.first else { return .failed("You don't share a pact with them.") }
        walletBusy = true
        defer { walletBusy = false }
        do {
            let reply = try await walletCall([
                "action": "transfer",
                "pactId": pact.id.uuidString.lowercased(),
                "toUserId": friend.member.userId.uuidString.lowercased(),
                "amount": amount,
                "requestId": requestId.uuidString.lowercased(),
            ])
            guard reply.status == "challenge", let appId = reply.appId, let userToken = reply.userToken,
                  let encryptionKey = reply.encryptionKey, let challengeId = reply.challengeId,
                  let transferId = reply.transferId else {
                return .failed(reply.error ?? "Couldn't start the send.")
            }

            onStep("Confirm with your PIN")
            try configureCircle(appId: appId)
            if let failure = await runChallenge(userToken: userToken, encryptionKey: encryptionKey, challengeId: challengeId) {
                return .failed(failure)
            }

            // Base confirms in seconds; stop watching after two minutes and leave it pending.
            onStep("Sending on Base…")
            for _ in 0..<40 {
                let state = try await walletCall(["action": "transfer_status", "transferId": transferId])
                switch state.transfer?.status {
                case "confirmed":
                    await loadWallet()
                    return .confirmed
                case "failed":
                    await loadActivity()
                    return .failed("The network didn't accept the send. Nothing left your wallet.")
                default:
                    try await Task.sleep(for: .seconds(3))
                }
            }
            await loadWallet()
            return .pending
        } catch {
            return .failed(friendly(error, "Couldn't send."))
        }
    }

    func configureCircle(appId: String) throws {
        try WalletSdk.shared.setConfiguration(.init(endPoint: "https://api.circle.com/v1/w3s", appId: appId))
        WalletSdk.shared.setLayoutProvider(CircleLayout.shared)
    }

    /// Makes my wallet: start, set a PIN in Circle's screens, then confirm so it's saved to `wallets`.
    func createWallet() async {
        walletBusy = true
        defer { walletBusy = false }
        error = nil
        do {
            let started = try await walletCall(["action": "start"])
            if let ready = started.wallet { withAnimation(.smooth) { wallet = ready }; return }
            guard started.status == "challenge", let appId = started.appId, let userToken = started.userToken,
                  let encryptionKey = started.encryptionKey, let challengeId = started.challengeId else {
                error = started.error ?? "Couldn't start the wallet setup."
                return
            }

            try configureCircle(appId: appId)
            if let failure = await runChallenge(userToken: userToken, encryptionKey: encryptionKey, challengeId: challengeId) {
                error = failure
                return
            }

            // Circle can take a few seconds to make the wallet live after the PIN step.
            for _ in 0..<4 {
                let confirmed = try await walletCall(["action": "confirm", "challengeId": challengeId])
                if let ready = confirmed.wallet { withAnimation(.smooth) { wallet = ready }; return }
                if confirmed.status == "failed" { error = confirmed.error; return }
                try await Task.sleep(for: .seconds(2))
            }
            error = "Your wallet is still being made. Pull down to refresh in a moment."
        } catch {
            self.error = friendly(error, "Couldn't create your wallet.")
        }
    }

    /// Shows Circle's PIN screens for one challenge. Returns an error message, or nil once it's complete.
    func runChallenge(userToken: String, encryptionKey: String, challengeId: String) async -> String? {
        await withCheckedContinuation { continuation in
            WalletSdk.shared.execute(userToken: userToken, encryptionKey: encryptionKey, challengeIds: [challengeId]) { response in
                switch response.result {
                case .success(let result) where result.status == .COMPLETE:
                    continuation.resume(returning: nil)
                case .success(let result):
                    continuation.resume(returning: "The PIN step ended as \(result.status.rawValue.lowercased()).")
                case .failure(let failure):
                    response.onErrorController?.dismiss(animated: true)
                    continuation.resume(returning: failure.displayString)
                }
            }
        }
    }

    /// Calls the Edge Function as the signed-in user. A 4xx still carries a readable reason in `error`.
    private func walletCall(_ body: [String: String]) async throws -> WalletReply {
        do {
            return try await client.functions.invoke("wallet", options: FunctionInvokeOptions(headers: await freshAuth(), body: body))
        } catch let failure as FunctionsError {
            if case .httpError(401, _) = failure { await signOutIfSessionEnded() }
            if case .httpError(_, let data) = failure, let reply = try? JSONDecoder().decode(WalletReply.self, from: data) {
                return reply
            }
            throw failure
        }
    }
}
