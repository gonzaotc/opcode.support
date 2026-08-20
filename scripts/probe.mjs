// Probes opcode support across the chains in chains.json and writes data/results.json.
// Read-only: every check is an eth_call simulation, so no gas is ever spent and no key is needed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rpc, pooled } from './rpc.mjs';
import { isEvmRejection } from './classify.mjs';

const WITNESSES_REQUIRED = 2;
const MAX_ENDPOINTS = 5;
const CHAIN_CONCURRENCY = 5;
const PROBE_ADDRESS = '0x0000000000000000000000000000000000c0ffee';

const { chains } = JSON.parse(readFileSync('chains.json', 'utf8'));
const { opcodes, controls } = JSON.parse(readFileSync('opcodes.json', 'utf8'));
const enabled = opcodes.filter((o) => o.enabled);

// Two independent ways to make a node execute arbitrary bytecode without sending a transaction.
const strategies = {
	stateOverride: (url, code) =>
		rpc(url, 'eth_call', [{ to: PROBE_ADDRESS, data: '0x' }, 'latest', { [PROBE_ADDRESS]: { code } }]),
	nullTo: (url, code) => rpc(url, 'eth_call', [{ data: code }, 'latest']),
};

const ran = (res) => 'result' in res;

// A strategy is only trustworthy on an endpoint when a universally defined opcode succeeds and a
// universally undefined one fails. Without this, endpoints that ignore state overrides or skip
// execution entirely report every opcode as supported.
async function calibrate(strategy, url) {
	const positive = await strategy(url, controls.positive.snippet);
	if (positive.transportError) return { ok: false, reason: `positive control unreachable: ${positive.transportError}` };
	if (!ran(positive)) return { ok: false, reason: `positive control rejected: ${positive.error}` };

	const negative = await strategy(url, controls.negative.snippet);
	if (negative.transportError) return { ok: false, reason: `negative control unreachable: ${negative.transportError}` };
	if (ran(negative)) return { ok: false, reason: 'negative control succeeded, endpoint does not execute the code' };

	// Kept as evidence: this is how the endpoint words a genuine opcode rejection.
	return { ok: true, rejectionExample: negative.error };
}

// Turns one probe response into a verdict, refusing to guess when the failure is not attributable to
// the EVM rejecting the opcode.
function interpret(res) {
	if (res.transportError) return { status: 'unknown', reason: 'endpoint-unavailable', evidence: res.transportError };
	if (ran(res)) return { status: 'supported', evidence: 'executed' };
	if (isEvmRejection(res.error)) return { status: 'unsupported', evidence: res.error };
	return { status: 'unknown', reason: 'unattributable-error', evidence: res.error };
}

async function probeEndpoint(url) {
	const [client, block] = await Promise.all([rpc(url, 'web3_clientVersion', []), rpc(url, 'eth_blockNumber', [])]);
	const meta = { url, client: client.result ?? null, block: block.result ? Number.parseInt(block.result, 16) : null };
	const rejected = {};

	for (const [name, strategy] of Object.entries(strategies)) {
		const calibration = await calibrate(strategy, url);
		if (!calibration.ok) {
			rejected[name] = calibration.reason;
			continue;
		}

		const results = {};
		for (const opcode of enabled) results[opcode.name] = interpret(await strategy(url, opcode.snippet));
		return {
			...meta,
			calibrated: true,
			strategy: name,
			rejectionExample: calibration.rejectionExample,
			opcodes: results,
		};
	}

	return { ...meta, calibrated: false, strategy: null, rejected };
}

// Verdicts from calibrated endpoints that reached a conclusion. Everything else is not evidence.
const verdictsFor = (witnesses, opcodeName) =>
	witnesses
		.filter((w) => w.calibrated)
		.map((w) => w.opcodes[opcodeName])
		.filter((v) => v && v.status !== 'unknown');

// A single endpoint is a single witness, and endpoints can misreport. Only agreement counts as
// confirmed; anything else is explicitly not a verdict.
function reconcile(witnesses, opcodeName) {
	const verdicts = verdictsFor(witnesses, opcodeName);

	if (verdicts.length === 0) return { status: 'unknown', confidence: 'no-calibrated-endpoint', witnesses: 0 };
	if (new Set(verdicts.map((v) => v.status)).size > 1)
		return { status: 'unknown', confidence: 'witnesses-disagree', witnesses: verdicts.length };
	if (verdicts.length < WITNESSES_REQUIRED)
		return { status: 'unknown', confidence: 'single-witness', observed: verdicts[0].status, witnesses: 1 };
	return { status: verdicts[0].status, confidence: 'confirmed', witnesses: verdicts.length, evidence: verdicts[0].evidence };
}

async function probeChain(chain) {
	// Keep walking the endpoint pool until every opcode has enough usable verdicts, so one
	// rate-limited endpoint does not leave a hole in the table.
	const witnesses = [];
	for (const url of chain.rpcUrls.slice(0, MAX_ENDPOINTS)) {
		witnesses.push(await probeEndpoint(url));
		if (enabled.every((o) => verdictsFor(witnesses, o.name).length >= WITNESSES_REQUIRED)) break;
	}

	const verdicts = Object.fromEntries(enabled.map((o) => [o.name, reconcile(witnesses, o.name)]));
	const calibrated = witnesses.filter((w) => w.calibrated).length;
	console.log(
		`${String(chain.chainId).padStart(7)}  ${chain.name.padEnd(18)} ${calibrated}/${witnesses.length} calibrated  ` +
			enabled.map((o) => `${o.name}=${verdicts[o.name].status}`).join(' '),
	);
	return { ...chain, witnesses, opcodes: verdicts };
}

const results = await pooled(chains, CHAIN_CONCURRENCY, probeChain);
results.sort((a, b) => b.tvlUsd - a.tvlUsd);

mkdirSync('data', { recursive: true });
writeFileSync(
	'data/results.json',
	`${JSON.stringify({ checkedAt: new Date().toISOString(), opcodes: enabled, chains: results }, null, '\t')}\n`,
);
console.log('\nwrote data/results.json');
