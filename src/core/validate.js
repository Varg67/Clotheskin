import { OP_SPECS, DESTINATIONS } from './contract.js';
import { STATE_FIELDS } from './constants.js';
import { cleanString } from './text.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Extracts a JSON object from plain JSON, a fenced block, or text containing one object. */
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
    try {
      return { ok: true, value: JSON.parse(c) };
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: `The response is not valid JSON (${lastErr.message}).` };
}

function checkText(errors, path, v, spec) {
  if (v === null && spec.nullable) return null;
  if (typeof v !== 'string' || !cleanString(v)) {
    errors.push(`${path} must be a non-empty string${spec.nullable ? ' or null' : ''}.`);
    return undefined;
  }
  return cleanString(v);
}

function checkFields(errors, path, obj, fields, extraAllowed = []) {
  const out = {};
  const allowed = new Set(extraAllowed);
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.kind === 'ref') {
      allowed.add(`${name}_id`); allowed.add(`${name}_name`);
      const id = obj[`${name}_id`];
      const nm = obj[`${name}_name`];
      for (const [k, v] of [[`${name}_id`, id], [`${name}_name`, nm]]) {
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string' || !cleanString(v)) errors.push(`${path}.${k} must be a non-empty string.`);
        else out[k] = cleanString(v);
      }
      if (spec.required && out[`${name}_id`] === undefined && out[`${name}_name`] === undefined) {
        errors.push(`${path} needs "${name}_id" or "${name}_name".`);
      }
      continue;
    }
    allowed.add(name);
    const v = obj[name];
    if (v === undefined) {
      if (spec.required) errors.push(`${path}.${name} is required.`);
      continue;
    }
    switch (spec.kind) {
      case 'enum':
        if (!spec.values.includes(v)) errors.push(`${path}.${name} must be one of: ${spec.values.join(', ')}.`);
        else out[name] = v;
        break;
      case 'enumList':
        if (!Array.isArray(v) || v.some((x) => !spec.values.includes(x))) {
          errors.push(`${path}.${name} must be an array of: ${spec.values.join(', ')}.`);
        } else out[name] = [...new Set(v)];
        break;
      case 'text': {
        const t = checkText(errors, `${path}.${name}`, v, spec);
        if (t !== undefined) out[name] = t;
        break;
      }
      case 'pockets': {
        if (!Array.isArray(v)) { errors.push(`${path}.${name} must be an array.`); break; }
        const list = [];
        v.forEach((p, i) => {
          if (!isObj(p) || typeof p.label !== 'string' || !cleanString(p.label)) {
            errors.push(`${path}.${name}[${i}] needs a non-empty "label".`); return;
          }
          if (p.side !== undefined && !['left', 'right', 'both', 'center'].includes(p.side)) {
            errors.push(`${path}.${name}[${i}].side is not a valid side.`); return;
          }
          list.push({ label: cleanString(p.label, 60), ...(p.side ? { side: p.side } : {}) });
        });
        out[name] = list;
        break;
      }
      case 'dest': {
        const d = validateDestination(errors, `${path}.${name}`, v);
        if (d) out[name] = d;
        break;
      }
      default: break;
    }
  }
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) errors.push(`${path} has an unsupported field "${k}".`);
  }
  return out;
}

function validateDestination(errors, path, v) {
  if (!isObj(v)) { errors.push(`${path} must be an object.`); return null; }
  const spec = DESTINATIONS[v.type];
  if (!spec) {
    errors.push(`${path}.type must be one of: ${Object.keys(DESTINATIONS).join(', ')}.`);
    return null;
  }
  const { type, ...rest } = v;
  const out = checkFields(errors, path, rest, spec.fields);
  return { type, ...out };
}

/**
 * Structural validation. Any error rejects the whole document (nothing is
 * written). Semantic problems, such as an unknown item, are handled later and
 * only skip the affected operation.
 */
export function validateDocument(doc) {
  const errors = [];
  if (!isObj(doc)) return { ok: false, errors: ['The response must be a JSON object.'] };

  const allowedTop = new Set(['state_updates', 'item_changes', 'unresolved', 'meta']);
  for (const k of Object.keys(doc)) if (!allowedTop.has(k)) errors.push(`Unsupported top-level key "${k}".`);

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
  const ic = doc.item_changes ?? [];
  if (!Array.isArray(ic)) errors.push('"item_changes" must be an array.');
  else {
    ic.forEach((raw, i) => {
      const path = `item_changes[${i}]`;
      if (!isObj(raw)) { errors.push(`${path} must be an object.`); return; }
      const spec = OP_SPECS[raw.op];
      if (!spec) { errors.push(`${path}.op must be one of: ${Object.keys(OP_SPECS).join(', ')}.`); return; }
      const { op, ...rest } = raw;
      const out = checkFields(errors, path, rest, spec.fields);
      item_changes.push({ op, ...out });
    });
  }

  const unresolved = [];
  const ur = doc.unresolved ?? [];
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
  return { ok: true, doc: { state_updates, item_changes, unresolved, meta } };
}
