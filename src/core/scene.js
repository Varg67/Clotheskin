// Recover the selected Kin's observation before the field cleaners remove subjects.
// A person after "to" or "with" remains the participant in the Kin's action.
import { cleanString } from './text.js';

const PERSON = String.raw`[\p{L}][\p{L}\p{M}'’-]*(?:\s+[\p{L}][\p{L}\p{M}'’-]*){0,5}?`;
const VERB = 'is|are|was|were|am|has|have|wears|wore|says|said|will|would|might|could|stopped|finished|smiles|laughs|sits|stands|cooks|reads|sleeps|walks|takes|offers|hands';
const SUBJECT = new RegExp(`^(${PERSON})\\s+(${VERB})(?:\\s+|$)`, 'iu');
const POSSESSIVE = new RegExp(`^(${PERSON})['’]s\\s+(?=(?:hair|make-?up)\\s+(?:is|was|are)|[a-z]+ing\\b)`, 'iu');
const NEXT_SUBJECT = new RegExp(`\\s*(?:,?\\s+but\\s+|,?\\s+while\\s+|,?\\s+and\\s+|[.;]\\s+|,\\s+)(?=(?:now\\s+)?(?:${PERSON}\\s+(?:${VERB})\\b|I['’]m\\b|(?:am|is|are)\\s+now\\b))`, 'iu');
const NONCURRENT = /^(?:(?:i|she|he|they|we)\s+)?(?:was|were|wore|had|will|would|might|could|may (?=be|go|wear|have)|used to|plan(?:ning|s)? to|wanted to|if|maybe|perhaps|yesterday|previously|earlier)\b/i;
const NON_SUBJECT = /^(?:my|your|his|her|their|our|the|a|an|not|at|in|on|near|with|wearing|talking|asking|telling|watching)\b/i;
const canonical = s => s.normalize('NFC').replace(/’/g, "'").toLowerCase();

const PRONOUN = /^(?:i|we|she|he|they)$/i;
const LABEL = /^(?:current\s+)?(?:location|place|where|pose|posture|position|action|activity|doing|hair|hairstyle|make-?up)\s*(?:[:–—]\s*|-\s+)/i;
const STARRED = /(\*{1,2})([^*]+?)\1/g;
const DIALOGUE = /"[^"]*"|“[^”]*”/g;
const TEMPORAL = /^(?:right now|currently|now)\s+/i;

function namedClause(value, name, subject, possessive) {
  const verb = subject[2] || '';
  if (!name) return NONCURRENT.test(verb) ? null : value;
  if (canonical(subject[1]) !== canonical(name) || /^(said|says)$/i.test(verb)) return null;
  const rest = value.slice(subject[0].length);
  if (possessive) return rest.replace(/^(?:hair|make-?up) (?:is|are)\s+/i, '');
  if (/^(has|have|wears)$/i.test(verb)) return rest;
  if (/^(is|are|am)$/i.test(verb)) return rest.replace(/^wearing\s+/i, '');
  return (verb + ' ' + rest).trim();
}

function isName(subject, name) {
  if (PRONOUN.test(subject) || NON_SUBJECT.test(subject)) return false;
  return !subject.includes(' ') || canonical(subject) === canonical(name) || subject.split(' ').every(word => /^\p{Lu}/u.test(word));
}

function clause(text, name) {
  const value = text.replace(TEMPORAL, '');
  const possessive = value.match(POSSESSIVE);
  const subject = possessive || value.match(SUBJECT);
  if (subject && /^(?:the|my|her|his|your|their) (?:baby|friend|sister|brother|mother|father|partner|child|dog|cat)$/i.test(subject[1])) return null;
  const named = subject && isName(subject[1], name);
  const scoped = named ? namedClause(value, name, subject, possessive) : value;
  return scoped && !NONCURRENT.test(scoped) ? scoped : null;
}

function currentText(raw, name) {
  const original = cleanString(raw, 600).replace(/^["“]([^"“”]+)["”]$/, '$1');
  if (!original.includes('*')) return currentClause(original, name);
  // Check ownership inside the action before its markdown or adjacent dialogue is removed.
  const text = original.replace(STARRED, (_, marks, words) => {
    const scoped = currentClause(words, name);
    return scoped ? marks + scoped + marks : '';
  });
  const outside = text.replace(STARRED, '').replace(DIALOGUE, '').trim();
  if (!outside) return text.replace(DIALOGUE, '').trim() || null;
  if (!currentClause(outside, name)) return text.match(STARRED)?.join(' ') || null;
  return currentClause(text, name);
}

function currentClause(text, name) {
  const value = text.trim().replace(/,?\s+(?:who|whom|whose|which)\s+.*$/i, '').replace(LABEL, '');
  const parts = value.split(NEXT_SUBJECT);
  let last = null;
  for (const part of parts) {
    // An implicit auxiliary after a foreign subject still belongs to that person.
    const implicit = /^(?:am|is|are)\s+now\s+/i;
    if (part !== parts[0] && /^(?:she|he|they)\b/i.test(part)) continue;
    if (parts.length > 1 && implicit.test(part) && !last && !/^(?:I|we)\b/i.test(parts[0])) continue;
    const own = clause(part.replace(implicit, ''), name);
    if (own) last = own;
  }
  return last;
}

/** Preserve invalid types for the existing validator. Lists and look objects can also contain narrated text. */
export function currentObservation(value, name) {
  if (typeof value === 'string') return currentText(value, name);
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (typeof item !== 'string') return [item];
      const scoped = currentText(item, name);
      return scoped === null ? [] : [scoped];
    });
  }
  if (value && typeof value === 'object') {
    const parts = Object.entries(value).map(([key,item])=>[key,typeof item === 'string' ? currentText(item,name) : item]);
    if (parts.length && parts.every(([,item])=>item === null)) return null;
    return Object.fromEntries(parts);
  }
  return value;
}
