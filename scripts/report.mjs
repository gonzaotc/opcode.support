// Renders data/generated-results.json as README.md, the repo's front page.
import { readFileSync, writeFileSync } from 'node:fs';

const { checkedAt, chainSetPinnedAt, opcodes, tvl, snippetCheck, chains } = JSON.parse(readFileSync('data/generated-results.json', 'utf8'));

const CELL = { supported: 'yes', unsupported: 'no', unknown: '?' };
const cell = (v) =>
	v.documented ? `${CELL[v.documented.status]}*` : v.observed ? `${CELL[v.observed]}~` : CELL[v.status];
const usd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`);
const pct = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
// Spelled out rather than formatted, because a Node build without full ICU renders 'M08'.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const readable = (iso) => {
	const d = new Date(iso);
	const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${time} UTC`;
};

const table = (headers, rows) =>
	[`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

// One answer per cell, whatever its source: two operators agreeing, one operator observing, or a
// primary source. The matrix shows which, so the summary does not need to.
const supported = (opcode) =>
	chains.filter((chain) => {
		const v = chain.opcodes[opcode.name];
		const seen = v.confidence === 'confirmed' ? v.status : (v.observed ?? v.documented?.status);
		return seen === 'supported';
	}).length;

const summary = table(
	['opcode', 'byte', 'fork', 'EIP', 'supported'],
	opcodes.map((opcode) => {
		const yes = supported(opcode);
		return [
			`\`${opcode.name}\``,
			`\`${opcode.byte}\``,
			opcode.fork,
			opcode.eip,
			`**${Math.round((yes / chains.length) * 100)}%** (${yes} of ${chains.length})`,
		];
	}),
);

const matrix = table(
	['#', 'chain', 'chain id', 'TVL', ...opcodes.map((o) => o.name)],
	chains.map((chain, i) => [
		i + 1,
		chain.name,
		chain.chainId,
		usd(chain.tvlUsd),
		...opcodes.map((o) => cell(chain.opcodes[o.name])),
	]),
);

// Two figures, because they answer different questions: how much TVL got an answer of any kind, and
// how much of it carries two agreeing operators on every opcode. Quoting only the first overstates.
const representativeness = tvl?.totalEvmUsd
	? `The top ${tvl.topN} EVM chains by TVL, ranked by DefiLlama with endpoints from \`ethereum-lists/chains\`. The last run answered **${pct(
			tvl.analyzedUsd,
			tvl.totalEvmUsd,
		)} of EVM TVL** (${usd(tvl.analyzedUsd)}), of which **${pct(tvl.confirmedUsd ?? 0, tvl.totalEvmUsd)}** (${usd(
			tvl.confirmedUsd ?? 0,
		)}) is confirmed by two operators on every opcode.`
	: `The top ${chains.length} EVM chains by TVL, ranked by DefiLlama.`;

const documented = chains.filter((c) => opcodes.some((o) => c.opcodes[o.name].documented));
const singleOperator = chains.filter((c) => opcodes.some((o) => c.opcodes[o.name].observed));

// Weaknesses the cell cannot show. Evidence grade varies per opcode, so those are named per cell;
// endpoint identity belongs to the chain's pool, so those are named once.
const genericCells = chains.flatMap((c) => opcodes.filter((o) => c.opcodes[o.name].grade === 'generic').map((o) => `${c.name} ${o.name}`));
const sharedClientChains = chains.filter((c) => opcodes.some((o) => c.opcodes[o.name].sharedClient)).map((c) => c.name);

const documentedNote = documented.length
	? `\`*\` from a primary source because no probe reaches that chain: ${documented
			.map((c) => `${c.name} ([source](${opcodes.map((o) => c.opcodes[o.name].documented).find(Boolean).source}))`)
			.join(', ')}`
	: '';

// Only values the table actually contains, so the legend never explains a marker that is not there.
const rendered = new Set(chains.flatMap((c) => opcodes.map((o) => cell(c.opcodes[o.name]))));
const shows = (marker) => [...rendered].some((v) => v.startsWith(marker));

const notes = [
	shows('yes') ? '`yes` supported' : '',
	shows('no') ? '`no` unsupported' : '',
	shows('?') ? '`?` no verdict' : '',
	singleOperator.length
		? `\`~\` observed, but by a single operator, so not confirmed: ${singleOperator.map((c) => c.name).join(', ')}`
		: '',
	documentedNote,
	genericCells.length
		? `generic evidence, a rejection that named no cause, so consistent with an undefined opcode but with anything else too: ${genericCells.join(', ')}`
		: '',
	sharedClientChains.length
		? `both operators answered with the same client string, so possibly one node behind two names: ${sharedClientChains.join(', ')}`
		: '',
].filter(Boolean);

const warning = snippetCheck.suspectSnippets.length
	? `\n**Warning:** unsupported on the reference chain, snippet likely malformed: ${snippetCheck.suspectSnippets.join(', ')}.\n`
	: '';

writeFileSync(
	'README.md',
	`# EVM Opcode Support

Which EVM opcodes are supported on which chains, measured periodically against live nodes.

- **Last updated:** ${readable(checkedAt)}${chainSetPinnedAt ? `\n- **Chain set and TVL pinned:** ${readable(chainSetPinnedAt)}` : ''}
- **Refreshed:** daily at 06:00 UTC
- **How this is measured:** [METHOD.md](./METHOD.md)

## Representativeness

${representativeness}
${warning}
## Summary

${summary}

## Top ${chains.length} EVM Chains Opcodes Support

${matrix}

${notes.map((n) => `- ${n}`).join('\n')}

## Method

Calibrated probes, two independent operators per verdict, no gas: see [METHOD.md](./METHOD.md).
\`data/generated-results.json\` carries the per-endpoint evidence behind every cell.

This page is generated by \`npm run report\`. Do not edit it by hand.
`,
);
console.log(`wrote README.md (${chains.length} chains, ${opcodes.length} opcodes)`);
