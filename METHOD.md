# Method

How a verdict is reached. The table is in the [README](./README.md);
`data/generated-results.json` holds the evidence behind every cell, described by
[`schema/results.schema.json`](./schema/results.schema.json).

Every check is an `eth_call`, a simulation on a node. Nothing is broadcast, no gas is spent, no key is
involved.

**1. Make the opcode runnable.** One `PUSH1 0x00` per stack input, then the opcode byte. `TSTORE` is
`0x600060005d`. Success or rejection is then binary, with no error text to parse. The filler is
`PUSH1` rather than `PUSH0` because `PUSH0` only exists from Shanghai, and on an older chain it fails
first and every verdict blames the filler instead of the opcode. A malformed snippet would read as
unsupported, so anything reported unsupported on Ethereum is flagged, not published.

**2. Execute it, three ways.** A chain only has to accept one.

| method | how | reaches |
| --- | --- | --- |
| `stateOverride` | `eth_call` to a dummy address with the snippet as its code | most chains |
| `nullTo` | `eth_call` with no `to`, so the data is creation code | chains that ignore overrides, e.g. Hedera |
| `factory` | `eth_call` to the CREATE2 factory at `0x4e59b448…`, snippet as initcode | chains that reject both, e.g. Rootstock |

The factory is pinned by its runtime code, since an address proves nothing about what lives there. Its
rejections are always generic: CREATE2 swallows the reason.

**3. Calibrate first.** Per endpoint and per method, `STOP` must succeed and `0x0c`, undefined in every
fork, must fail. The rule that matters most: some endpoints ignore state overrides and would report
every opcode as supported, and some accept creation calls without executing them.

**4. Probe every method that calibrated.** Two paths into the same EVM should agree, so a disagreement
is reported rather than hidden behind whichever ran first.

**5. A provider's excuse is not a chain's answer.** Rate limits, quotas and unrecognised failures are
retried, then recorded as unconfirmed. Never as unsupported.

**6. Two independent operators, or no confirmation.** Witnesses are grouped by registrable domain.
Extra methods on one endpoint add witnesses but never operators. Where only one operator answers, the
observation is recorded and marked `~`: it counts toward the TVL figure, since it is a real
measurement, but never toward the support percentages.

```
walk the endpoint pool until every opcode is confirmed:
  calibrate each method   -> discard the pair if it fails
  run every snippet       -> supported | unsupported | unattributable
reconcile per opcode:
  0 usable | contradiction | <2 witnesses | <2 operators  -> unknown, with the reason
  otherwise                                               -> the agreed status, confirmed
```

**7. Grade the evidence.** `invalid opcode: CLZ` names the cause. A bare `execution reverted` fits an
undefined opcode and anything else too, so it is marked `generic` and listed under the table. Where
witnesses agree, the one that names the cause is kept.

**8. Chains no probe reaches** get an answer from a primary source, marked `*` and held out of
`status` so it cannot enter a percentage. Like `~`, it counts toward the TVL figure. Tron is the case: its RPC cannot execute arbitrary bytecode, but its own activated
chain parameters state which forks are live.

## Files

`config/` is decided by a human. `data/` is generated, never hand-edited.

| file | role |
| --- | --- |
| `config/opcodes.json` | which opcodes to measure, and the snippet for each |
| `config/chain-selection.json` | how many chains, and the chain ids DefiLlama omits |
| `config/known-rpcs.json` | endpoints added by hand, per chain id |
| `config/unprobeable-chains.json` | sourced answers for chains no probe reaches |
| `data/generated-chains.json` | the pinned chain set, with a verified endpoint pool each |
| `data/generated-results.json` | the measurement |

## Chain selection

DefiLlama ranks the chains but returns no endpoints. `ethereum-lists/chains` supplies endpoints per
chain id, and `known-rpcs.json` fills the gaps, since the registry lists whatever people submitted:
often one URL for a new chain, sometimes none, sometimes dead. All 23 hand-added entries are
load-bearing, and for 7 chains they are the only endpoints there are.

Every URL is then asked `eth_chainId`, and only correct answers are kept, ordered so a chain-operated
endpoint leads and operators alternate. Nothing trusts a name: the registry lists chain 999 as
Wanchain Testnet. The result is pinned, because a list that reshuffles weekly cannot be compared over
time.

Whether a chain is EVM is decided by measurement both ways: chains DefiLlama does not tag EVM but
which verifiably run EVM bytecode are included, and chains it tags but which cannot run arbitrary
bytecode appear at their true TVL rank as unconfirmed rather than dropped.

## Running it

```sh
npm run probe    # data/generated-results.json
npm run report   # README.md
npm run chains   # regenerate the chain set
```

Node 20+, zero dependencies. CI probes daily and commits on change; `workflow_dispatch` is the
post-hardfork re-check.

## Limits

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`, so availability cannot tell them apart.
- Prague adds no opcode, so it cannot be probed this way.
- On chains whose native toolchain targets another VM, this measures the EVM path the RPC exposes.
- Availability is not semantics. Gas costs and edge-case behaviour are out of scope.
