// Regenerates chains.json: top N EVM chains by DefiLlama TVL, with a health-checked RPC pool.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { healthy } from './rpc.mjs';

const TOP_N = 30;

// DefiLlama omits chainId for some EVM chains.
const MISSING_CHAIN_ID = { 'Hyperliquid L1': 999, Sei: 1329, Story: 1514 };
// Carry a chainId in DefiLlama but are not EVM execution environments.
const NOT_EVM = new Set([728126428]);

const extraRpcs = existsSync('extra-rpcs.json') ? JSON.parse(readFileSync('extra-rpcs.json', 'utf8')) : {};

const [llama, registry] = await Promise.all([
	fetch('https://api.llama.fi/v2/chains').then((r) => r.json()),
	fetch('https://chainid.network/chains.json').then((r) => r.json()),
]);
const byId = new Map(registry.map((c) => [c.chainId, c]));

const candidates = [];
for (const c of llama) {
	const chainId = c.chainId ?? MISSING_CHAIN_ID[c.name];
	if (chainId == null || NOT_EVM.has(chainId) || !byId.has(chainId)) continue;
	candidates.push({ chainId, name: c.name, tvlUsd: Math.round(c.tvl ?? 0) });
}
candidates.sort((a, b) => b.tvlUsd - a.tvlUsd);

const chains = [];
for (const chain of candidates.slice(0, TOP_N)) {
	const pool = [
		...(extraRpcs[chain.chainId] ?? []),
		...(byId.get(chain.chainId).rpc ?? []).filter((u) => u.startsWith('https://') && !u.includes('${')),
	];
	const unique = [...new Set(pool)];
	const checks = await Promise.all(unique.map((u) => healthy(u, chain.chainId)));
	const rpcUrls = unique.filter((_, i) => checks[i]);
	chains.push({ ...chain, rpcUrls });
	console.log(`${String(chain.chainId).padStart(9)}  ${chain.name.padEnd(20)} ${rpcUrls.length}/${unique.length} healthy`);
}

writeFileSync('chains.json', `${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'defillama tvl + ethereum-lists/chains', chains }, null, '\t')}\n`);
console.log(`\nwrote chains.json (${chains.length} chains, ${chains.filter((c) => c.rpcUrls.length < 2).length} with fewer than 2 healthy RPCs)`);
