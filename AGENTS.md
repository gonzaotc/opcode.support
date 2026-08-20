# Working on this repo

Measure which **EVM opcodes** are supported on the **top 50 EVM chains by TVL**, by probing live
nodes. Availability only: not a chain diff, not semantics, not gas costs.

**Read [METHOD.md](./METHOD.md) first.** It is the single source of truth for how a verdict is
reached, why each rule exists, and what the method cannot answer. Do not restate it here.

`README.md` is generated output, not a hand-written page. Edit `scripts/report.mjs` instead.

## Layout

| path | touch it when |
| --- | --- |
| `config/opcodes.json` | adding an opcode |
| `config/chain-selection.json` | topN, reference chain, known chain ids, exclusions |
| `config/known-rpcs.json` | a chain needs endpoints the public registry does not list |
| `config/unprobeable-chains.json` | a chain no probe reaches gets a sourced answer |
| `data/generated-*.json` | never by hand: `npm run chains` and `npm run probe` write these |
| `schema/results.schema.json` | `generated-results.json` shape changes |
| `scripts/endpoints.mjs` | operator identity, pool ordering |
| `scripts/classify.mjs` | a node wording is unrecognised, or its evidence grade is wrong |
| `scripts/rpc.mjs` | transport, retry, concurrency |
| `scripts/probe.mjs` | calibration, probing, reconciliation |
| `scripts/report.mjs` | README.md |

## Rules that cost a wrong answer to learn

Every one of these is explained in METHOD.md. Do not remove one to simplify the code.

- Calibrate per endpoint *and* per strategy. Hedera and Rootstock both report everything as supported
  without it.
- Probe every calibrated strategy, not just the first. Disagreement is a signal.
- `unknown` is a valid answer. A rate limit is never an unsupported opcode.
- Two witnesses must be two operators. Extra strategies add witnesses, never operators.
- Nothing trusts a name. Inclusion requires a live `eth_chainId`.
- Unmeasurable is not excluded. `documented` never becomes a `status`.
- `data/generated-chains.json` is pinned. Regenerate deliberately, never in CI.
- No gas, ever. Everything is `eth_call`.

## Verifying a change

Re-run `npm run probe` and diff verdicts against the previous `data/generated-results.json`. Verdicts are stable
run to run, so anything that moves is a real chain change or a bug. A drop in
`coverage.byConfidence.confirmed` means endpoints degraded, not that chains changed.
`snippetCheck.suspectSnippets` stays empty, and `coverage.byGrade.generic` is the list to distrust
first.
