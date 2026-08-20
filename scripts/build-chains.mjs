// Regenerates chains.json: the top N EVM chains by DefiLlama TVL, each with a verified, operator
// diversified RPC pool. Nothing here trusts a name: a chain is only included once an endpoint
// confirms its chain id.
import { writeFileSync, readFileSync } from 'node:fs';
import { rpc } from './rpc.mjs';
import { diversify, operator, operatorReach } from './endpoints.mjs';

const config = JSON.parse(readFileSync('config/selection.json', 'utf8'));
const excluded = new Set(config.exclude);
const overrides = config.chainIdOverrides;

const [llama, registry, taggedEvm] = await Promise.all([
	fetch('https://api.llama.fi/v2/chains').then((r) => r.json()),
	fetch('https://chainid.network/chains.json').then((r) => r.json()),
	// DefiLlama tags each chain with categories including 'EVM'. Used only to decide which
	// unresolved chains are worth warning about, never to gate inclusion, so a change to this
	// endpoint degrades the warnings without affecting the table.
	fetch('https://api.llama.fi/config')
		.then((r) => r.json())
		.then((c) => new Set(Object.entries(c.chainCoingeckoIds ?? {}).filter(([, v]) => (v.categories ?? []).includes('EVM')).map(([name]) => name)))
		.catch(() => null),
]);
const registryById = new Map(registry.map((c) => [c.chainId, c]));

const ranked = llama
	.filter((c) => !excluded.has(c.name))
	.map((c) => ({ name: c.name, chainId: c.chainId ?? overrides[c.name] ?? null, tvlUsd: Math.round(c.tvl ?? 0) }))
	.sort((a, b) => b.tvlUsd - a.tvlUsd);

// A chain with no resolvable id is skipped, but never silently: anything ranking above the eventual
// cutoff that DefiLlama considers EVM is reported so a missing override stays visible.
const candidates = ranked.filter((c) => c.chainId !== null).slice(0, config.topN);
// Denominators for the report's representativeness line. Pinned with the chain list, since the
// question they answer is how representative this selection is, not what TVL looks like today. The
// EVM total is the union of DefiLlama's own EVM tag with the chains we resolved ourselves, since
// that tag misses some (Mezo, Sei).
const selectedNames = new Set(candidates.map((c) => c.name));
const totalDefiTvlUsd = Math.round(llama.reduce((sum, c) => sum + (c.tvl ?? 0), 0));
const totalEvmTvlUsd = Math.round(
	llama
		.filter((c) => selectedNames.has(c.name) || taggedEvm?.has(c.name))
		.reduce((sum, c) => sum + (c.tvl ?? 0), 0),
);
const cutoff = candidates.at(-1)?.tvlUsd ?? 0;
const unresolved = ranked.filter(
	(c) => c.chainId === null && c.tvlUsd >= cutoff && (taggedEvm === null || taggedEvm.has(c.name)),
);

const pools = candidates.map((chain) => {
	const fromRegistry = (registryById.get(chain.chainId)?.rpc ?? []).filter(
		(u) => u.startsWith('https://') && !u.includes('${'),
	);
	return [...new Set([...(config.rpcs[chain.chainId] ?? []), ...fromRegistry])];
});
const reach = operatorReach(pools);

const chains = [];
const dropped = [];
for (const [index, chain] of candidates.entries()) {
	const ordered = diversify(pools[index], reach);
	// The endpoint itself is the authority on which chain it serves.
	const ids = await Promise.all(ordered.map((url) => rpc(url, 'eth_chainId', [], { attempts: 2 })));
	const rpcUrls = ordered.filter((_, i) => Number.parseInt(ids[i].result, 16) === chain.chainId);

	if (rpcUrls.length === 0) {
		dropped.push(chain);
		console.log(`${String(chain.chainId).padStart(9)}  ${chain.name.padEnd(20)} DROPPED, no endpoint confirmed this chain id`);
		continue;
	}

	chains.push({ ...chain, rpcUrls });
	const operators = new Set(rpcUrls.map(operator)).size;
	console.log(
		`${String(chain.chainId).padStart(9)}  ${chain.name.padEnd(20)} ${rpcUrls.length}/${ordered.length} verified, ${operators} operator(s), leading with ${operator(rpcUrls[0])}`,
	);
}

writeFileSync(
	'data/chains.json',
	`${JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			source: 'defillama tvl, rpc pools from config/selection.json and ethereum-lists/chains, every endpoint verified by eth_chainId',
			topN: config.topN,
			totalDefiTvlUsd,
			totalEvmTvlUsd,
			chains,
		},
		null,
		'\t',
	)}\n`,
);

console.log(`\nwrote data/chains.json (${chains.length} chains)`);
const fragile = chains.filter((c) => new Set(c.rpcUrls.map(operator)).size < 2);
if (fragile.length) console.log(`${fragile.length} chain(s) with a single operator: ${fragile.map((c) => c.name).join(', ')}`);
if (dropped.length) console.log(`${dropped.length} chain(s) dropped for unverifiable chain id: ${dropped.map((c) => c.name).join(', ')}`);
if (taggedEvm === null) console.log("warning: DefiLlama's config endpoint was unreachable, so the unresolved-chain warning is unfiltered");
if (unresolved.length) {
	console.log(`\n${unresolved.length} EVM-tagged chain(s) rank above the $${Math.round(cutoff / 1e6)}M cutoff but have no chain id.`);
	console.log('Add a verified id to config/selection.json chainIdOverrides, or the name to exclude:');
	for (const c of unresolved) console.log(`   $${String(Math.round(c.tvlUsd / 1e6)).padStart(6)}M  ${c.name}`);
}
