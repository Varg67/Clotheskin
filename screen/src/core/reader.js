import { buildPrompt, buildHostChatPrompt, DEFAULT_EXTRACTION_PROMPT } from './prompt.js';
import { parseResponseText, validateDocument } from './validate.js';
import { applyDocument } from './apply.js';

/**
 * Orchestrates one reading: bind to profile + conversation, build the prompt,
 * wait for the provider, validate, apply in one transaction, save.
 *
 * Rules enforced here:
 *  - A reading belongs to the profile and conversation it started with, even if
 *    the UI has switched profiles or the profile was renamed meanwhile.
 *  - Repeated requests join the reading already in flight.
 *  - Only the newest ticket of a scope may commit; older answers are discarded.
 *  - Manual edits made after a ticket started are never overwritten by it.
 *  - Failures keep the saved data and record a readable error.
 *  - Each message is processed once unless `force` is set.
 */
export class ReadCoordinator {
  constructor({ repo, provider, clock = () => new Date(), getPromptTemplate = () => DEFAULT_EXTRACTION_PROMPT, getHostPromptTemplate = () => undefined, onChange = () => {} }) {
    this.repo = repo;
    this.provider = provider;
    this.clock = clock;
    this.getPromptTemplate = getPromptTemplate;
    this.getHostPromptTemplate = getHostPromptTemplate;
    this.onChange = onChange;
    this.inflight = new Map(); // scope -> { ticket, promise }
    this.latestSeq = new Map();
    this.pendingAuto = new Map();
    this.seq = 0;
  }

  static scope(profileId, conversationId) { return `${profileId}::${conversationId || '-'}`; }

  isReading(profileId, conversationId) { return this.inflight.has(ReadCoordinator.scope(profileId, conversationId)); }

  /**
   * Starts (or joins) a reading. Registration happens synchronously, before any
   * await, so two clicks in the same tick can never start two readings.
   */
  read(opts) {
    const { profileId, conversationId = null, force = false } = opts;
    if (!profileId) return Promise.resolve({ status: 'error', message: 'Select a companion before reading a scene.' });
    const key = ReadCoordinator.scope(profileId, conversationId);
    if (this.inflight.has(key) && !force) return this.inflight.get(key).promise;
    const seq = ++this.seq;
    this.latestSeq.set(key, seq);
    const entry = { seq, ticket: null, promise: null };
    entry.promise = this.#prepareAndRun(key, entry, opts);
    this.inflight.set(key, entry);
    return entry.promise;
  }

  async #prepareAndRun(key, entry, { profileId, conversationId = null, messages, force = false, demoOnly = false }) {
    let result;
    try {
      const profile = await this.repo.getProfile(profileId);
      if (!profile) return (result = { status: 'error', message: 'Select a companion before reading a scene.' });
      const record = await this.repo.getRecord(profileId, conversationId);
      // messages === null: the host's Kin sees its own recent chat (Workshop). Nothing to dedupe by id:
      // re-reading the same chat is safe because every operation is idempotent.
      const hostChat = messages === null || messages === undefined;
      const processed = new Set(record.processedMessageIds);
      const fresh = hostChat ? [] : (force ? messages : messages.filter((m) => !processed.has(m.id)));
      if (!hostChat && !fresh.length) return (result = { status: 'nothing-new', message: 'There are no new messages to read.' });

      const ticket = {
        id: `t${entry.seq}`, seq: entry.seq, profileId, conversationId,
        profileName: profile.name, baseRev: record.rev, startedAt: this.clock().toISOString(),
        messageIds: fresh.map((m) => m.id), demoOnly,
      };
      entry.ticket = ticket;
      this.onChange({ type: 'started', ticket });
      let prompt;
      try {
        prompt = hostChat
          ? buildHostChatPrompt({ template: this.getHostPromptTemplate(), profile, record })
          : buildPrompt({ template: this.getPromptTemplate(), profile, record, messages: fresh });
      } catch (e) {
        return (result = await this.#fail(ticket, e.message));
      }

      let text;
      try {
        text = await this.provider.extract({ prompt, ticket, profile });
      } catch (e) {
        return (result = await this.#fail(ticket, e.cancelled ? 'The reading was cancelled. Your saved data was kept.' : `The reading could not be completed: ${e.message || e}`, e.cancelled));
      }
      if (this.latestSeq.get(key) !== ticket.seq) {
        return (result = { status: 'discarded', message: 'A newer reading replaced this one, so this response was discarded.', ticket });
      }
      return (result = await this.commit(ticket, text));
    } finally {
      if (this.inflight.get(key) === entry) this.inflight.delete(key);
      this.onChange({ type: 'finished', ticket: entry.ticket, result });
    }
  }

  /** Validates and applies a response text for a ticket. Never throws for bad input. */
  async commit(ticket, text) {
    const parsed = parseResponseText(text);
    if (!parsed.ok) return this.#fail(ticket, `${parsed.error} Your saved data was kept.`);
    const checked = validateDocument(parsed.value);
    if (!checked.ok) {
      return this.#fail(ticket, `The response does not follow the contract. Your saved data was kept. ${checked.errors.slice(0, 5).join(' ')}`, false, checked.errors);
    }
    const { doc } = checked;
    const profile = await this.repo.getProfile(ticket.profileId);
    if (!profile) return this.#fail(ticket, 'The companion for this reading no longer exists. Nothing was saved.');
    if (doc.meta?.demo && !profile.demo) {
      return this.#fail(ticket, 'This is a demo response. Demo responses only update the demo profile.');
    }
    if (ticket.demoOnly && !profile.demo) {
      return this.#fail(ticket, 'Demo responses only update the demo profile.');
    }
    if (doc.meta?.targetId && doc.meta.targetId !== profile.id) {
      return this.#fail(ticket, 'This response was written for a different companion. Nothing was saved.');
    }
    const now = this.clock().toISOString();
    let outcome;
    await this.repo.updateRecord(ticket.profileId, ticket.conversationId, (record) => {
      outcome = applyDocument(record, doc, {
        baseRev: ticket.baseRev, now, ticketId: ticket.id, messageIds: ticket.messageIds,
        source: doc.meta?.demo ? 'demo' : 'scene',
      });
      return { record: outcome.record };
    });
    for (const f of ['location']) if (doc.state_updates[f]) await this.repo.ensurePlace(ticket.profileId, outcome.record.fields[f].value);
    return {
      status: 'ok', ticket, applied: outcome.applied, skipped: outcome.skipped, unresolved: outcome.unresolved,
      message: outcome.applied.length ? 'Status updated.' : 'Read complete. No changes found.',
    };
  }

  /**
   * Applies a document the Kin reported itself (the Workshop action the Kin calls). No provider, no
   * waiting: the base revision is the one on disk right now.
   */
  async submit({ profileId, conversationId = null, text }) {
    if (!profileId) return { status: 'error', message: 'Select a companion before reading a scene.' };
    const record = await this.repo.getRecord(profileId, conversationId);
    const ticket = {
      id: `k${++this.seq}`, seq: this.seq, profileId, conversationId, baseRev: record.rev,
      startedAt: this.clock().toISOString(), messageIds: [], demoOnly: false,
    };
    return this.commit(ticket, text);
  }

  async #fail(ticket, message, cancelled = false, details = null) {
    if (!cancelled) {
      const now = this.clock().toISOString();
      await this.repo.updateRecord(ticket.profileId, ticket.conversationId, (record) => {
        const next = structuredClone(record);
        next.lastError = { at: now, message };
        return { record: next };
      });
    }
    return { status: cancelled ? 'cancelled' : 'error', message, details, ticket };
  }

  /** Host hook: call after the Kin's reply is complete. Groups messages that arrive during a reading. */
  async onKinResponseComplete({ profileId, conversationId = null, messages, demoOnly = false }) {
    const key = ReadCoordinator.scope(profileId, conversationId);
    if (this.inflight.has(key)) {
      this.pendingAuto.set(key, { profileId, conversationId, messages, demoOnly });
      return { status: 'queued' };
    }
    const result = await this.read({ profileId, conversationId, messages, demoOnly });
    const queued = this.pendingAuto.get(key);
    if (queued) {
      this.pendingAuto.delete(key);
      return this.read(queued);
    }
    return result;
  }
}

/**
 * Manual provider: the prompt is shown to the user, who pastes the JSON answer.
 * It exposes the waiting ticket so the UI can resolve or cancel it.
 */
export class ManualProvider {
  constructor() { this.pending = null; this.preloaded = null; this.listeners = new Set(); }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit() { for (const fn of this.listeners) fn(this.pending); }

  preload(text) { this.preloaded = text; }

  extract({ prompt, ticket }) {
    if (this.preloaded !== null) {
      const t = this.preloaded;
      this.preloaded = null;
      return Promise.resolve(t);
    }
    if (this.pending) this.pending.reject(Object.assign(new Error('replaced'), { cancelled: true }));
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { prompt, ticket, resolve, reject };
    }).finally(() => {
      if (this.pending === entry) { this.pending = null; this.#emit(); }
    });
    this.pending = entry;
    this.#emit();
    return promise;
  }

  resolve(text) { this.pending?.resolve(text); }
  cancel() { this.pending?.reject(Object.assign(new Error('cancelled'), { cancelled: true })); }
}
