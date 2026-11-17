import SwiftUI
import Supabase

/// A pact's funding plan, from `get_pact_payment_status`: who gets paid, each share, and the deadline.
struct FundingPlan: Hashable, Decodable {
    var payeeAddress: String
    var shareUsdc: Double
    var sharesNeeded: Int
    var deadline: String

    var deadlineDate: Date? { parseDate(deadline) }

    enum CodingKeys: String, CodingKey {
        case payeeAddress = "payee_address", shareUsdc = "share_usdc", sharesNeeded = "shares_needed", deadline
    }
}

/// Where a pact stands on PactSplit, from the `wallet` function's `pact_status`. Read live from Base.
struct PactSplitStatus: Hashable, Decodable {
    struct Amount: Hashable, Decodable { var usdc: String }
    struct MemberPaid: Hashable, Decodable {
        var userId: UUID
        var role: String
        var address: String?
        var paid: Bool
    }

    /// `none` until the host opens it, then `open`, `released` or `cancelled`.
    var state: String
    var payee: String?
    /// False means someone other than the host opened a pact with this id, so nobody should pay in.
    var openedByHost: Bool?
    var deadline: Int?
    var sharesPaid: Int
    var sharesNeeded: Int
    var funded: Bool
    var share: Amount
    var total: Amount
    var paidIn: Amount
    var members: [MemberPaid]

    var deadlineDate: Date? { deadline.map { Date(timeIntervalSince1970: TimeInterval($0)) } }
    var progress: Double { sharesNeeded > 0 ? Double(sharesPaid) / Double(sharesNeeded) : 0 }
    func paid(_ userId: UUID?) -> Bool { members.contains { $0.userId == userId && $0.paid } }
}

/// The five PactSplit calls. Each one is a PIN step from the person's own Circle wallet.
enum PactSplitAction: String, Identifiable {
    case createPact = "create_pact", payShare = "pay_share", release, cancel, claimRefund = "claim_refund"

    var id: String { rawValue }
}

/// Where a PactSplit call got to.
enum ActionOutcome {
    case confirmed(txHash: String?), pending, failed(String)
}

private let baseExplorer = "https://base-sepolia.blockscout.com/tx/"
func arcTxURL(_ hash: String) -> URL? { URL(string: baseExplorer + hash) }

func shortAddress(_ address: String) -> String { "\(address.prefix(6))…\(address.suffix(4))" }

/// Postgres and JavaScript dates, with or without fractions of a second.
func parseDate(_ text: String) -> Date? {
    let plain = ISO8601DateFormatter()
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return plain.date(from: text) ?? fractional.date(from: text)
}

/// A 4xx from an Edge Function: its readable reason, and whether the wallet is short of USDC.
struct FunctionFailure: Error {
    var message: String
    var lowBalance = false
}

private struct FailureReply: Decodable {
    var error: String?
    var reason: String?
}

private struct ChallengeReply: Decodable {
    var status: String?
    var appId: String?
    var userToken: String?
    var encryptionKey: String?
    var challengeId: String?
    /// "approve" when pay_share first needs USDC approved for PactSplit; the payment is a second PIN.
    var step: String?
}

private struct ChallengeProgress: Decodable {
    var status: String
    var txHash: String?
    var error: String?
}

/// PactSplit on Base: the host saves a plan and opens it on chain, each member pays a share with their PIN,
/// then the host releases to the payee, or cancels so everyone claims their share back.
/// The server checks every call would go through before it hands back a PIN challenge.
extension PactStore {
    func loadPactSplit(_ id: Pact.ID) async {
        let rows = try? await client.rpc("get_pact_payment_status", params: ["p_pact_id": id]).execute().data
        fundingPlans[id] = rows.flatMap { try? JSONDecoder().decode([FundingPlan].self, from: $0) }?.first
        shareReceipts[id] = rows.flatMap { try? JSONDecoder().decode([ShareReceipt].self, from: $0) } ?? []
        let status: PactSplitStatus? = try? await invoke("wallet", ["action": "pact_status", "pactId": key(id)])
        withAnimation(.smooth) { pactSplit[id] = status }
    }

    /// Saves or replaces the plan. It can change until the host opens it on chain. Returns an error message, or nil.
    func saveFundingPlan(_ id: Pact.ID, shareUsdc: String, deadline: Date, payee: String) async -> String? {
        struct Reply: Decodable { var paymentId: String }
        do {
            let _: Reply = try await invoke("create-pact-payment-plan", [
                "pactId": key(id),
                "shareUsdc": shareUsdc,
                "deadline": ISO8601DateFormatter().string(from: deadline),
                "payeeAddress": payee.trimmingCharacters(in: .whitespaces),
            ])
            await loadPactSplit(id)
            return nil
        } catch let failure as FunctionFailure {
            return failure.message
        } catch {
            return friendly(error, "Couldn't save the plan.")
        }
    }

    /// Runs one PactSplit call: the server's checks, Circle's PIN screen, then Base's receipt.
    /// Confirmed only once the receipt says success, so a call that reverted reads as failed.
    /// Paying a share takes two PINs the first time: approve USDC for PactSplit, then pay.
    func runPactAction(_ action: PactSplitAction, in id: Pact.ID, onStep: (String) -> Void) async -> ActionOutcome {
        do {
            for _ in 0..<2 {
                let reply: ChallengeReply = try await invoke("wallet", ["action": action.rawValue, "pactId": key(id)])
                guard reply.status == "challenge", let appId = reply.appId, let userToken = reply.userToken,
                      let encryptionKey = reply.encryptionKey, let challengeId = reply.challengeId else {
                    return .failed("The wallet didn't hand back a PIN step.")
                }
                let approving = reply.step == "approve"

                onStep(approving ? "Approve USDC with your PIN" : "Confirm with your PIN")
                try configureCircle(appId: appId)
                if let failure = await runChallenge(userToken: userToken, encryptionKey: encryptionKey, challengeId: challengeId) {
                    return .failed(failure)
                }

                // Base confirms in seconds; stop watching after two minutes and leave it pending.
                // A failed status read is retried, since the PIN went through and the call may already be on chain.
                onStep(approving ? "Approving USDC…" : "Waiting for Base…")
                var outcome: ActionOutcome = .pending
                watch: for _ in 0..<40 {
                    let progress: ChallengeProgress? = try? await invoke("wallet", ["action": "challenge_status", "challengeId": challengeId])
                    switch progress?.status {
                    case "confirmed":
                        outcome = .confirmed(txHash: progress?.txHash)
                        break watch
                    case "failed":
                        outcome = .failed(progress?.error ?? "The transaction failed on Base.")
                        break watch
                    default:
                        try await Task.sleep(for: .seconds(3))
                    }
                }
                // Once the approval lands, go round again for the payment's own PIN.
                if approving, case .confirmed = outcome { continue }
                await loadPactSplit(id)
                if case .confirmed = outcome { await loadWallet() }
                return outcome
            }
            return .failed("The USDC approval has not landed yet. Try paying again in a moment.")
        } catch let failure as FunctionFailure {
            return .failed(failure.lowBalance ? "\(failure.message) Add test USDC from the Wallet tab." : failure.message)
        } catch {
            return .failed(friendly(error, "That didn't go through."))
        }
    }

    func key(_ id: Pact.ID) -> String { id.uuidString.lowercased() }

    /// The current sign-in token, refreshed if it has expired. The functions client can otherwise keep sending
    /// the token from launch, which edge functions reject with 401 once it's an hour old.
    func freshAuth() async -> [String: String] {
        guard let session = try? await client.auth.session else { return [:] }
        return ["Authorization": "Bearer \(session.accessToken)"]
    }

    /// An edge function said "not signed in". If Supabase agrees the session has ended (signed out elsewhere,
    /// or its refresh token was revoked), sign out here too, so the app asks to sign in instead of quietly
    /// showing an empty wallet. A session that is still fine is left alone.
    func signOutIfSessionEnded() async {
        if (try? await client.auth.user()) == nil { await signOut() }
    }

    /// Calls an Edge Function as the signed-in user. A 4xx comes back as its readable `error`.
    func invoke<T: Decodable>(_ function: String, _ body: [String: String]) async throws -> T {
        do {
            return try await client.functions.invoke(function, options: FunctionInvokeOptions(headers: await freshAuth(), body: body))
        } catch let failure as FunctionsError {
            if case .httpError(401, _) = failure { await signOutIfSessionEnded() }
            if case .httpError(_, let data) = failure, let reply = try? JSONDecoder().decode(FailureReply.self, from: data), let message = reply.error {
                throw FunctionFailure(message: message, lowBalance: reply.reason == "low_balance")
            }
            throw failure
        }
    }
}
