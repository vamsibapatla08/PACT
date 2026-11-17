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
| Open the pact (host) | `{ "action": "create_pact", "pactId": "<uuid>" }` | A PIN challenge. Payee, share, shares and deadline come from the saved funding plan |
| Pay the payee (host) | `{ "action": "release", "pactId": "<uuid>" }` | A PIN challenge |
| Cancel the pact (host) | `{ "action": "cancel", "pactId": "<uuid>" }` | A PIN challenge |
| Get my share back after a cancel | `{ "action": "claim_refund", "pactId": "<uuid>" }` | A PIN challenge |
| Members' wallets | `{ "action": "pact_member_wallets", "pactId": "<uuid>" }` | `{ members: [{ user_id, address }] }`, only members with a wallet. No PIN |

- A PIN challenge is `{ appId, userToken, encryptionKey, challengeId }`. The app passes these to Circle's web SDK, which asks for the PIN. Nothing moves until the PIN is entered
- `pay_share` checks the user is an active member, checks the pact on chain was opened by the pact's real host, and reads the share amount from the contract, so the app never sends an amount
- Show `amount` and `payee` before opening the PIN screen ("You pay 25 USDC to 0x12…"), and use `sharesPaid` of `sharesNeeded` for a "3 of 4 paid" bar
- `release` returns 409 "Waiting for N more of M shares" until every share is in, so the host never gets a failed PIN step
- Member sends: both people must be active members of the pact, and the server looks up the recipient's address from `wallets`. The app never sends an address
- `requestId` is a uuid the app makes once per Send tap. Sending the same one again returns the same PIN challenge, so a retry or double tap never sends twice
- Every member send is saved in `pact_transfers`. Sender and recipient can read it, and only the function writes it
- After the PIN, call `transfer_status` every few seconds until it says `confirmed` or `failed`. `txHash` links to the Arc explorer
- `create_pact` and `release` only work for the pact's active host (`role = 'host'` in `pact_members`). `cancel` works for the host any time, and for any member after the deadline
- `create_pact` reads the plan from `pact_payments`, so call `create-pact-payment-plan` first. The deadline must be at least 2 minutes away
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

## For Nihar: release and refunds

The Release, Cancel and Claim refund buttons already work in `PactMoneyPanel.tsx`, through `runPactAction` in `pactMoneyService.ts`. The backend is done for all three. These are the gaps around them.

Where to work, all in `frontend/src/components/PactMoneyPanel.tsx` unless it says otherwise:

- `actions` (around line 155) picks which buttons show. Add the "Waiting for N more" text and the deadline messages next to it
- `handlePactAction` (around line 123) runs a button. Put the cancel confirm here, before `onPactAction`
- `ACTION_LABEL`, `ACTION_DONE` and `CHAIN_TEXT` (lines 32–50) hold the button and result text
- `pastDeadline` (around line 154) is the value to re-check on a timer
- `paymentRows` has `share_status` (`owed`, `paid`, `refunded`) for each member's row. The types are in `frontend/src/types/pactMoney.ts`
- `runPactAction` in `frontend/src/lib/pactMoneyService.ts` (line 199) calls the `wallet` function. Its error has the server's text and `reason`
- Nothing in the frontend handles `low_balance` or `refunded` yet

### Release (host)

- [ ] Before the PIN, show what will happen: "You send `total` USDC to `payee`". Both come from `pact_status`
- [ ] While shares are missing, show the host "Waiting for N more of M shares" in place of the Release button
- [ ] After a release, keep showing "Released `total` USDC to `payee`" with the explorer link, not just until the page reloads. `state` is `released` in `pact_status`

### Cancel

- [ ] Ask before the PIN: "Cancel this pact? Everyone who paid will need to claim their share back." Cancel can't be undone
- [ ] Members before the deadline: say "The host can cancel any time. You can cancel after `deadline`" so they know why there's no button
- [ ] Once the deadline passes and the pact isn't full, show it clearly: "Deadline passed. Anyone can cancel to unlock refunds"
- [ ] `pastDeadline` is only worked out when the panel renders. Re-check it on a timer so the Cancel button shows up when the deadline passes

### Refunds (after a cancel)

- [ ] Show each member's row as Paid, Refunded or Didn't pay, so the group can see who still has money to claim
- [ ] After a refund goes through, hide Claim refund and show "Refunded `share` USDC". Tapping it again returns a 409 `NothingToRefund` error
- [ ] People who didn't pay: show "Nothing to refund" and no button

### For all three

- [ ] On a 409 with `reason: "low_balance"`, add a link to faucet.circle.com (Arc Testnet). The wallet needs a little USDC for gas, even to claim a refund
- [ ] Show the `error` text from the function as it is. Every check runs before the PIN, so the message is the real reason
- [ ] Refresh the payment rows and the Progress bar after each action. Fund turns complete once every share is marked paid

## For Vamsi: what to store

A suggestion, change it as you need:

- `pact_payments`: one row per pact payment plan. `pact_id`, `payee_address`, `share_usdc`, `shares_needed`, `deadline`, `status` (open, released, cancelled), `created_at`
- `pact_shares`: one row per person per plan. `pact_id`, `user_id`, `status` (owed, paid, refunded), `tx_hash`, `paid_at`
- Only the server (the QuickNode webhook) marks a share paid, never the app, so nobody can mark themselves paid
- Row level security: members of a pact can read its rows, nobody writes from the app

## Handoff: how to use it

Everything goes through two Edge Functions, called with the signed-in user's session. The app never sends an amount or an address for a pact payment. The server reads them from the plan and the contract.

```ts
await supabase.functions.invoke('create-pact-payment-plan', { body: { pactId, shareUsdc: '25.00', deadline: '2026-11-20T23:00:00Z', payeeAddress: '0x...' } })
await supabase.functions.invoke('wallet', { body: { action: 'pact_status', pactId } })
```

### The full flow, in order

| Step | Who | Call | Then |
|---|---|---|---|
| 1. Save the plan | Host | `create-pact-payment-plan` with `pactId`, `shareUsdc`, `deadline` (ISO date, within 90 days), `payeeAddress` | Returns `paymentId` and `sharesNeeded`, which is the number of members with a wallet. It can be replaced until the pact is on chain |
| 2. Open on chain | Host | `wallet` `create_pact` | PIN, then `PactCreated` |
| 3. Pay a share | Each member | `wallet` `pay_share` | Show `amount` and `payee`, PIN, then `SharePaid` |
| 4. Check progress | Any member | `wallet` `pact_status` | No PIN. See below |
| 5a. Pay out | Host | `wallet` `release` | Only once `funded` is true. PIN, then `Released` |
| 5b. Call it off | Host any time, anyone after the deadline | `wallet` `cancel` | PIN, then `Cancelled` |
| 6. Get money back | Each payer after a cancel | `wallet` `claim_refund` | PIN, then `Refunded` |

- After each PIN step, poll `{ "action": "challenge_status", "challengeId" }` every few seconds. It returns `status` (`awaiting_pin`, `pending`, `confirmed` or `failed`), `txHash` and, on a failure, `error`. Only call it done on `confirmed`, because that means the receipt on Arc says success

### Funded or not: `pact_status`

For Vamsi's backend and PactMoney. It reads the contract live, so it is always the truth, even before Dimple's stream lands.

| Field | Meaning |
|---|---|
| `state` | `none` (not on chain yet), `open`, `released` or `cancelled` |
| `funded` | `true` when every share is in (open or released). This is the one to show |
| `sharesPaid`, `sharesNeeded` | For the "3 of 4 paid" bar |
| `share`, `total`, `paidIn` | USDC amounts as strings |
| `members` | Every member: `userId`, `role`, `address`, `paid` |
| `payers` | Members who have paid, with `amount` |
| `openedByHost` | `false` means someone else opened a pact with this id. Don't trust it |
| `deadline`, `deadlineAt` | Unix seconds and ISO date |
| `otherPayers` | Shares paid by wallets that aren't members. Should be 0 |

### Errors the app should show

Every check runs before the PIN, so a user is never asked for a PIN for a transaction that would fail. Show the `error` text as it is.

| Code | When |
|---|---|
| 400 | Bad `pactId` or body |
| 401 | Not signed in |
| 403 | Not in the pact, or not the host for a host-only action |
| 409 | `reason: "low_balance"` when the wallet can't cover the share plus gas. Also: already paid, every share already paid, deadline passed, pact not open, not opened by its host, release before every share is in, refund with nothing to refund, no funding plan, no wallet yet |
| 502 | Circle or Arc failed. `circleCode` is set when Circle refused. Safe to retry |
| 503 | `PACT_SPLIT_ADDRESS` isn't set on the function |

### Live test on Arc

- `backend/contracts/script/smoke.sh` runs the whole contract flow with `cast`: opens a 2-share pact, pays both shares, releases, then opens a second pact, cancels it and claims the refund. It also checks that a double pay, a wrong amount and a release by someone who isn't the host all fail
- It saves each tx hash and its explorer link to `backend/contracts/script/smoke-results.md`
- Ran on Nov 16 at 01:24 UTC: 32 passed, 0 failed. Host `0xc9c4…5aac`, payer 2 `0x2b5d…781b`, 0.01 USDC shares
- On Nov 16 the team ran the whole flow through the app with real Circle PINs: the host opened the "austin trip" pact (1 USDC a share), and 3 members paid, so it reads 3 of 3 and funded, waiting for the host to release
- Every must-fail check reverted with the right error: double pay (`AlreadyPaid`), wrong amount (`WrongAmount`), release by someone who isn't the host (`NotHost`), release before every share is in (`NotFull`), release twice (`NotOpen`), cancel by someone who isn't the host before the deadline (`CannotCancel`), pay after a cancel (`NotOpen`), refund twice or with no share (`NothingToRefund`)

| Test | Tx hash |
|---|---|
| Pact 1 `createPact` | [`0x8af17e73…4c4756`](https://explorer.testnet.arc.io/tx/0x8af17e7375a9a2a2f8363d2a2de26f343ba62ee3cf505e9df429c2556a4c4756) |
| Pact 1 `payShare` (host) | [`0x24d5c0fa…df8927`](https://explorer.testnet.arc.io/tx/0x24d5c0fa7a44f096875833fc9c23226035e9dec64123c7f0fac25d97d2df8927) |
| Pact 1 `payShare` (payer 2) | [`0xb2a069b8…4cf7ca`](https://explorer.testnet.arc.io/tx/0xb2a069b87fda9b10906a2d3e0bcd68d9baf0bbce801a0c31aeedc3761e4cf7ca) |
| Pact 1 `release` | [`0x1610adef…80623f`](https://explorer.testnet.arc.io/tx/0x1610adef756d1923ead0f4b0b30452ec642ea2a06a2924f3ab48f77a8280623f) |
| Pact 2 `createPact` | [`0x566b8df3…0b9f6e`](https://explorer.testnet.arc.io/tx/0x566b8df3c4222fb7aff99d3cc8d23fd6c53f308d51f427aa3c69582e6e0b9f6e) |
| Pact 2 `payShare` | [`0x1eaaa4f5…4d6ad6`](https://explorer.testnet.arc.io/tx/0x1eaaa4f5b7238a4da1460d7416ba8acc87f4e1825ec35a4b18dfbd99d84d6ad6) |
| Pact 2 `cancel` | [`0xad1f8304…bcdc8b`](https://explorer.testnet.arc.io/tx/0xad1f8304b91238e95612b49fa92dfde3d29dd24b62561db90de4d2de5dbcdc8b) |
| Pact 2 `claimRefund` | [`0xc6b93c0b…18a12f`](https://explorer.testnet.arc.io/tx/0xc6b93c0b24f233eb8331c204aeb1098c73795d46f9a7c9565137d4b13418a12f) |
| `create_pact` through the app (host `0x6d99…1307`) | [`0xc56bd6e1…b47ab8`](https://explorer.testnet.arc.io/tx/0xc56bd6e121a8b86876c33ab9fdfae45e8406e6df9e2154f3d47e6b1fceb47ab8) |
| `pay_share` through the app, PIN (`0x5d56…7748`) | [`0x8bd594b3…5e3071`](https://explorer.testnet.arc.io/tx/0x8bd594b33f35db70ae3f7605aa1806c50281d2f90ed3e8e785bd68d9065e3071) |
| `pay_share` through the app, PIN (`0xdaf1…89bf`) | [`0x5b31a7f4…b756a7`](https://explorer.testnet.arc.io/tx/0x5b31a7f410a92f8de43401da49d57a4d5ac971053199c3e1e8f58bc3c6b756a7) |
| `pay_share` through the app, PIN (host) | [`0x130eec41…ffa3ff`](https://explorer.testnet.arc.io/tx/0x130eec4173bd23de361bc9c890d075c2a405d7e73491d56eccb5828975ffa3ff) |

## Not done yet

- Test one real transfer and one real `pay_share` with two funded wallets
- Fallback by Nov 17 if the contract is not ready: direct transfers plus Circle's webhook
