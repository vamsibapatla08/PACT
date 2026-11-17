#!/usr/bin/env bash
# Live smoke test of PactSplit on Arc Testnet, with Foundry cast.
#
# What it does, at 0.01 USDC a share:
#   Pact 1: host opens a 2-share pact, host pays share 1, PAYER2 pays share 2, host releases to the payee
#   Pact 2: host opens a 1-share pact, host pays it, host cancels, host claims the refund
#   Must-revert checks (simulated with cast call, no gas, no password):
#     double pay, wrong amount, release by a non-host, plus release before full and a second refund
#
# PactSplit takes native USDC as msg.value (18 decimals), so there is no approve step.
# One wallet can pay a pact only once (AlreadyPaid), so pact 1 needs a second keystore: PAYER2_ACCOUNT.
#
# cast asks for a keystore password on every signed tx: 7 times for ACCOUNT, once for PAYER2_ACCOUNT.
# No key or password is read, printed or written by this script.
#
# Usage, from anywhere:
#   PAYER2_ACCOUNT=pact-payer2 PAYER2_ADDRESS=0x... bash backend/contracts/script/smoke.sh
#   bash backend/contracts/script/smoke.sh --dry-run      # print every command, send nothing
set -euo pipefail

# ---- Config (override any of these with env vars) ----
RPC_URL="${RPC_URL:-https://rpc.testnet.arc.network}"
CHAIN_ID="${CHAIN_ID:-5042002}"
PACT_SPLIT="${PACT_SPLIT:-0x6eadb2b3829e6d9c30208ff4122c40df7682d79d}"
ACCOUNT="${ACCOUNT:-pact-deployer}"                                              # host, cast keystore name
HOST_ADDRESS="${HOST_ADDRESS:-0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac}"       # pact-deployer, from broadcast/
PAYER2_ACCOUNT="${PAYER2_ACCOUNT:-}"                                             # second cast keystore name
PAYER2_ADDRESS="${PAYER2_ADDRESS:-}"                                             # its address (asked from cast if unset)
PAYEE="${PAYEE:-$HOST_ADDRESS}"                                                  # who gets pact 1's total
SHARE_WEI="${SHARE_WEI:-10000000000000000}"                                      # 0.01 USDC at 18 decimals
DEADLINE_SECS="${DEADLINE_SECS:-3600}"                                           # pacts close an hour from now
EXPLORER_TX="${EXPLORER_TX:-https://explorer.testnet.arc.io/tx/}"                # same as PactMoneyPanel.tsx
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_FILE="${RESULTS_FILE:-$SCRIPT_DIR/smoke-results.md}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---- Selectors of the errors we expect ----
ERR_NOT_OPEN=0xddafad98         # NotOpen()
ERR_ALREADY_PAID=0xd70a0e30     # AlreadyPaid()
ERR_WRONG_AMOUNT=0x49986e73     # WrongAmount()
ERR_NOT_HOST=0x8ff4f0c9         # NotHost()
ERR_NOT_FULL="$(cast sig 'NotFull()')"
ERR_NOTHING_TO_REFUND="$(cast sig 'NothingToRefund()')"

PASS=0
FAIL=0
STATE_NAMES=(None Open Released Cancelled)

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
pass() { PASS=$((PASS + 1)); printf '    PASS  %s\n' "$*"; log "- PASS $*"; }
fail() { FAIL=$((FAIL + 1)); printf '    FAIL  %s\n' "$*"; log "- FAIL $*"; }
log()  { [[ $DRY_RUN -eq 1 ]] || printf '%s\n' "$*" >> "$RESULTS_FILE"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# ---- Preflight ----
command -v cast >/dev/null || die "cast not found. Install Foundry: https://getfoundry.sh"
command -v jq   >/dev/null || die "jq not found. brew install jq"
command -v bc   >/dev/null || die "bc not found"

if [[ $DRY_RUN -eq 0 ]]; then
  [[ -n "$PAYER2_ACCOUNT" ]] || die "PAYER2_ACCOUNT is not set. One wallet can only pay a pact once, so pact 1 needs a
second cast keystore. Make one with: cast wallet new, then cast wallet import pact-payer2 --interactive,
fund it with ~0.05 USDC from faucet.circle.com, and run with PAYER2_ACCOUNT=pact-payer2 PAYER2_ADDRESS=0x..."
  [[ "$(cast chain-id --rpc-url "$RPC_URL")" == "$CHAIN_ID" ]] || die "RPC $RPC_URL is not chain $CHAIN_ID"
  [[ "$(cast code "$PACT_SPLIT" --rpc-url "$RPC_URL")" != "0x" ]] || die "No contract at $PACT_SPLIT"
  if [[ -z "$PAYER2_ADDRESS" ]]; then
    info "PAYER2_ADDRESS not set, asking cast (enter the $PAYER2_ACCOUNT password)"
    PAYER2_ADDRESS="$(cast wallet address --account "$PAYER2_ACCOUNT")"
  fi
else
  PAYER2_ACCOUNT="${PAYER2_ACCOUNT:-<payer2_account>}"
  PAYER2_ADDRESS="${PAYER2_ADDRESS:-<payer2_address>}"
fi

HOST_ADDRESS="$(echo "$HOST_ADDRESS" | tr 'A-F' 'a-f')"
PAYER2_ADDRESS="$(echo "$PAYER2_ADDRESS" | tr 'A-F' 'a-f')"
PAYEE="$(echo "$PAYEE" | tr 'A-F' 'a-f')"
[[ "$PAYER2_ADDRESS" != "$HOST_ADDRESS" ]] || die "PAYER2_ADDRESS must differ from HOST_ADDRESS"

# A pact key the way the app makes it: 16 uuid bytes, then 16 zero bytes.
new_pact_key() { echo "0x$(uuidgen | tr -d '-' | tr 'A-F' 'a-f')00000000000000000000000000000000"; }

# ---- Chain helpers ----

# send LABEL KEYSTORE [cast send args...]  -> sends, checks status, logs the hash
send() {
  local label="$1" acct="$2"; shift 2
  local cmd=(cast send "$PACT_SPLIT" "$@" --account "$acct" --rpc-url "$RPC_URL" --chain "$CHAIN_ID" --json)
  info "\$$(printf ' %q' "${cmd[@]}")"
  if [[ $DRY_RUN -eq 1 ]]; then return 0; fi
  local out hash status
  out="$("${cmd[@]}")" || die "$label: cast send failed"
  hash="$(jq -r '.transactionHash' <<<"$out")"
  status="$(jq -r '.status' <<<"$out")"
  log "- TX $label: \`$hash\` (status $status) ${EXPLORER_TX}${hash}"
  info "tx   $hash"
  info "link ${EXPLORER_TX}${hash}"
  [[ "$status" == "0x1" || "$status" == "1" ]] || die "$label: tx $hash reverted (status $status)"
  pass "$label mined"
}

# expect_revert LABEL FROM ERR_SELECTOR ERR_NAME [cast call args...]  -> simulate, assert it reverts with that error
expect_revert() {
  local label="$1" from="$2" sel="$3" name="$4"; shift 4
  local cmd=(cast call "$PACT_SPLIT" "$@" --from "$from" --rpc-url "$RPC_URL")
  info "\$$(printf ' %q' "${cmd[@]}")   (expect revert $name)"
  if [[ $DRY_RUN -eq 1 ]]; then return 0; fi
  local out
  if out="$("${cmd[@]}" 2>&1)"; then
    fail "$label: did NOT revert (expected $name)"
  elif grep -qi -e "$sel" -e "$name" <<<"$out"; then
    pass "$label reverts with $name"
  else
    fail "$label: reverted, but not with $name: $(tr '\n' ' ' <<<"$out" | cut -c1-200)"
  fi
}

# pact_field KEY N  -> field N (1-based) of pacts(key): host payee share needed paid deadline state
pact_field() {
  cast call "$PACT_SPLIT" "pacts(bytes32)(address,address,uint128,uint32,uint32,uint64,uint8)" "$1" \
    --rpc-url "$RPC_URL" | sed -n "${2}p" | awk '{print $1}' | tr 'A-F' 'a-f'
}

# check_pact LABEL KEY WANT_STATE WANT_PAID
check_pact() {
  local label="$1" key="$2" want_state="$3" want_paid="$4"
  info "\$ cast call $PACT_SPLIT 'pacts(bytes32)(...)' $key"
  if [[ $DRY_RUN -eq 1 ]]; then return 0; fi
  local state paid
  state="$(pact_field "$key" 7)"
  paid="$(pact_field "$key" 5)"
  if [[ "$state" == "$want_state" && "$paid" == "$want_paid" ]]; then
    pass "$label: state ${STATE_NAMES[$state]}, sharesPaid $paid"
  else
    fail "$label: state ${STATE_NAMES[$state]:-$state} sharesPaid $paid, wanted ${STATE_NAMES[$want_state]} / $want_paid"
  fi
}

# check_paid LABEL KEY ADDRESS WANT(true|false)
check_paid() {
  local label="$1" key="$2" who="$3" want="$4"
  info "\$ cast call $PACT_SPLIT 'paid(bytes32,address)(bool)' $key $who"
  if [[ $DRY_RUN -eq 1 ]]; then return 0; fi
  local got
  got="$(cast call "$PACT_SPLIT" "paid(bytes32,address)(bool)" "$key" "$who" --rpc-url "$RPC_URL")"
  if [[ "$got" == "$want" ]]; then pass "$label: paid[$who] = $got"; else fail "$label: paid[$who] = $got, wanted $want"; fi
}

balance() { if [[ $DRY_RUN -eq 1 ]]; then echo 0; else cast balance "$1" --rpc-url "$RPC_URL"; fi; }

# check_delta LABEL BEFORE AFTER WANT_DELTA  (big-number safe; balances overflow bash ints)
check_delta() {
  local label="$1" before="$2" after="$3" want="$4"
  if [[ $DRY_RUN -eq 1 ]]; then info "(dry run) would check $label changes by $want wei"; return 0; fi
  local got
  got="$(echo "$after - $before" | bc)"
  if [[ "$got" == "$want" ]]; then pass "$label changed by $got wei"; else fail "$label changed by $got wei, wanted $want"; fi
}

# ---- Run ----
TOTAL_WEI="$(echo "$SHARE_WEI * 2" | bc)"
NEG_SHARE="$(echo "0 - $SHARE_WEI" | bc)"
NEG_TOTAL="$(echo "0 - $TOTAL_WEI" | bc)"
WRONG_WEI="$(echo "$SHARE_WEI + 1" | bc)"
DEADLINE="$(( $(date +%s) + DEADLINE_SECS ))"
PACT1="$(new_pact_key)"
PACT2="$(new_pact_key)"

say "PactSplit smoke test $( [[ $DRY_RUN -eq 1 ]] && echo '(DRY RUN, nothing is sent)')"
info "rpc       $RPC_URL (chain $CHAIN_ID)"
info "contract  $PACT_SPLIT"
info "host      $HOST_ADDRESS ($ACCOUNT)"
info "payer2    $PAYER2_ADDRESS ($PAYER2_ACCOUNT)"
info "payee     $PAYEE"
info "share     $SHARE_WEI wei (0.01 USDC), deadline $DEADLINE"
info "pact 1    $PACT1"
info "pact 2    $PACT2"
info "results   $RESULTS_FILE"

if [[ $DRY_RUN -eq 0 ]]; then
  info "host balance   $(cast balance "$HOST_ADDRESS" --rpc-url "$RPC_URL" --ether) USDC"
  info "payer2 balance $(cast balance "$PAYER2_ADDRESS" --rpc-url "$RPC_URL" --ether) USDC"
  {
    printf '\n## Run %s\n\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    printf -- '- Contract `%s` on chain %s\n- Host `%s`, payer2 `%s`, payee `%s`\n' \
      "$PACT_SPLIT" "$CHAIN_ID" "$HOST_ADDRESS" "$PAYER2_ADDRESS" "$PAYEE"
    printf -- '- Pact 1 `%s`\n- Pact 2 `%s`\n\n' "$PACT1" "$PACT2"
  } >> "$RESULTS_FILE"
fi

# ---------- Pact 1: open, pay 2 shares, release ----------
say "Pact 1: host opens a 2-share pact"
send "pact1 createPact" "$ACCOUNT" "createPact(bytes32,address,uint128,uint32,uint64)" \
  "$PACT1" "$PAYEE" "$SHARE_WEI" 2 "$DEADLINE"
check_pact "pact1 after create" "$PACT1" 1 0

say "Pact 1: host pays share 1"
c0="$(balance "$PACT_SPLIT")"
send "pact1 payShare (host)" "$ACCOUNT" "payShare(bytes32)" "$PACT1" --value "$SHARE_WEI"
check_pact "pact1 after share 1" "$PACT1" 1 1
check_paid "pact1 after share 1" "$PACT1" "$HOST_ADDRESS" true
check_delta "contract balance after share 1" "$c0" "$(balance "$PACT_SPLIT")" "$SHARE_WEI"

say "Pact 1: calls that must revert (simulated, nothing sent)"
expect_revert "double pay by host" "$HOST_ADDRESS" "$ERR_ALREADY_PAID" "AlreadyPaid" \
  "payShare(bytes32)" "$PACT1" --value "$SHARE_WEI"
expect_revert "wrong amount by payer2" "$PAYER2_ADDRESS" "$ERR_WRONG_AMOUNT" "WrongAmount" \
  "payShare(bytes32)" "$PACT1" --value "$WRONG_WEI"
expect_revert "release by non-host (payer2)" "$PAYER2_ADDRESS" "$ERR_NOT_HOST" "NotHost" \
  "release(bytes32)" "$PACT1"
expect_revert "release by host before full" "$HOST_ADDRESS" "$ERR_NOT_FULL" "NotFull" \
  "release(bytes32)" "$PACT1"

say "Pact 1: payer2 pays share 2"
send "pact1 payShare (payer2)" "$PAYER2_ACCOUNT" "payShare(bytes32)" "$PACT1" --value "$SHARE_WEI"
check_pact "pact1 after share 2" "$PACT1" 1 2
check_paid "pact1 after share 2" "$PACT1" "$PAYER2_ADDRESS" true
expect_revert "release by non-host when full (payer2)" "$PAYER2_ADDRESS" "$ERR_NOT_HOST" "NotHost" \
  "release(bytes32)" "$PACT1"

say "Pact 1: host releases to the payee"
c0="$(balance "$PACT_SPLIT")"
p0="$(balance "$PAYEE")"
send "pact1 release" "$ACCOUNT" "release(bytes32)" "$PACT1"
check_pact "pact1 after release" "$PACT1" 2 2
check_delta "contract balance after release" "$c0" "$(balance "$PACT_SPLIT")" "$NEG_TOTAL"
if [[ "$PAYEE" != "$HOST_ADDRESS" && "$PAYEE" != "$PAYER2_ADDRESS" ]]; then
  check_delta "payee balance after release" "$p0" "$(balance "$PAYEE")" "$TOTAL_WEI"
else
  info "payee is a signer here, so its balance also moves by gas; checked the contract balance instead"
fi
expect_revert "release again" "$HOST_ADDRESS" "$ERR_NOT_OPEN" "NotOpen" "release(bytes32)" "$PACT1"

# ---------- Pact 2: open, pay, cancel, refund ----------
say "Pact 2: host opens a 1-share pact"
send "pact2 createPact" "$ACCOUNT" "createPact(bytes32,address,uint128,uint32,uint64)" \
  "$PACT2" "$PAYEE" "$SHARE_WEI" 1 "$DEADLINE"
check_pact "pact2 after create" "$PACT2" 1 0

say "Pact 2: host pays its share"
c0="$(balance "$PACT_SPLIT")"
send "pact2 payShare (host)" "$ACCOUNT" "payShare(bytes32)" "$PACT2" --value "$SHARE_WEI"
check_pact "pact2 after pay" "$PACT2" 1 1
check_delta "contract balance after pact2 pay" "$c0" "$(balance "$PACT_SPLIT")" "$SHARE_WEI"
expect_revert "cancel by non-host before deadline (payer2)" "$PAYER2_ADDRESS" "$(cast sig 'CannotCancel()')" \
  "CannotCancel" "cancel(bytes32)" "$PACT2"

say "Pact 2: host cancels"
send "pact2 cancel" "$ACCOUNT" "cancel(bytes32)" "$PACT2"
check_pact "pact2 after cancel" "$PACT2" 3 1
expect_revert "pay after cancel (payer2)" "$PAYER2_ADDRESS" "$ERR_NOT_OPEN" "NotOpen" \
  "payShare(bytes32)" "$PACT2" --value "$SHARE_WEI"

say "Pact 2: host claims the refund"
c0="$(balance "$PACT_SPLIT")"
send "pact2 claimRefund (host)" "$ACCOUNT" "claimRefund(bytes32)" "$PACT2"
check_paid "pact2 after refund" "$PACT2" "$HOST_ADDRESS" false
check_delta "contract balance after refund" "$c0" "$(balance "$PACT_SPLIT")" "$NEG_SHARE"
expect_revert "second refund" "$HOST_ADDRESS" "$ERR_NOTHING_TO_REFUND" "NothingToRefund" \
  "claimRefund(bytes32)" "$PACT2"
expect_revert "refund by non-payer (payer2)" "$PAYER2_ADDRESS" "$ERR_NOTHING_TO_REFUND" "NothingToRefund" \
  "claimRefund(bytes32)" "$PACT2"

# ---------- Summary ----------
say "Done: $PASS passed, $FAIL failed"
if [[ $DRY_RUN -eq 0 ]]; then
  printf '\n**Result: %s passed, %s failed**\n' "$PASS" "$FAIL" >> "$RESULTS_FILE"
  info "host balance   $(cast balance "$HOST_ADDRESS" --rpc-url "$RPC_URL" --ether) USDC"
  info "payer2 balance $(cast balance "$PAYER2_ADDRESS" --rpc-url "$RPC_URL" --ether) USDC"
  info "tx hashes saved to $RESULTS_FILE"
fi
[[ $FAIL -eq 0 ]]
