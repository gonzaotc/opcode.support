// Probes the chains in data/generated-chains.json and writes data/generated-results.json.
// Read-only: every check is an eth_call simulation, so no gas is ever spent and no key is needed.
import { readFileSync, writeFileSync } from 'node:fs';
import { rpc, pooled } from './rpc.mjs';
import { isEvmRejection, evidenceGrade } from './classify.mjs';
import { operator } from './endpoints.mjs';

const WITNESSES_REQUIRED = 2;
const MAX_ENDPOINTS = 5;
const CHAIN_CONCURRENCY = 5;
const PROBE_ADDRESS = '0x0000000000000000000000000000000000c0ffee';
// Arachnid's deterministic-deployment-proxy, present on most chains at the same address. It CREATE2s
// the calldata after the salt and reverts when creation fails. Pinned by runtime code, because an
// address alone proves nothing about what lives there.
const FACTORY = {
	address: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
	code: '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3',
	salt: 'c0ffee'.padEnd(64, '0'),
};

const { referenceChainId } = JSON.parse(readFileSync('config/chain-selection.json', 'utf8'));
const documented = JSON.parse(readFileSync('config/unprobeable-chains.json', 'utf8'));
const { opcodes, controls } = JSON.parse(readFileSync('config/opcodes.json', 'utf8'));
const { chains, topN, totalDefiTvlUsd, totalEvmTvlUsd } = JSON.parse(readFileSync('data/generated-chains.json', 'utf8'));

const ran = (res) => 'result' in res;
const attributable = (res) => (isEvmRejection(res.error) ? res.error : null);

// Three independent ways to make a node execute arbitrary bytecode without sending a transaction.
// Each says how to run a snippet, what success looks like, and which failures are the chain talking.
const STRATEGIES = {
	stateOverride: {
		run: (url, code) => rpc(url, 'eth_call', [{ to: PROBE_ADDRESS, data: '0x' }, 'latest', { [PROBE_ADDRESS]: { code } }]),
		succeeded: ran,
		rejection: attributable,
	},
	nullTo: {
		run: (url, code) => rpc(url, 'eth_call', [{ data: code }, 'latest']),
		succeeded: ran,
		rejection: attributable,
	},
	factory: {
		available: async (url) => {
			const res = await rpc(url, 'eth_getCode', [FACTORY.address, 'latest'], { attempts: 2 });
			return res.result === FACTORY.code;
		},
		run: (url, code) => rpc(url, 'eth_call', [{ to: FACTORY.address, data: `0x${FACTORY.salt}${code.slice(2)}` }, 'latest']),
		// Creation returns the new address. Chains that report a failed create as an empty result
		// rather than a revert, such as Rootstock, are only readable through the return value.
		succeeded: (res) => ran(res) && res.result !== '0x',
		rejection: (res) => (ran(res) ? 'create failed, empty return' : attributable(res)),
	},
};

// A strategy is only trustworthy on an endpoint when a universally defined opcode succeeds and a
// universally undefined one fails. Without this, endpoints that ignore state overrides or skip
// execution entirely report every opcode as supported.
async function calibrate(strategy, url) {
	if (strategy.available && !(await strategy.available(url))) return { ok: false, reason: 'strategy unavailable on this chain' };

	const positive = await strategy.run(url, controls.positive.snippet);
	if (positive.transportError) return { ok: false, reason: `positive control unreachable: ${positive.transportError}` };
	if (!strategy.succeeded(positive)) return { ok: false, reason: `positive control rejected: ${positive.error ?? 'empty result'}` };

	const negative = await strategy.run(url, controls.negative.snippet);
	if (negative.transportError) return { ok: false, reason: `negative control unreachable: ${negative.transportError}` };
	if (strategy.succeeded(negative)) return { ok: false, reason: 'negative control succeeded, endpoint does not execute the code' };

	// Kept as evidence: this is how the endpoint words a genuine opcode rejection.
	return { ok: true, rejectionExample: negative.error ?? 'empty return' };
}

// Turns one probe response into a verdict, refusing to guess when the failure is not attributable to
// the EVM rejecting the opcode.
function interpret(res, strategy) {
	if (res.transportError) return { status: 'unknown', reason: 'endpoint-unavailable', evidence: res.transportError };
	if (strategy.succeeded(res)) return { status: 'supported', evidence: 'executed', grade: 'executed' };
	const rejection = strategy.rejection(res);
	if (rejection) return { status: 'unsupported', evidence: rejection, grade: evidenceGrade(rejection) };
	return { status: 'unknown', reason: 'unattributable-error', evidence: res.error };
}

// Every strategy that calibrates is probed, not just the first. Two paths into the same EVM should
// agree, so a disagreement is a signal and not something to hide behind whichever ran first.
async function probeEndpoint(url) {
	const [client, block] = await Promise.all([rpc(url, 'web3_clientVersion', []), rpc(url, 'eth_blockNumber', [])]);
	const meta = { url, client: client.result ?? null, block: block.result ? Number.parseInt(block.result, 16) : null };
	const witnesses = [];

	for (const [name, strategy] of Object.entries(STRATEGIES)) {
		const calibration = await calibrate(strategy, url);
		if (!calibration.ok) {
			witnesses.push({ ...meta, strategy: name, calibrated: false, rejected: calibration.reason });
			continue;
		}
		const results = {};
		for (const opcode of opcodes) results[opcode.name] = interpret(await strategy.run(url, opcode.snippet), strategy);
		witnesses.push({ ...meta, strategy: name, calibrated: true, rejectionExample: calibration.rejectionExample, opcodes: results });
	}
	return witnesses;
}

// Verdicts from calibrated witnesses that reached a conclusion, tagged with who operates the endpoint
// and how it was reached. Everything else is not evidence.
const verdictsFor = (witnesses, opcodeName) =>
	witnesses
		.filter((w) => w.calibrated && w.opcodes[opcodeName]?.status !== 'unknown')
		.map((w) => ({ ...w.opcodes[opcodeName], operator: operator(w.url), strategy: w.strategy }));

// Two endpoints run by the same operator are one witness wearing two hats, so agreement only counts
// when it comes from independent operators. Extra strategies raise confidence in the method, never
// in the independence of the witnesses.
function reconcile(witnesses, opcodeName) {
	const verdicts = verdictsFor(witnesses, opcodeName);
	const operators = new Set(verdicts.map((v) => v.operator));
	const strategies = [...new Set(verdicts.map((v) => v.strategy))];
	const shared = { witnesses: verdicts.length, operators: operators.size, strategies };

	if (verdicts.length === 0) return { status: 'unknown', confidence: 'no-calibrated-endpoint', ...shared };
	if (new Set(verdicts.map((v) => v.status)).size > 1)
		return { status: 'unknown', confidence: 'witnesses-disagree', ...shared, evidence: verdicts.map((v) => `${v.strategy}@${v.operator}=${v.status}`).join(' ') };
	if (verdicts.length < WITNESSES_REQUIRED)
		return { status: 'unknown', confidence: 'single-witness', observed: verdicts[0].status, ...shared };
	if (operators.size < WITNESSES_REQUIRED)
		return { status: 'unknown', confidence: 'single-operator', observed: verdicts[0].status, ...shared };
	// Several witnesses agree, so record the one whose error names the cause.
	const best = verdicts.find((v) => v.grade === 'specific') ?? verdicts[0];
	return { status: verdicts[0].status, confidence: 'confirmed', ...shared, evidence: best.evidence, grade: best.grade };
}

const confirmable = (witnesses, opcodeName) => reconcile(witnesses, opcodeName).confidence === 'confirmed';

// Chains no probe can reach still have an answer, taken from a primary source and kept visibly
// separate: it never becomes a `status`, so it cannot leak into a percentage.
function attachDocumented(chain, verdicts) {
	const entry = documented[String(chain.chainId)];
	if (!entry) return verdicts;
	for (const [name, status] of Object.entries(entry.opcodes ?? {}))
		if (verdicts[name]?.status === 'unknown')
			verdicts[name] = { ...verdicts[name], documented: { status, source: entry.source, note: entry.note } };
	return verdicts;
}

async function probeChain(chain) {
	// Keep walking the endpoint pool until every opcode has enough usable verdicts, so one
	// rate-limited endpoint does not leave a hole in the table.
	const witnesses = [];
	for (const url of chain.rpcUrls.slice(0, MAX_ENDPOINTS)) {
		witnesses.push(...(await probeEndpoint(url)));
		if (opcodes.every((o) => confirmable(witnesses, o.name))) break;
	}

	const verdicts = attachDocumented(chain, Object.fromEntries(opcodes.map((o) => [o.name, reconcile(witnesses, o.name)])));
	const calibrated = witnesses.filter((w) => w.calibrated);
	console.log(
		`${String(chain.chainId).padStart(7)}  ${chain.name.padEnd(18)} ${calibrated.length}/${witnesses.length} calibrated ` +
			`[${[...new Set(calibrated.map((w) => w.strategy))].join(',') || 'none'}]  ` +
			opcodes.map((o) => `${o.name}=${verdicts[o.name].status}`).join(' '),
	);
	return { ...chain, witnesses, opcodes: verdicts };
}

const results = await pooled(chains, CHAIN_CONCURRENCY, probeChain);
results.sort((a, b) => b.tvlUsd - a.tvlUsd);

// An opcode reported unsupported on the reference chain almost certainly has a malformed snippet,
// since the reference chain is expected to support everything listed in config/opcodes.json.
const reference = results.find((c) => c.chainId === referenceChainId);
const suspectSnippets = reference
	? opcodes.filter((o) => reference.opcodes[o.name].status === 'unsupported').map((o) => o.name)
	: [];

const coverage = { cells: results.length * opcodes.length, byConfidence: {}, byGrade: {} };
for (const chain of results)
	for (const o of opcodes) {
		const cell = chain.opcodes[o.name];
		coverage.byConfidence[cell.confidence] = (coverage.byConfidence[cell.confidence] ?? 0) + 1;
		if (cell.grade) coverage.byGrade[cell.grade] = (coverage.byGrade[cell.grade] ?? 0) + 1;
	}

// How representative the table is. A chain only counts once it produced a confirmed verdict, so a
// chain we could not scan contributes nothing regardless of how large it is.
const scanned = (chain) => opcodes.some((o) => chain.opcodes[o.name].confidence === 'confirmed');
const sumTvl = (list) => list.reduce((sum, c) => sum + c.tvlUsd, 0);
const tvl = {
	topN,
	totalDefiUsd: totalDefiTvlUsd ?? null,
	totalEvmUsd: totalEvmTvlUsd ?? null,
	selectedUsd: sumTvl(results),
	analyzedUsd: sumTvl(results.filter(scanned)),
	unscanned: results.filter((c) => !scanned(c)).map((c) => ({ name: c.name, tvlUsd: c.tvlUsd })),
};

writeFileSync(
	'data/generated-results.json',
	`${JSON.stringify(
		{
			checkedAt: new Date().toISOString(),
			opcodes,
			coverage,
			tvl,
			snippetCheck: { referenceChainId, referenceProbed: Boolean(reference), suspectSnippets },
			chains: results,
		},
		null,
		'\t',
	)}\n`,
);

console.log(`\ncoverage: ${JSON.stringify(coverage.byConfidence)} of ${coverage.cells} cells`);
console.log(`evidence: ${JSON.stringify(coverage.byGrade)}`);
const disagreements = results.flatMap((c) =>
	opcodes.filter((o) => c.opcodes[o.name].confidence === 'witnesses-disagree').map((o) => `${c.name}/${o.name}: ${c.opcodes[o.name].evidence}`),
);
if (disagreements.length) console.log(`disagreements:\n  ${disagreements.join('\n  ')}`);
if (tvl.totalDefiUsd)
	console.log(
		`tvl: analyzed $${(tvl.analyzedUsd / 1e9).toFixed(1)}B of $${(tvl.totalDefiUsd / 1e9).toFixed(1)}B total DeFi (${((tvl.analyzedUsd / tvl.totalDefiUsd) * 100).toFixed(1)}%), ${tvl.unscanned.length} chain(s) unscanned`,
	);
if (!reference) console.log(`warning: reference chain ${referenceChainId} not in generated-chains.json, snippets unverified`);
if (suspectSnippets.length) console.log(`warning: unsupported on the reference chain, check the snippet: ${suspectSnippets.join(', ')}`);
console.log('wrote data/generated-results.json');
