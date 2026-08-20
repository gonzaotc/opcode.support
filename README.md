# opcode.support

Which EVM opcodes are supported on which chains, measured against live nodes instead of read off
documentation. Top 50 EVM chains by TVL.

**[REPORT.md](./REPORT.md)** is the table: `yes` supported, `no` unsupported, `?` no verdict.
`data/results.json` holds the same data with per-endpoint evidence and the reason behind every `?`,
described by [`schema/results.schema.json`](./schema/results.schema.json).

## How a verdict is reached

Every check is an `eth_call`, a simulation on a node. Nothing is broadcast, no gas is spent, and no
wallet, key or paid API key is involved.

Each opcode has a snippet whose stack inputs are satisfied by `PUSH0`, so a clean run means supported
and a rejection means unsupported. `TSTORE` is `0x5f5f5d`. Each endpoint is tried two read-only ways:
`eth_call` with a state override, then `eth_call` with no `to`.

Three rules keep the table honest:

- **Calibration.** `STOP` must succeed and `0x0c`, undefined in every fork, must fail, or the endpoint
  is discarded. Some endpoints ignore state overrides and would report everything as supported.
- **Independent operators.** A verdict needs two calibrated endpoints run by different operators. Two
  endpoints behind one provider are one witness.
- **Unattributable failures are not evidence.** Rate limits and unrecognised errors are recorded as
  unconfirmed, never as unsupported.

Anything unresolved stays `?`, excluded from the percentages and from the TVL figure.

## Chain selection

Pinned on purpose: a list that reshuffles weekly cannot be compared over time.

Identity is never taken on trust. `ethereum-lists/chains` supplies endpoints only, since its metadata
is unreliable here, and inclusion requires a live `eth_chainId`. Whether a chain is EVM is decided by
measurement both ways: chains DefiLlama does not tag EVM but which verifiably run EVM bytecode are
included, and chains it tags but which cannot run arbitrary bytecode appear at their true TVL rank as
unconfirmed rather than dropped.

## Running it

```sh
npm run probe    # data/results.json
npm run report   # REPORT.md
npm run chains   # regenerate data/chains.json, changes the chain set
```

Node 20+, zero dependencies. `config/` is input, `data/` and `REPORT.md` are generated. CI probes
daily and commits on change; `workflow_dispatch` is the post-hardfork re-check.

## Limits

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`, so availability cannot tell them apart.
- Prague adds no opcode, so it cannot be probed this way.
- On chains whose native toolchain targets another VM, this measures the EVM path the RPC exposes.
- Availability is not semantics. Gas costs and edge-case behaviour are out of scope.
