import Foundation

/// One USDC movement in or out of my wallet, read from the Base explorer: test money, a friend, a pact share or payout.
struct LedgerRow: Identifiable, Hashable {
    enum Kind: Hashable { case person, share, payout, deposit, address }

    let id: String
    var at: Date
    var incoming: Bool
    var amount: Double
    var kind: Kind
    var userId: UUID?
    var address: String
    var txHash: String
    /// For a share paid in or a payout, the pact it belongs to, read from the PactSplit call.
    var pactId: UUID?
}

/// Everything in and out, the network fees I paid, and what it all adds up to (my balance).
struct Ledger: Hashable {
    var rows: [LedgerRow]
    var fees: Double
    var total: Double
}

private let explorer = "https://base-sepolia.blockscout.com"
private let usdcToken = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" // Circle USDC on Base Sepolia

func explorerTx(_ hash: String) -> URL? { URL(string: "\(explorer)/tx/\(hash)") }

/// PactSplit calls take the pact's id as their first argument: the uuid without dashes, padded to 32 bytes.
/// A smart wallet wraps the PactSplit call inside its own, so look for a PactSplit selector anywhere in the input,
/// followed by a pact key (16 uuid bytes, then 16 zero bytes).
private let pactCall = /(?:dd668b0a|67d42a8b|c4d252f5|71de2ffc|9f40efc6)([0-9a-f]{32})0{32}/
private func pactId(fromCall input: String) -> UUID? {
    guard let match = input.lowercased().firstMatch(of: pactCall) else { return nil }
    let s = Array(String(match.1))
    return UUID(uuidString: "\(String(s[0..<8]))-\(String(s[8..<12]))-\(String(s[12..<16]))-\(String(s[16..<20]))-\(String(s[20..<32]))")
}

extension PactStore {
    /// Every page of an explorer list (up to ten), as plain JSON objects.
    private func explorerAll(_ path: String) async throws -> [[String: Any]] {
        var all: [[String: Any]] = []
        var params: [String: Any]? = [:]
        for _ in 0..<10 {
            guard let current = params else { break }
            var parts = URLComponents(string: "\(explorer)/api/v2\(path)")!
            if !current.isEmpty { parts.queryItems = current.map { URLQueryItem(name: $0.key, value: "\($0.value)") } }
            let (data, response) = try await URLSession.shared.data(from: parts.url!)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw FunctionFailure(message: "The Base explorer could not be reached. Your balance is still right.")
            }
            all += body["items"] as? [[String: Any]] ?? []
            params = body["next_page_params"] as? [String: Any]
        }
        return all
    }

    /// Each pact member's wallet address, so a send to a friend shows their name and photo.
    private func memberWallets() async -> [String: UUID] {
        struct Reply: Decodable { struct Row: Decodable { let user_id: UUID; let address: String }; let members: [Row] }
        var byAddress: [String: UUID] = [:]
        // Each pact's on-chain status already lists every member's wallet, so start from that.
        for chain in pactSplit.values {
            for member in chain.members { if let address = member.address { byAddress[address.lowercased()] = member.userId } }
        }
        for pact in pacts {
            if Task.isCancelled { break }
            var reply: Reply? = try? await invoke("wallet", ["action": "pact_member_wallets", "pactId": key(pact.id)])
            if reply == nil {
                // One retry: the wallet function sometimes answers 502 while it starts up.
                try? await Task.sleep(for: .milliseconds(800))
                reply = try? await invoke("wallet", ["action": "pact_member_wallets", "pactId": key(pact.id)])
            }
            for row in reply?.members ?? [] { byAddress[row.address.lowercased()] = row.user_id }
        }
        return byAddress
    }

    /// My wallet's full history: every USDC in and out, with friends, pacts and test money named, plus the fees.
    func loadLedger() async throws -> Ledger? {
        guard let wallet else { return nil }
        let me = wallet.address.lowercased()
        async let transfersCall = explorerAll("/addresses/\(wallet.address)/token-transfers")
        async let txsCall = explorerAll("/addresses/\(wallet.address)/transactions")
        async let walletsCall = memberWallets()
        let (transfers, txs, wallets) = try await (transfersCall, txsCall, walletsCall)

        let inputs = Dictionary(txs.compactMap { tx -> (String, String)? in
            guard let hash = tx["hash"] as? String else { return nil }
            return (hash, tx["raw_input"] as? String ?? "")
        }, uniquingKeysWith: { first, _ in first })

        var rows: [LedgerRow] = []
        for t in transfers {
            let token = t["token"] as? [String: Any]
            guard ((token?["address_hash"] ?? token?["address"]) as? String)?.lowercased() == usdcToken,
                  let hash = t["transaction_hash"] as? String,
                  let from = t["from"] as? [String: Any], let to = t["to"] as? [String: Any],
                  let fromHash = from["hash"] as? String, let toHash = to["hash"] as? String,
                  let total = t["total"] as? [String: Any] else { continue }
            let incoming = toHash.lowercased() == me
            let other = incoming ? from : to
            let otherHash = (incoming ? fromHash : toHash)
            let userId = wallets[otherHash.lowercased()]
            let isContract = other["is_contract"] as? Bool ?? false
            let kind: LedgerRow.Kind = userId != nil ? .person : isContract ? (incoming ? .payout : .share) : incoming ? .deposit : .address
            let value = Double(total["value"] as? String ?? "0") ?? 0
            let decimals = Double(total["decimals"] as? String ?? "6") ?? 6
            rows.append(LedgerRow(
                id: "\(hash):\(t["log_index"] ?? 0)",
                at: parseDate(t["timestamp"] as? String ?? "") ?? .distantPast,
                incoming: incoming, amount: value / pow(10, decimals), kind: kind,
                userId: userId, address: otherHash, txHash: hash, pactId: nil))
        }
        rows.sort { $0.at > $1.at }

        // Name the pact on share payments and payouts, from the call that moved the money.
        for index in rows.indices where rows[index].kind == .share || rows[index].kind == .payout {
            var input = inputs[rows[index].txHash] ?? ""
            if input.isEmpty, let url = URL(string: "\(explorer)/api/v2/transactions/\(rows[index].txHash)"),
               let (data, _) = try? await URLSession.shared.data(from: url),
               let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                input = body["raw_input"] as? String ?? ""
            }
            rows[index].pactId = pactId(fromCall: input)
        }

        // Gas is paid in ETH by Circle's Gas Station, so no USDC goes to fees.
        let fees = 0.0
        let total = rows.reduce(0.0) { $0 + ($1.incoming ? $1.amount : -$1.amount) } - fees
        return Ledger(rows: rows, fees: fees, total: total)
    }

    /// Someone's photo from any pact we share.
    func avatarUrl(_ userId: UUID) -> String? {
        members.values.lazy.flatMap { $0 }.first { $0.userId == userId }?.avatarUrl
            ?? addedFriends.first { $0.userId == userId }?.avatarUrl
    }
}
