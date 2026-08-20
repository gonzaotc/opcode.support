// Endpoint bookkeeping. The registrable domain stands in for "who operates this endpoint", which is
// what independence between witnesses actually depends on.

export function operator(url) {
	try {
		return new URL(url).hostname.split('.').slice(-2).join('.');
	} catch {
		return url;
	}
}

// How many distinct chains each operator serves. An operator serving many chains is a multi-chain
// gateway; one serving a single chain is run by that chain. Derived from the data rather than from a
// maintained list of provider names.
export function operatorReach(poolsByChain) {
	const reach = new Map();
	for (const urls of poolsByChain) {
		for (const name of new Set(urls.map(operator))) reach.set(name, (reach.get(name) ?? 0) + 1);
	}
	return reach;
}

// Orders a pool so consecutive endpoints come from different operators, chain-operated ones first.
// The probe consumes this in order and stops early, so position decides which endpoints become the
// witnesses, and therefore how independent they are.
export function diversify(urls, reach) {
	const byOperator = new Map();
	for (const url of urls) {
		const name = operator(url);
		if (!byOperator.has(name)) byOperator.set(name, []);
		byOperator.get(name).push(url);
	}

	const groups = [...byOperator.entries()].sort(
		([aName, a], [bName, b]) => (reach.get(aName) ?? 1) - (reach.get(bName) ?? 1) || a.length - b.length || aName.localeCompare(bName),
	);

	const ordered = [];
	for (let round = 0; ordered.length < urls.length; round++) {
		for (const [, group] of groups) if (group[round]) ordered.push(group[round]);
	}
	return ordered;
}
