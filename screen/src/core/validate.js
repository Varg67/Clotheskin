import { OP_SPECS, DESTINATIONS } from './contract.js';
import { STATE_FIELDS, WEAR_SLOTS } from './constants.js';
import { cleanString } from './text.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- slot words: the identifiers are obscure ("topunderwear"), so common slips are understood
const slotKey = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');
const SLOT_ALIASES = (() => {
  const m = Object.fromEntries(WEAR_SLOTS.map((s) => [slotKey(s), s]));
  Object.assign(m, {
    top: 'topwear', tops: 'topwear', bottom: 'bottomwear', bottoms: 'bottomwear',
    shoes: 'footwear', shoe: 'footwear', boots: 'footwear', hat: 'headwear', cap: 'headwear',
    socks: 'footunderwear', stockings: 'footunderwear', tights: 'footunderwear',
    bra: 'topunderwear', undershirt: 'topunderwear', underwear: 'bottomunderwear', underpants: 'bottomunderwear', panties: 'bottomunderwear',
    glasses: 'eyes-accessory', necklace: 'neck-accessory', earrings: 'ears-accessory', bracelet: 'arms-accessory', watch: 'arms-accessory',
    ring: 'hands-accessory', gloves: 'hands-accessory', belt: 'waist-accessory', bag: 'bags', backpack: 'bags', handbag: 'bags',
  });
  return m;
})();
const normalizeSlot = (v) => (typeof v === 'string' ? SLOT_ALIASES[slotKey(v)] : undefined);

/**
 * Extracts a JSON object from plain JSON, a fenced block, or text containing one object.
 * Only when strict parsing fails, two common slips are repaired: trailing commas and curly double quotes.
 */
export function parseResponseText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'The response is empty.' };
  const candidates = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  let lastErr = null;
  for (const c of candidates) {
    try { return { ok: true, value: JSON.parse(c) }; } catch (e) { lastErr = e; }
  }
  for (const c of candidates) {
    const noTrailing = c.replace(/,(\s*[}\]])/g, '$1');
    for (const attempt of [noTrailing, noTrailing.replace(/[“”]/g, '"')]) {
      try { return { ok: true, value: JSON.parse(attempt), repaired: true }; } catch { /* try the next repair */ }
    }
  }
  return { ok: false, error: `The response is not valid JSON (${lastErr.message}).` };
}

function checkText(ctx, path, v, spec) {
  if (v === null && spec.nullable) return null;
  if (typeof v !== 'string' || !cleanString(v)) {
    ctx.errors.push(`${path} must be a non-empty string${spec.nullable ? ' or null' : ''}.`);
    return undefined;
  }
  return cleanString(v);
}

function checkFields(ctx, path, obj, fields) {
  const out = {};
  const allowed = new Set();
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.kind === 'ref') {
      allowed.add(`${name}_id`); allowed.add(`${name}_name`);
      for (const k of [`${name}_id`, `${name}_name`]) {
        const v = obj[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string' || !cleanString(v)) ctx.errors.push(`${path}.${k} must be a non-empty string.`);
        else out[k] = cleanString(v);
      }
      if (spec.required && out[`${name}_id`] === undefined && out[`${name}_name`] === undefined) {
        ctx.errors.push(`${path} needs "${name}_id" or "${name}_name".`);
      }
      continue;
    }
    allowed.add(name);
    const v = obj[name];
    if (v === undefined) {
      if (spec.required) ctx.errors.push(`${path}.${name} is required.`);
      continue;
    }
    switch (spec.kind) {
      case 'enum': {
        const val = spec.values === WEAR_SLOTS ? normalizeSlot(v) : v;
        if (!spec.values.includes(val)) ctx.errors.push(`${path}.${name} must be one of: ${spec.values.join(', ')}.`);
        else out[name] = val;
        break;
      }
      case 'enumList': {
        const mapped = Array.isArray(v) ? v.map((x) => (spec.values.includes(x) ? x : normalizeSlot(x))) : null;
        if (!mapped || mapped.some((x) => !spec.values.includes(x))) ctx.errors.push(`${path}.${name} must be an array of: ${spec.values.join(', ')}.`);
        else out[name] = [...new Set(mapped)];
        break;
      }
      case 'text': {
        const t = checkText(ctx, `${path}.${name}`, v, spec);
        if (t !== undefined) out[name] = t;
        break;
      }
      case 'pockets': {
        if (!Array.isArray(v)) { ctx.errors.push(`${path}.${name} must be an array.`); break; }
        const list = [];
        v.forEach((p, i) => {
          if (!isObj(p) || typeof p.label !== 'string' || !cleanString(p.label)) {
            ctx.errors.push(`${path}.${name}[${i}] needs a non-empty "label".`); return;
          }
          if (p.side !== undefined && !['left', 'right', 'both', 'center'].includes(p.side)) {
            ctx.errors.push(`${path}.${name}[${i}].side is not a valid side.`); return;
          }
          list.push({ label: cleanString(p.label, 60), ...(p.side ? { side: p.side } : {}) });
        });
        out[name] = list;
        break;
      }
      case 'dest': {
        const d = validateDestination(ctx, `${path}.${name}`, v);
        if (d) out[name] = d;
        break;
      }
      default: break;
    }
  }
  // Unknown keys cannot corrupt anything (they are never read), so they are ignored with a note.
  for (const k of Object.keys(obj)) if (!allowed.has(k)) ctx.warnings.push(`${path}.${k} is not part of the contract`);
  return out;
}

function validateDestination(ctx, path, v) {
  if (!isObj(v)) { ctx.errors.push(`${path} must be an object.`); return null; }
  const spec = DESTINATIONS[v.type];
  if (!spec) {
    ctx.errors.push(`${path}.type must be one of: ${Object.keys(DESTINATIONS).join(', ')}.`);
    return null;
  }
  const { type, ...rest } = v;
  return { type, ...checkFields(ctx, path, rest, spec.fields) };
}

/**
 * Structural validation. A wrong type, enum value or missing required field rejects the whole document
 * (nothing is written). Unknown keys only produce warnings. Semantic problems, such as an unknown item,
 * are handled later and only skip the affected operation.
 */
export function validateDocument(doc) {
  const ctx = { errors: [], warnings: [] };
  const { errors, warnings } = ctx;
  if (!isObj(doc)) return { ok: false, errors: ['The response must be a JSON object.'] };

  const allowedTop = new Set(['state_updates', 'item_changes', 'unresolved', 'meta']);
  for (const k of Object.keys(doc)) if (!allowedTop.has(k)) warnings.push(`top-level "${k}" is not part of the contract`);

  const state_updates = {};
  const su = doc.state_updates ?? {};
  if (!isObj(su)) errors.push('"state_updates" must be an object.');
  else {
    for (const [k, v] of Object.entries(su)) {
      if (!STATE_FIELDS.includes(k)) { errors.push(`state_updates.${k} is not supported. Use: ${STATE_FIELDS.join(', ')}.`); continue; }
      if (typeof v !== 'string' || !cleanString(v)) { errors.push(`state_updates.${k} must be a non-empty string.`); continue; }
      let val = cleanString(v);
      if (k === 'makeup' && val.toLowerCase() === 'none') val = 'none';
      state_updates[k] = val;
    }
  }

  const item_changes = [];
  let ic = doc.item_changes ?? [];
  if (isObj(ic) && typeof ic.op === 'string') ic = [ic]; // a single operation instead of an array
  if (!Array.isArray(ic)) errors.push('"item_changes" must be an array.');
  else {
    ic.forEach((raw, i) => {
      const path = `item_changes[${i}]`;
      if (!isObj(raw)) { errors.push(`${path} must be an object.`); return; }
      const spec = OP_SPECS[raw.op];
      if (!spec) { errors.push(`${path}.op must be one of: ${Object.keys(OP_SPECS).join(', ')}.`); return; }
      const { op, ...rest } = raw;
      item_changes.push({ op, ...checkFields(ctx, path, rest, spec.fields) });
    });
  }

  const unresolved = [];
  let ur = doc.unresolved ?? [];
  if (typeof ur === 'string') ur = [ur]; // a lone note instead of an array
  if (!Array.isArray(ur)) errors.push('"unresolved" must be an array of strings.');
  else ur.forEach((n, i) => {
    if (typeof n !== 'string' || !cleanString(n, 400)) errors.push(`unresolved[${i}] must be a non-empty string.`);
    else unresolved.push(cleanString(n, 400));
  });

  let meta = null;
  if (doc.meta !== undefined) {
    if (!isObj(doc.meta)) errors.push('"meta" must be an object.');
    else meta = { demo: doc.meta.demo === true, scene: typeof doc.meta.scene === 'string' ? doc.meta.scene : null,
      targetId: typeof doc.meta.target_id === 'string' ? doc.meta.target_id : null };
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, doc: { state_updates, item_changes, unresolved, meta, warnings } };
}
