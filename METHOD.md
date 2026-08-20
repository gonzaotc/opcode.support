# Method

How opcode.support decides whether a chain supports an opcode. The table it produces is in the
[README](./README.md); `data/results.json` holds the same data with per-endpoint evidence and the
reason behind every `?`, described by [`schema/results.schema.json`](./schema/results.schema.json).

Every check is an `eth_call`, a simulation on a node. Nothing is broadcast, no gas is spent, and no
wallet, key or paid API key is involved.

**1. Turn the opcode into runnable bytecode.** Each opcode is prefixed with one `PUSH0` (`0x5f`) per
stack input, so the snippet either runs cleanly or is rejected outright. `TSTORE` is `0x5f5f5d`. This
makes the signal binary instead of a parse of error text. A snippet with the wrong arity would revert
for the wrong reason and read as unsupported, so any opcode reported unsupported on Ethereum is
flagged as a suspect snippet rather than published.

**2. Make a node execute it, three ways.** A chain only has to accept one of them.

| method | how | reaches |
| --- | --- | --- |
| `stateOverride` | `eth_call` to a dummy address whose code is overridden with the snippet | most chains |
| `nullTo` | `eth_call` with no `to`, so the data is treated as creation code | chains that ignore overrides, such as Hedera |
| `factory` | `eth_call` to the CREATE2 factory already deployed at `0x4e59b448…`, with the snippet as initcode | chains that reject both of the above, such as Rootstock |

The factory is pinned by its runtime code, not just its address, since an address alone proves nothing
about what lives there. Its rejections are always generic, because CREATE2 swallows the reason.

**3. Calibrate before trusting anything.** Per endpoint and per method, `STOP` must succeed and
`0x0c`, undefined in every fork, must fail. Uncalibrated combinations are discarded and the reason is
recorded. This is the rule that matters most: some endpoints ignore state overrides and would report
every opcode as supported, and some accept creation calls without executing them.

**4. Probe every method that calibrated**, not just the first. Two paths into the same EVM should
agree, so a disagreement is reported rather than hidden behind whichever ran first.

**5. Separate a chain's answer from a provider's excuse.** A rate limit, quota or unrecognised failure
is retried, then recorded as unconfirmed. It is never read as unsupported.

**6. Require two independent operators.** Verdicts are grouped by the endpoint's registrable domain.
Extra methods on one endpoint add witnesses but never operators, so two endpoints behind one provider
stay one witness.

```
for each chain, walk its endpoint pool until every opcode is confirmed:
  for each method:
    calibrate(method, endpoint)          -> discard the pair if it fails
    run every snippet                    -> supported | unsupported | unattributable
  reconcile all observations per opcode:
    0 usable                             -> unknown, no-calibrated-endpoint
    they contradict                       -> unknown, witnesses-disagree
    < 2 witnesses                         -> unknown, single-witness
    < 2 operators                         -> unknown, single-operator
    otherwise                             -> the agreed status, confirmed
```

**7. Grade the evidence.** `EVM error: NotActivated` and `invalid opcode: CLZ` name the cause.
A bare `execution reverted` is consistent with an undefined opcode but with other failures too, so it
is marked `generic` and listed under the table. Where witnesses agree, the one that names the cause is
the one recorded.

**8. Chains no probe reaches** keep an answer from a primary source, marked with an asterisk and held
out of `status`, so it can never enter a percentage. Tron is the case: its RPC cannot execute
arbitrary bytecode, but its own activated chain parameters state which forks are live.

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
npm run report   # README.md
npm run chains   # regenerate data/chains.json, changes the chain set
```

Node 20+, zero dependencies. `config/` is input, `data/` and `README.md` are generated. CI probes
daily and commits on change; `workflow_dispatch` is the post-hardfork re-check.

## Limits

- `PREVRANDAO` and `DIFFICULTY` share byte `0x44`, so availability cannot tell them apart.
- Prague adds no opcode, so it cannot be probed this way.
- On chains whose native toolchain targets another VM, this measures the EVM path the RPC exposes.
- Availability is not semantics. Gas costs and edge-case behaviour are out of scope.
