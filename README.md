# opcode.support

Which EVM opcodes are supported on which chains, measured against live nodes rather than read off
documentation. Top 50 EVM chains by TVL.

**[REPORT.md](./REPORT.md)** is the table. `data/results.json` is the same data with per-endpoint
evidence, described by [`schema/results.schema.json`](./schema/results.schema.json).

## No funding needed

Every check is an `eth_call`, a simulation on a node. Nothing is broadcast, no gas is spent, and
there is no wallet, key, or paid API key anywhere in the pipeline.

## How a verdict is reached

Each opcode has a snippet whose stack inputs are satisfied by `PUSH0`, so a clean run means supported
and a rejection means unsupported. `TSTORE` is `0x5f5f5d`. Two read-only ways to execute it are tried
per endpoint: `eth_call` with a state override, then `eth_call` with no `to`.

Three rules keep the table honest:

- **Calibration.** `STOP` must succeed and `0x0c`, undefined in every fork, must fail, or the
  endpoint is discarded. Some endpoints ignore state overrides and would report everything as
  supported; others accept creation calls without executing them.
- **Independent operators.** A verdict needs two calibrated endpoints run by different operators.
  Two endpoints behind one provider are one witness.
- **Unattributable failures are not evidence.** Rate limits, quotas and unrecognised errors are
  recorded as unconfirmed, never as unsupported.

Anything unresolved stays `?` with a reason and is excluded from the percentages, including from the
TVL representativeness figure the report prints.

## Layout

```
config/     inputs you edit: selection rules, opcode list
data/       generated: pinned chain list, results
schema/     JSON Schema for results.json
scripts/    the collector and report generator
```

## Running it

```sh
npm run probe    # data/results.json
npm run report   # REPORT.md
npm run chains   # regenerate data/chains.json, changes the chain set
```

Node 20+, zero dependencies. CI runs probe then report daily and commits on change;
`workflow_dispatch` is the post-hardfork re-check.

## Chain selection

Pinned on purpose: a list that reshuffles weekly cannot be compared over time.

Identity is never taken on trust. `ethereum-lists/chains` supplies endpoints only, since its metadata
is unreliable here (it lists chain 999 as Wanchain Testnet), and a chain is included only once a live
endpoint confirms its `eth_chainId`. Whether a chain is EVM is decided by measurement in both
directions: chains DefiLlama does not tag EVM but which verifiably execute EVM bytecode are included,
and chains it does tag but whose RPC cannot execute arbitrary bytecode appear at their true TVL rank
as unconfirmed rather than being dropped.

## Limits

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`, so availability cannot tell them apart.
- Prague adds no opcode, so it cannot be probed this way.
- On chains whose native toolchain targets another VM, this measures the EVM path the RPC exposes.
- Availability is not semantics. Gas costs and edge-case behaviour are out of scope.
