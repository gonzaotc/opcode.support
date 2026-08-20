# opcode.support

Which EVM opcodes are supported on which chains, measured against live nodes rather than read off
documentation.

**[REPORT.md](./REPORT.md)** holds the current table. Raw output with per-endpoint evidence lives in
[`data/results.json`](./data/results.json).

Scope is the top 30 EVM chains by TVL, and the opcodes a library maintainer has to make decisions
about. Built because the existing tools cover 9 to 15 chains, and because chain documentation is
often wrong or silent about this.

## Why it needs no funding

Every check is an `eth_call`, which is a simulation on a node. Nothing is broadcast, no transaction
is signed, no gas is spent. There is no wallet, no private key, and no paid API key anywhere in the
pipeline.

## How a verdict is reached

For each opcode the probe builds a minimal snippet that satisfies the opcode's stack inputs with
`PUSH0`. `TSTORE` becomes `0x5f5f5d`. A clean run means the opcode exists, a rejection means it does
not, and no error-string parsing is needed for the common case.

Two read-only ways to make a node execute that snippet are tried in order:

1. `eth_call` with a state override placing the snippet as code at a dummy address
2. `eth_call` with no `to`, so the snippet is treated as contract creation code

**Every endpoint is calibrated before its answers count.** `STOP` (`0x00`) must succeed and `0x0c`,
which is undefined in every fork, must fail. This is not ceremony. Some endpoints silently ignore
state overrides and would report every opcode as supported; others accept creation calls without
executing them and would do the same. Both are present among the top 30 chains today.

Two further rules keep the table honest:

- A verdict needs **two calibrated endpoints run by different operators to agree**. One endpoint is
  one witness, and two endpoints behind the same provider are still one witness.
- Failures that are not attributable to the EVM, such as rate limits and plan quotas, are recorded as
  unconfirmed rather than counted as unsupported. An unrecognised failure is left unattributed too,
  so a novel rejection wording degrades to unconfirmed instead of a wrong verdict.

Anything unresolved stays `?` with its reason, and is excluded from the support percentages.

Working on this repo: see [AGENTS.md](./AGENTS.md).

## Running it

```sh
npm run probe    # writes data/results.json
npm run report   # writes REPORT.md
npm run chains   # regenerates chains.json from DefiLlama TVL, do this deliberately
```

Node 20 or newer, no dependencies.

CI runs the probe daily and commits any change. `workflow_dispatch` is the manual re-check, which is
what to use the day after a hardfork.

## Adding an opcode

Add an entry to [`opcodes.json`](./opcodes.json) with a snippet whose stack inputs are satisfied, and
set `enabled` to true. Several are already defined and switched off.

## Chain list

`chains.json` is generated from DefiLlama TVL, then pinned. It is pinned on purpose: a list that
reshuffles weekly makes the table impossible to compare over time.

Identity is never taken on trust. `ethereum-lists/chains` is used only as a source of endpoints, since
its metadata is unreliable for this purpose, and a chain is included only once a live endpoint
confirms its `eth_chainId`. Chains ranking above the cutoff without a resolvable id are reported as a
TODO rather than dropped silently. Selection rules live in `selection.json`.

Whether a chain is EVM is decided by measurement, not by metadata, in both directions. Chains
DefiLlama does not tag EVM but which verifiably execute EVM bytecode are included, and chains it does
tag EVM but whose RPC cannot execute arbitrary bytecode appear at their true TVL rank as unconfirmed
rather than being dropped.

Each pool is ordered so chain-operated endpoints come first and consecutive endpoints have different
operators, with operator reach inferred from how many chains a domain serves.

## Limits

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`, so availability cannot tell them apart.
- Prague adds no opcode, so it cannot be probed this way at all.
- On chains whose native toolchain targets a different VM, this measures the EVM path the RPC
  exposes, which is not necessarily what a natively compiled contract runs on.
- Availability is not semantics. Gas costs and edge-case behaviour are out of scope.
