# Working on this repo

## Objective

Measure which **EVM opcodes** are supported on the **top 30 EVM chains by TVL**, by probing live
nodes. Not a chain diff tool, not a semantics or gas-cost tool. Availability only.

Output is [REPORT.md](./REPORT.md) (human) and [data/results.json](./data/results.json) (machine,
with per-endpoint evidence).

## Layout

| file | purpose | touch it when |
| --- | --- | --- |
| `opcodes.json` | opcode list with bytecode snippets | adding or enabling an opcode |
| `selection.json` | topN, reference chain, chain id overrides, non-EVM exclusions | selection rules change |
| `chains.json` | pinned top 30 with verified RPC pool | never by hand, run `npm run chains` |
| `extra-rpcs.json` | supplementary endpoints per chain id | a chain has fewer than 2 operators |
| `scripts/endpoints.mjs` | operator identity and pool ordering | endpoint selection strategy |
| `scripts/classify.mjs` | infrastructure vs EVM-rejection error patterns | a node's wording is unrecognised |
| `scripts/rpc.mjs` | JSON-RPC call, retry, concurrency pool | transport behaviour |
| `scripts/probe.mjs` | calibration, probing, witness reconciliation | the measurement logic |
| `scripts/report.mjs` | REPORT.md generator | presentation |
| `scripts/build-chains.mjs` | regenerates `chains.json` | the chain selection rule |

## How a verdict is reached

1. Each opcode has a snippet whose stack inputs are satisfied by `PUSH0`, so a clean run means
   supported and a rejection means unsupported. `TSTORE` is `0x5f5f5d`.
2. Two read-only ways to execute it are tried per endpoint: `eth_call` with a state override, then
   `eth_call` with no `to`.
3. Each endpoint is **calibrated** first: `0x00` must succeed, `0x0c` must fail.
4. A status is recorded only when **two calibrated endpoints run by different operators agree**.

## Invariants, do not remove

- **Calibration.** Some endpoints ignore state overrides and report every opcode as supported;
  others accept creation calls without executing them. Both exist in the current top 30 (Hedera,
  Rootstock). Without calibration the table is confidently wrong.
- **Two independent operators.** One endpoint is one witness and can misreport. Two endpoints behind
  the same provider are still one witness, so `endpoints.mjs` orders each pool to put chain-operated
  endpoints first and alternate operators, and `reconcile` rejects same-operator agreement as
  `single-operator`. Operator reach is derived from how many chains a domain serves, not from a
  maintained list of provider names.
- **Nothing trusts a name.** `ethereum-lists/chains` lists chain 999 as Wanchain Testnet and 1514 as
  Data Network, both wrong for our purposes. A chain enters `chains.json` only once a live endpoint
  confirms its `eth_chainId`, and the registry is used purely as an RPC source.
- **No silent drops.** A chain that ranks above the cutoff without a resolvable id is reported by
  `npm run chains` as a TODO. That warning is how three real EVM chains (Flare, PulseChain, X Layer)
  were found missing. Never suppress it; resolve it in `selection.json`.
- **`unknown` is a valid answer.** Provider rate limits, plan quotas and unrecognised errors must
  never be counted as `unsupported`. This is the failure mode that produced four wrong verdicts
  during development.
- **`chains.json` is pinned on purpose.** A list that reshuffles with TVL makes the table
  incomparable over time. Regenerate deliberately, not in CI.
- **No gas, ever.** Everything is `eth_call`. No wallet, no key, no paid API key. Any design that
  needs a funded deployment is out of scope.

## Commands

```sh
npm run probe    # data/results.json
npm run report   # REPORT.md
npm run all      # both
npm run chains   # regenerate chains.json (deliberate, changes the chain set)
```

Node 20+, zero dependencies. CI runs `probe` then `report` daily and commits on change;
`workflow_dispatch` is the post-hardfork manual re-check.

## Verifying a change

Re-run `npm run probe` and diff verdicts against the previous `data/results.json`. Verdicts should be
stable run to run; anything that moves is either a real chain change or a bug in your change. Watch
`coverage.byConfidence` too: a drop in `confirmed` means endpoints degraded, not that chains changed.

`snippetCheck.suspectSnippets` lists opcodes reported unsupported on the reference chain, which almost
always means a malformed snippet rather than a real gap. It should stay empty.

## Limits worth knowing before proposing work

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`. Availability cannot distinguish them.
- Prague adds no opcode, so it is unprobeable by this method.
- On chains whose native toolchain targets a different VM, this measures the EVM path the RPC
  exposes, not what a natively compiled contract runs on.
