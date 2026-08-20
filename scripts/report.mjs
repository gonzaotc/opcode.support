// Renders data/results.json as REPORT.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { operator } from './endpoints.mjs';

const { checkedAt, opcodes, tvl, snippetCheck, chains } = JSON.parse(readFileSync('data/results.json', 'utf8'));

const CELL = { supported: 'yes', unsupported: 'no', unknown: '?' };
const usd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`);
const pct = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
const operators = (chain) => new Set(chain.witnesses.filter((w) => w.calibrated).map((w) => operator(w.url))).size;

const table = (headers, rows) =>
	[`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const statusCounts = (opcode) => {
	const counts = { supported: 0, unsupported: 0, unknown: 0 };
	for (const chain of chains) counts[chain.opcodes[opcode.name].status]++;
	return counts;
};

const summary = table(
	['opcode', 'byte', 'fork', 'EIP', 'supported', 'unsupported', 'unconfirmed', 'support'],
	opcodes.map((opcode) => {
		const { supported, unsupported, unknown } = statusCounts(opcode);
		const confirmed = supported + unsupported;
		return [
			`\`${opcode.name}\``,
			`\`${opcode.byte}\``,
			opcode.fork,
			opcode.eip,
			supported,
			unsupported,
			unknown,
			confirmed ? `**${Math.round((supported / confirmed) * 100)}%** of ${confirmed} confirmed` : 'n/a',
		];
	}),
);

const matrix = table(
	['#', 'chain', 'chain id', 'TVL', ...opcodes.map((o) => o.name), 'operators'],
	chains.map((chain, i) => [
		i + 1,
		chain.name,
		chain.chainId,
		usd(chain.tvlUsd),
		...opcodes.map((o) => CELL[chain.opcodes[o.name].status]),
		operators(chain),
	]),
);

const representativeness = tvl?.totalEvmUsd
	? `The top ${tvl.topN} EVM chains by TVL, as ranked by DefiLlama. Chains that produced a verdict hold ${usd(
			tvl.analyzedUsd,
		)}, **${pct(tvl.analyzedUsd, tvl.totalEvmUsd)} of EVM TVL**. Chains we could not scan do not count${
			tvl.unscanned.length ? `: ${tvl.unscanned.map((c) => c.name).join(', ')}` : ''
		}.`
	: `The top ${chains.length} EVM chains by TVL, as ranked by DefiLlama.`;

const warning = snippetCheck.suspectSnippets.length
	? `\n**Warning:** unsupported on the reference chain, snippet likely malformed: ${snippetCheck.suspectSnippets.join(', ')}.\n`
	: '';

writeFileSync(
	'REPORT.md',
	`# EVM Opcode Support Report

Automatically generated at: ${checkedAt}

## Representativeness

${representativeness}
${warning}
## Summary

${summary}

## Matrix

${matrix}

## Method

See [README](./README.md).
`,
);
console.log(`wrote REPORT.md (${chains.length} chains, ${opcodes.length} opcodes)`);
