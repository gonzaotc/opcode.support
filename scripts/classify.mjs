// An eth_call can fail because the EVM rejected the opcode, or because the provider refused to run
// it. Only the first is evidence about the chain. Conflating them is how a probe reports a
// rate-limited endpoint as an unsupported opcode.

const INFRASTRUCTURE = [
	/rate ?limit/i,
	/usage limit/i,
	/upgrade to (a )?paid/i,
	/current plan|free plan|pricing/i,
	/server busy|too many requests|429/i,
	/quota|capacity|throttl/i,
	/timeout|timed out/i,
	/temporary internal error|internal server error|try again|retry/i,
	/unauthorized|forbidden|api key|invalid credentials/i,
	/does not exist\/is not available|method not (found|supported)/i,
	/can't route your request|no suitable provider|bad gateway|service unavailable/i,
];

// Wordings observed across geth, erigon, nethermind, besu, nitro, era_vm, cosmos-evm and others.
const EVM_REJECTION = [
	/invalid opcode/i,
	/opcode .*not defined/i,
	/opcodenotfound/i,
	/notactivated|not activated/i,
	/invalid instruction|undefined instruction/i,
	/execution reverted/i,
	/execution unsuccessful/i,
	/stack underflow|stack overflow/i,
	/contract_execution_exception/i,
];

const matches = (patterns, message) => patterns.some((p) => p.test(message));

export function classify(message) {
	if (!message) return 'other';
	if (matches(INFRASTRUCTURE, message)) return 'infrastructure';
	if (matches(EVM_REJECTION, message)) return 'evm';
	return 'other';
}

// Normalises an error so the same rejection reads identically regardless of which opcode triggered
// it, letting an endpoint's own negative-control wording act as its rejection fingerprint.
export function signature(message) {
	return String(message ?? '')
		.toLowerCase()
		.replace(/0x[0-9a-f]+/g, '0x*')
		.replace(/\b\d+\b/g, '*')
		.replace(/[a-z_]*(opcode|instruction)[a-z_]*\s*[:=]?\s*[a-z0-9_]*/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}
