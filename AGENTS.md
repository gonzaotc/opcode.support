# Working on this repo

## Objective

Measure which **EVM opcodes** are supported on the **top 30 EVM chains by TVL** by probing live
nodes. Availability only: not a chain diff tool, not semantics, not gas costs.

## Layout

| path | purpose | touch it when |
| --- | --- | --- |
| `config/opcodes.json` | opcodes and their snippets | adding an opcode |
| `config/selection.json` | topN, reference chain, chain id overrides, exclusions, seed RPCs | selection changes |
| `data/chains.json` | pinned top 30, generated | never by hand, run `npm run chains` |
| `data/results.json` | the measurement, generated | never by hand |
| `schema/results.schema.json` | documents `results.json` | its shape changes |
| `scripts/endpoints.mjs` | operator identity, pool ordering | endpoint strategy |
| `scripts/classify.mjs` | infrastructure vs EVM-rejection patterns | a node wording is unrecognised |
| `scripts/rpc.mjs` | JSON-RPC, retry, concurrency | transport behaviour |
| `scripts/probe.mjs` | calibration, probing, reconciliation | measurement logic |
| `scripts/report.mjs` | REPORT.md | presentation |

To add an opcode, write a snippet that satisfies its stack inputs with `PUSH0`, one `0x5f` per input,
then the opcode byte. Wrong arity makes it revert for the wrong reason and read as unsupported; the
reference-chain guard catches that.

## Invariants, do not remove

- **Calibration.** Some endpoints ignore state overrides and report every opcode as supported; others
  accept creation calls without executing them. Both exist in the current top 30 (Hedera, Rootstock).
  Without calibration the table is confidently wrong.
- **Independent operators.** Two endpoints behind one provider are one witness. `endpoints.mjs`
  orders pools to put chain-operated endpoints first and alternate operators, with operator reach
  derived from how many chains a domain serves rather than a provider list. `reconcile` rejects
  same-operator agreement.
- **`unknown` is a valid answer.** Rate limits, quotas and unrecognised errors must never count as
  `unsupported`. That bug produced four wrong verdicts during development.
- **Nothing trusts a name.** `ethereum-lists/chains` lists chain 999 as Wanchain Testnet and 1514 as
  Data Network. A chain enters `data/chains.json` only once a live endpoint confirms its `eth_chainId`.
- **"Excluded" and "unmeasurable" are different claims.** A chain we cannot probe belongs in the table
  as unconfirmed. Tron verifies its chain id but its RPC cannot execute arbitrary bytecode, so it sits
  at rank 4 as `no-calibrated-endpoint`. `exclude` is only for names whose DefiLlama TVL belongs to a
  non-EVM environment, and is currently empty.
- **No silent drops.** A chain above the cutoff without a resolvable id is reported as a TODO by
  `npm run chains`. That warning found five real EVM chains missing. It is filtered by DefiLlama's own
  EVM tag to stay actionable, and that tag is used only for filtering warnings, never for inclusion,
  so if the endpoint changes the warnings degrade but the table does not. Residual risk: a chain with
  both a null chain id and no EVM tag skips silently.
- **`data/chains.json` is pinned.** A list reshuffling with TVL cannot be compared over time.
  Regenerate deliberately, never in CI. Its `rpcUrls` are the *verified* pool; `config/selection.json`
  holds only *seed* endpoints for the 12 chains where `ethereum-lists/chains` alone cannot supply two
  working operators. Do not add seeds a chain does not need.
- **No gas, ever.** Everything is `eth_call`. Any design needing a funded deployment is out of scope.

## Verifying a change

Re-run `npm run probe` and diff verdicts against the previous `data/results.json`. Verdicts should be
stable run to run; anything that moves is a real chain change or a bug in your change. Watch
`coverage.byConfidence`: a drop in `confirmed` means endpoints degraded, not that chains changed.
`snippetCheck.suspectSnippets` should stay empty.

## Limits before proposing work

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`, so availability cannot distinguish them.
- Prague adds no opcode, so it is unprobeable this way.
- On chains whose native toolchain targets another VM, this measures the EVM path the RPC exposes.
