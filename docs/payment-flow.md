# Payment flow on Arc + Circle

How money moves in Pact, and what each of us builds for it. Written by Rory for Vamsi and Dimple.

## In one line

- Each person gets a Circle wallet on Arc Testnet, pays their share into our PactSplit contract with their PIN, and the contract sends the total to whoever is being paid once everyone is in

## The pieces

| Piece | What it does | Who |
|---|---|---|
| Circle wallet | One wallet per user, made by the `wallet` Edge Function. Only the user's PIN moves money | Rory |
| `wallet` Edge Function | Makes the wallet, and hands the app a PIN challenge for each payment | Rory |
| PactSplit contract | Holds each share, then releases to the payee or refunds everyone. Emits `SharePaid` | Rory |
| Connect wallet screen | Runs Circle's web SDK for the PIN step and shows the wallet | Nihar |
| Payments tables | Records what each person owes and what is paid | Vamsi |
| QuickNode Stream | Watches PactSplit on Arc and tells Supabase when a share is paid | Dimple |

## Step by step

1. A user signs in with Google, opens Connect wallet, and sets a PIN. The `wallet` function saves their wallet address in `wallets`
2. They fund it with test USDC from the Circle faucet (faucet.circle.com, pick Arc Testnet)
3. The group agrees on a plan. The host creates the pact on chain: who gets paid, the share per person, how many shares, and a deadline
4. Each person taps "Approve my share". The app calls `wallet` with `{ "action": "pay_share", "pactId": "<uuid>" }`, gets a challenge, and Circle's SDK asks for their PIN
5. The share goes into PactSplit and the contract emits `SharePaid`
6. QuickNode sees `SharePaid` and tells Supabase, which marks that person paid
7. When every share is in, the host releases and the payee gets the total. If the pact falls through, the host cancels and each person claims their share back

## Arc Testnet facts

| Thing | Value |
|---|---|
| Chain ID | 5042002 |
| RPC | `https://rpc.testnet.arc.network` |
| Gas token | USDC, native, 18 decimals |
| USDC as ERC-20 | `0x3600000000000000000000000000000000000000`, 6 decimals. Same balance as the native one |
| Circle blockchain name | `ARC-TESTNET` |
| Test funds | faucet.circle.com |

- PactSplit takes native USDC (18 decimals). 25 USDC is `25000000000000000000`
- Gas is paid in USDC too, so a wallet needs a little more than its share

## The `wallet` function

| Call | Body | Returns |
|---|---|---|
| Status | `GET` or `{ "action": "status" }` | `none`, or `ready` with address and balance |
| Set up | `{ "action": "start" }` then `{ "action": "confirm", "challengeId" }` | A PIN challenge, then `ready` |
| Send USDC | `{ "action": "transfer", "to": "0x...", "amount": "1.50" }` | A PIN challenge |
| Send USDC to a pact member | `{ "action": "transfer", "pactId", "toUserId", "amount": "1.50", "requestId": "<uuid>" }` | A PIN challenge, plus `transferId`, `amount` and `to` |
| Check a send | `{ "action": "transfer_status", "transferId" }` | `{ transfer: { status, txHash, ... } }`. Status is `awaiting_pin`, `pending`, `confirmed` or `failed` |
| Pay my share | `{ "action": "pay_share", "pactId": "<uuid>" }` | A PIN challenge, plus `amount`, `payee`, `sharesPaid` and `sharesNeeded` |
| Open the pact (host) | `{ "action": "create_pact", "pactId": "<uuid>", "payee": "0x...", "shareUsdc": "25.00", "sharesNeeded": 4, "deadline": 1795000000 }` | A PIN challenge |
| Pay the payee (host) | `{ "action": "release", "pactId": "<uuid>" }` | A PIN challenge |
| Cancel the pact (host) | `{ "action": "cancel", "pactId": "<uuid>" }` | A PIN challenge |
| Get my share back after a cancel | `{ "action": "claim_refund", "pactId": "<uuid>" }` | A PIN challenge |

- A PIN challenge is `{ appId, userToken, encryptionKey, challengeId }`. The app passes these to Circle's web SDK, which asks for the PIN. Nothing moves until the PIN is entered
- `pay_share` checks the user is an active member, checks the pact on chain was opened by the pact's real host, and reads the share amount from the contract, so the app never sends an amount
- Show `amount` and `payee` before opening the PIN screen ("You pay 25 USDC to 0x12…"), and use `sharesPaid` of `sharesNeeded` for a "3 of 4 paid" bar
- `release` returns 409 "Waiting for N more of M shares" until every share is in, so the host never gets a failed PIN step
- Member sends: both people must be active members of the pact, and the server looks up the recipient's address from `wallets`. The app never sends an address
- `requestId` is a uuid the app makes once per Send tap. Sending the same one again returns the same PIN challenge, so a retry or double tap never sends twice
- Every member send is saved in `pact_transfers`. Sender and recipient can read it, and only the function writes it
- After the PIN, call `transfer_status` every few seconds until it says `confirmed` or `failed`. `txHash` links to the Arc explorer
- `create_pact`, `release` and `cancel` only work for the pact's active host (`role = 'host'` in `pact_members`). `shareUsdc` is a USDC amount with up to 6 decimals, turned into 18-decimal wei by the function. `deadline` is unix seconds and must be in the future
- `release` and `cancel` also check the pact is open on chain and was opened from the host's own wallet

## PactSplit contract

- Code: `backend/contracts/src/PactSplit.sol`, tests in `backend/contracts/test/`
- One contract for every pact. A pact's key is its Supabase uuid as bytes32: the 32 hex digits of the uuid, then 32 zeros
- Address on Arc Testnet: `0x6eadb2b3829e6d9c30208ff4122c40df7682d79d`
- Deploy script: `backend/contracts/script/DeployPactSplit.s.sol`

| Function | Who | What |
|---|---|---|
| `createPact(pactId, payee, share, sharesNeeded, deadline)` | Host | Opens the pact |
| `payShare(pactId)` with the share as value | Each member | Pays one share. One per wallet |
| `release(pactId)` | Host | Sends the total to the payee once every share is in |
| `cancel(pactId)` | Host any time, anyone after the deadline | Stops the pact. The host must release before the deadline |
| `claimRefund(pactId)` | Each payer | Gets their share back after a cancel |

## Deploy PactSplit

Rory runs this himself. The deployer key never goes in a file in git.

- Make a throwaway deployer wallet and lock it behind a password: `cast wallet new`, then `cast wallet import pact-deployer --interactive`
- Fund it with a little test USDC for gas from faucet.circle.com
- From `backend/contracts`, run this. It asks for the password and never stores the key in a file:

```
forge script script/DeployPactSplit.s.sol:DeployPactSplit --rpc-url https://rpc.testnet.arc.network --broadcast --account pact-deployer
```

- The address is printed as the return value and saved in `broadcast/DeployPactSplit.s.sol/5042002/run-latest.json`
- Then set it on the function: `supabase secrets set PACT_SPLIT_ADDRESS=0x... --workdir backend`, and fill it in above and in "For Dimple"

## For Dimple: what to stream

| Thing | Value |
|---|---|
| Contract address | `0x6eadb2b3829e6d9c30208ff4122c40df7682d79d` |
| Chain ID | 5042002 |
| RPC | `https://rpc.testnet.arc.network` |

- Filter on the PactSplit address only
- `pactId` is the first topic after the event signature on every event

| Event | Topic 0 |
|---|---|
| `SharePaid(bytes32 pactId, address payer, uint256 amount)` | `0x377c314585d5357a328354ae4fbd2fa0fed0a31de5810d1b3978bcb3a37507e6` |
| `Released(bytes32 pactId, address payee, uint256 amount)` | `0xc8fa66dff4b9073528c3f1bf21a8dc9a18fdf09847e88e96188bc953aef519f0` |
| `Refunded(bytes32 pactId, address payer, uint256 amount)` | `0xf552ca82e113ac3c539c3d617f29fcd19c172a0c75dad017555c9e109f7fe183` |
| `Cancelled(bytes32 pactId)` | `0xbaa1eb22f2a492ba1a5fea61b8df4d27c6c8b5f3971e63bb58fa14ff72eedb70` |
| `PactCreated(bytes32 pactId, address host, address payee, uint256 share, uint32 sharesNeeded, uint64 deadline)` | `0x4bab31bdedd112598af597948003d37acdc3c94059b8b7f68ea7f5b9ed81f09c` |

- `payer` and `payee` are indexed too, so they are the second topic. `amount` is in the data
- To match a payer to a person, take the last 40 hex digits of topic 2, add `0x`, and look it up in `wallets.address` (lowercase both sides, Circle may save it checksummed). That row's `user_id` is the person
- To match `pactId` to a pact, take the first 32 hex digits of topic 1 and put the dashes back (8-4-4-4-12). That is `pacts.id`

## For Vamsi: what to store

A suggestion, change it as you need:

- `pact_payments`: one row per pact payment plan. `pact_id`, `payee_address`, `share_usdc`, `shares_needed`, `deadline`, `status` (open, released, cancelled), `created_at`
- `pact_shares`: one row per person per plan. `pact_id`, `user_id`, `status` (owed, paid, refunded), `tx_hash`, `paid_at`
- Only the server (the QuickNode webhook) marks a share paid, never the app, so nobody can mark themselves paid
- Row level security: members of a pact can read its rows, nobody writes from the app

## Not done yet

- Set `PACT_SPLIT_ADDRESS` on the `wallet` function
- Test one real transfer and one real `pay_share` with two funded wallets
- Fallback by Nov 17 if the contract is not ready: direct transfers plus Circle's webhook
