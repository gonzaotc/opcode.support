import { isInfrastructure } from './classify.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function once(url, method, params, timeoutMs) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: ctrl.signal,
		});
		// Many nodes return JSON-RPC errors with a non-2xx status, so always try to read the body.
		const text = await res.text();
		let json;
		try {
			json = JSON.parse(text);
		} catch {
			return { transportError: `http ${res.status}` };
		}
		if ('result' in json) return { result: json.result };
		if (json.error) {
			const message = json.error.message ?? JSON.stringify(json.error);
			// Provider-side refusals carry no information about the chain, so surface them as
			// transport failures and let the retry loop handle them.
			if (isInfrastructure(message)) return { transportError: message };
			return { error: message };
		}
		return { transportError: `http ${res.status}` };
	} catch (err) {
		return { transportError: err.name === 'AbortError' ? 'timeout' : String(err.message ?? err) };
	} finally {
		clearTimeout(timer);
	}
}

export async function rpc(url, method, params, { timeoutMs = 15000, attempts = 5 } = {}) {
	let last;
	for (let attempt = 0; attempt < attempts; attempt++) {
		last = await once(url, method, params, timeoutMs);
		if (!last.transportError || !isInfrastructure(last.transportError)) return last;
		await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 400));
	}
	return last;
}

// Runs tasks with bounded concurrency so shared public endpoints are not hammered.
export async function pooled(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	});
	await Promise.all(runners);
	return results;
}
