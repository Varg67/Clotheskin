// What the screen says, in plain words: pure functions of the saved data and the clock (no page), so they are tested
// in Node. The views put these texts on the page; the store tells the changes to a screen reader.
// `at` is { settings, now }: the person's settings and the moment of the render.
import { plannedAt, warningOf, readingText, versionMismatch, LOOK_RETRY_HOURS, AUTO } from '../core/state.js';
import { startDueFor, ERROR } from '../core/schedule.js';
import { describeDream, DREAM_TTL_HOURS } from '../core/sleep.js';
import { formatClock, formatRelative, formatWhen } from '../core/format.js';
import { APP_VERSION } from '../core/constants.js';

/** A time as the screen says it: "10:05 PM", "7:30 AM tomorrow", "Nov 20, 10:05 PM". */
const when = (iso, now) => formatWhen(iso, { now });

/** Around when the next start of the program will do what is planned for this Kin. */
const nextTry = (entry, at) => when(startDueFor(plannedAt(entry, at.settings), at.now).toISOString(), at.now);

/** The banner about Kindroid itself (maintenance, or several errors in a row). */
export function warningText(warning, entry, at) {
  const next = ` The next try is around ${nextTry(entry, at)}.`;
  if (warning.kind === ERROR.MAINTENANCE) return `Kindroid seems to be under maintenance.${next}`;
  return `Kindroid has not answered ${warning.failures} times in a row. It may be down.${next}`;
}

/** The last run's problem in plain words (the technical detail in brackets, for anyone who reports it). */
export function problemText(entry, name, at) {
  if (entry.note) return entry.note;
  if (entry.errorKind === ERROR.ANSWER) return `${name}'s answer could not be read: ${entry.error}`;
  if (entry.errorKind === ERROR.SERVER) return `Kindroid did not answer this time (${entry.error}). It tries again around ${nextTry(entry, at)}.`;
  return entry.error;
}

/** The line under a Kin's name in the list. */
export function kinStateLine(entry, now) {
  if (entry.sleep) return `Asleep until ${when(entry.sleep.wakeAt, now)}`;
  if (entry.reading) return `${entry.reading.location.replace(/\.$/, '')} · ${formatRelative(entry.reading.at, now)}`;
  return 'Not read yet';
}

/** The dream shown on the card: for a day after the Kin woke up (as long as it is told to the Kin). */
export function visibleDream(entry, now) {
  const d = entry.dream;
  return d && d.dream && now.getTime() - Date.parse(d.at) < DREAM_TTL_HOURS * 3600e3 ? d : null;
}

const PAUSED = 'Paused: nothing is asked until you press Resume.';

/** The line under Start / Pause / Stop: { text, wakeNow } (wakeNow: a "Wake now" link goes after the text). */
export function automationStatus(entry, at) {
  const run = at.settings.autoState;
  if (run === AUTO.STOPPED) return { text: 'Stopped. Press Start to update automatically.', wakeNow: false };
  if (!entry.sleep) return { text: run === AUTO.PAUSED ? PAUSED : `Next update around ${nextTry(entry, at)}.`, wakeNow: false };
  const next = nextTry(entry, at);
  const night = Date.parse(entry.sleep.until) > at.now.getTime()
    ? `Asleep until ${when(entry.sleep.wakeAt, at.now)}. The dream question comes around ${next}. `
    : `Waking up: the dream question comes around ${next}. `;
  return run === AUTO.PAUSED ? { text: `${night}${PAUSED}`, wakeNow: false } : { text: night, wakeNow: true };
}

// What changed between two saved entries of the Kin on screen, each a sentence or ''. After Update status (asked)
// the reading is told even when it is the same, and the night again.
const NEWS = [
  ({ a, b, asked }) => {
    if (!b.reading) return '';
    const changed = asked ? b.reading.at !== (a.reading && a.reading.at) : readingText(b.reading) !== readingText(a.reading);
    return changed ? readingText(b.reading) : '';
  },
  ({ a, b, asked, name, at }) => (b.sleep && (!a.sleep || asked) ? `${name} is asleep until ${when(b.sleep.wakeAt, at.now)}.` : ''),
  ({ a, b, name }) => (b.dream && b.dream.at !== (a.dream && a.dream.at) ? `${name} woke up. Dream: ${describeDream(b.dream)}` : ''),
  ({ a, b, at }) => {
    const w = warningOf(b);
    const before = warningOf(a);
    return w && (!before || before.kind !== w.kind) ? warningText(w, b, at) : '';
  },
];

/**
 * What to tell a screen reader when status.json changed: { say, alert }. `say` joins the news of one moment, so none
 * hides another; `alert` is the run's new problem ('' for none), unless the warning banner already says it.
 */
export function changesToTell(a, b, { name, asked, at }) {
  const news = { a, b, asked, name, at };
  const say = NEWS.map((tell) => tell(news)).filter(Boolean).join(' ');
  const newProblem = b.error && !warningOf(b) && (b.error !== a.error || b.lastRunAt !== a.lastRunAt);
  return { say, alert: newProblem ? problemText(b, name, at) : '' };
}

/** For a sentence kept from an earlier reading (the Kin said nothing new about it): when it was last seen, or null. */
export function seenAt(reading, field, now) {
  const seen = reading && reading.seen && reading.seen[field];
  return seen && seen !== reading.at ? formatClock(seen, { now }) : null;
}

/** The last note of the look was refused or failed (while the option is on): what happened and when it is tried again. */
export function lookProblemText(entry, at) {
  if (!at.settings.tellLook || !entry || !entry.lookFailedAt || !entry.lookError) return null;
  const again = new Date(Date.parse(entry.lookFailedAt) + LOOK_RETRY_HOURS * 3600e3).toISOString();
  return `Kindroid did not take the last note (${entry.lookError}). Clotheskin tries again after ${formatClock(again, { now: at.now })}.`;
}

/** Some files are from another update than the screen (status.json says which version of the run saved it), or null. */
export function versionMismatchText(status) {
  const run = versionMismatch(status);
  return run ? `Some of Clotheskin’s files are from another update: the screen is ${APP_VERSION}, the automatic part is ${run}. Update all the files together.` : null;
}
