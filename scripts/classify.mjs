// An eth_call can fail because the EVM rejected the opcode, or because the provider refused to run
// it. Only the first is evidence about the chain. Conflating them is how a probe reports a
// rate-limited endpoint as an unsupported opcode.

// Provider-side refusals. Worth retrying, and never evidence about a chain.
const INFRASTRUCTURE = [
	/rate ?limit|too many requests|429|server busy|throttl/i,
	/usage limit|quota|capacity|current plan|free plan|pricing|upgrade to (a )?paid/i,
	/timeout|timed out/i,
	/temporary internal error|internal server error|try again|retry|^http 5\d\d/i,
	/unauthorized|forbidden|api key|invalid credentials/i,
	/does not exist\/is not available|method not (found|supported)/i,
	/can't route your request|no suitable provider|bad gateway|service unavailable/i,
];

// Rejections that name the cause, so the verdict can be read back and audited.
const NAMES_THE_CAUSE = [
	/invalid opcode|opcode .*not defined|opcodenotfound/i,
	/invalid instruction|undefined instruction/i,
	/notactivated|not activated/i,
	/stack underflow|stack overflow/i,
];

// Rejections consistent with an undefined opcode but equally consistent with any other failure.
// Only trustworthy on a calibrated endpoint, and always the weaker evidence.
const UNNAMED_FAILURE = [/execution reverted|execution unsuccessful|contract_execution_exception/i];

const anyMatch = (patterns, message) => patterns.some((pattern) => pattern.test(message ?? ''));

export const isInfrastructure = (message) => anyMatch(INFRASTRUCTURE, message);
export const isEvmRejection = (message) => anyMatch(NAMES_THE_CAUSE, message) || anyMatch(UNNAMED_FAILURE, message);
export const evidenceGrade = (message) => (anyMatch(NAMES_THE_CAUSE, message) ? 'specific' : 'generic');
