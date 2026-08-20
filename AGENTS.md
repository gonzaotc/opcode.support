# Working on this repo

Measure which **EVM opcodes** are supported on the **top 50 EVM chains by TVL**, by probing live
nodes. Availability only: not a chain diff, not semantics, not gas costs. See [README](./README.md)
for the method and its limits.

## Layout

| path | touch it when |
| --- | --- |
| `config/opcodes.json` | adding an opcode |
| `config/selection.json` | topN, reference chain, chain id overrides, exclusions, seed RPCs |
| `data/*.json` | never by hand: `chains.json` from `npm run chains`, `results.json` from `npm run probe` |
| `schema/results.schema.json` | `results.json` shape changes |
| `scripts/endpoints.mjs` | operator identity, pool ordering |
| `scripts/classify.mjs` | a node wording is unrecognised |
| `scripts/rpc.mjs` | transport, retry, concurrency |
| `scripts/probe.mjs` | calibration, probing, reconciliation |
| `scripts/report.mjs` | presentation |

A new opcode needs a snippet that satisfies its stack inputs with `PUSH0`, one `0x5f` per input, then
the opcode byte. Wrong arity reverts for the wrong reason and reads as unsupported; the
reference-chain guard catches it.

## Invariants, do not remove

Each exists because its absence produced a wrong answer.

- **Calibration.** `STOP` must pass and `0x0c` must fail per endpoint. Hedera ignores state overrides
  and Rootstock accepts creation calls without executing them, so both would report everything
  supported.
- **Independent operators.** Two endpoints behind one provider are one witness. `reconcile` rejects
  same-operator agreement; `endpoints.mjs` derives operator reach from how many chains a domain
  serves, never a hardcoded provider list.
- **`unknown` is a valid answer.** Rate limits and unrecognised errors must never read as
  `unsupported`. That bug produced four wrong verdicts.
- **Nothing trusts a name.** The registry lists chain 999 as Wanchain Testnet. Inclusion requires a
  live `eth_chainId`.
- **Unmeasurable is not excluded.** Tron verifies its chain id but cannot execute arbitrary bytecode,
  so it stays at rank 4 as `no-calibrated-endpoint`. `exclude` is only for non-EVM TVL, and is empty.
- **No silent drops.** `npm run chains` warns on any chain above the cutoff without a resolvable id.
  DefiLlama's EVM tag filters those warnings only, never inclusion.
- **`data/chains.json` is pinned.** Regenerate deliberately, never in CI. Its `rpcUrls` are verified;
  `selection.json` holds seeds only for chains the registry cannot cover.
- **No gas, ever.** Everything is `eth_call`.

## Verifying a change

Re-run `npm run probe` and diff verdicts against the previous `data/results.json`. Verdicts are stable
run to run, so anything that moves is a real chain change or a bug. A drop in
`coverage.byConfidence.confirmed` means endpoints degraded, not that chains changed.
`snippetCheck.suspectSnippets` stays empty.

`tvl` measures representativeness. A chain counts toward `analyzedUsd` only with a confirmed verdict,
so an unscannable chain contributes nothing however large. Denominators are pinned at selection time.
