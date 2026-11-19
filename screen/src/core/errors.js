// Why a question to the Kin failed, in terms that decide what to do next:
//   transient  -> try again soon (a blip, a busy or down model, a rate limit); the wait grows with each failure
//   permanent  -> trying again changes nothing until the person acts (a missing permission); wait the full interval
//   retrySoon  -> fast failures worth one immediate retry inside the same run (a timeout is not: it already cost a minute)
export const KINDS = {
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  UNAVAILABLE: 'unavailable',
  RATE_LIMIT: 'rate-limit',
  PERMISSION: 'permission',
  MISSING_TOOL: 'missing-tool',
  BAD_ANSWER: 'bad-answer',
  TOO_LONG: 'too-long',
  UNKNOWN: 'unknown',
};

export const PERMANENT_KINDS = new Set([KINDS.PERMISSION, KINDS.MISSING_TOOL, KINDS.TOO_LONG]);
const RETRY_SOON = new Set([KINDS.NETWORK, KINDS.UNAVAILABLE, KINDS.RATE_LIMIT]);

const MESSAGES = {
  [KINDS.TIMEOUT]: 'The Kin did not answer in time. It may be busy.',
  [KINDS.NETWORK]: 'The connection to Kindroid failed.',
  [KINDS.UNAVAILABLE]: 'The Kin or its model is unavailable right now.',
  [KINDS.RATE_LIMIT]: 'Kindroid is limiting requests right now.',
  [KINDS.PERMISSION]: 'Kindroid refused the question. The app may need a permission: check Apps, Waiting for you.',
  [KINDS.MISSING_TOOL]: 'The kin command could not be started in this run.',
  [KINDS.TOO_LONG]: 'The question to the Kin is too long.',
  [KINDS.UNKNOWN]: 'The Kin could not be asked.',
};

// Order matters: a rate limit mentioning a token is not a permission problem.
const PATTERNS = [
  [KINDS.RATE_LIMIT, /\b429\b|rate.?limit|too many requests|quota|throttl/i],
  [KINDS.UNAVAILABLE, /\b(500|502|503|504|529)\b|unavailable|overload|temporar|maintenance|bad gateway|gateway time|service (is )?down|model (is )?(down|offline|busy)|\bbusy\b|try again later/i],
  [KINDS.NETWORK, /econn|enotfound|eai_again|etimedout|ehostunreach|enetunreach|network|socket|connection|offline|\bdns\b|reset by peer|broken pipe|fetch failed|\btls\b|certificate/i],
  [KINDS.PERMISSION, /\b(401|403)\b|forbidden|unauthori[sz]ed|permission|\bgrant\b|not allowed|denied|invalid (key|token)|expired/i],
];

const detailOf = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 100);

/**
 * Classifies a failure. `message` is whatever the `kin` command or the transport said; it is only matched against
 * patterns and shown as a short detail, never trusted. Always returns a usable English message.
 */
export function classifyFailure({ message = '', timedOut = false, spawnFailed = false } = {}) {
  let kind = KINDS.UNKNOWN;
  if (timedOut) kind = KINDS.TIMEOUT;
  else if (spawnFailed || /\bENOENT\b|command not found/i.test(message)) kind = KINDS.MISSING_TOOL;
  else for (const [k, re] of PATTERNS) { if (re.test(message)) { kind = k; break; } }
  const detail = detailOf(message);
  const base = MESSAGES[kind];
  return {
    kind,
    transient: !PERMANENT_KINDS.has(kind),
    retrySoon: RETRY_SOON.has(kind),
    message: detail && kind !== KINDS.TIMEOUT && !base.includes(detail) ? `${base} (${detail})` : base,
  };
}

/** An error that already knows what kind of failure it is. */
export class KinFailure extends Error {
  constructor(classified) {
    super(classified.message);
    this.name = 'KinFailure';
    this.kind = classified.kind;
    this.transient = classified.transient;
    this.retrySoon = classified.retrySoon;
  }
}
