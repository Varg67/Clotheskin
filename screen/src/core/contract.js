import {
  CLOTHING_SLOTS, ACCESSORY_SLOTS, BAG_SLOT, WEAR_SLOTS, SIDES, HANDS, ITEM_KINDS,
  DESTINATION_TYPES, STATE_FIELDS,
} from './constants.js';

/**
 * Single source of truth for the extraction contract.
 * The validator, the prompt text and the tests all read from this table.
 *
 * Field kinds:
 *   ref      -> two optional strings `<name>_id` / `<name>_name` (one is required when the ref is required)
 *   enum     -> one of `values`
 *   enumList -> array of values from `values`
 *   text     -> non-empty string, or null where `nullable`
 *   pockets  -> array of { label, side? } ([] = confirmed no pockets)
 *   dest     -> destination object (see DESTINATIONS)
 */
export const OP_SPECS = {
  wear: {
    description:
      'An item is now worn or carried on the body. Repeat it with new attributes to update an item that is already worn. Never use it for items merely mentioned.',
    fields: {
      item: { kind: 'ref', required: true, note: 'known ID, or an ordinary name on first appearance' },
      slot: { kind: 'enum', required: true, values: WEAR_SLOTS },
      over_item: { kind: 'ref', note: 'layer this item sits above, in the same slot' },
      under_item: { kind: 'ref', note: 'layer this item sits below, in the same slot' },
      wear_mode: { kind: 'text', note: 'how it is worn, e.g. open, buttoned, rolled-up sleeves' },
      condition: { kind: 'text', note: 'physical condition, e.g. wet, wrinkled' },
      side: { kind: 'enum', values: SIDES },
      placement: { kind: 'text', note: 'precise position, e.g. behind the ear' },
      covers: { kind: 'enumList', values: CLOTHING_SLOTS, note: 'extra clothing slots covered by a one-piece garment such as a dress; the main slot is "slot"' },
      pockets: { kind: 'pockets', note: 'pockets established for this garment; [] means it has none' },
    },
  },
  remove: {
    description:
      'An item that was worn or carried is taken off or put down. The remaining items stay as they were. Its condition and contents are kept.',
    fields: {
      item: { kind: 'ref', required: true },
      slot: { kind: 'enum', values: WEAR_SLOTS, note: 'only needed on first appearance, to classify the item' },
      to: { kind: 'dest', note: 'where the item went; omit if the scene does not say' },
    },
  },
  change_wear_mode: {
    description: 'The way an item is worn changed (open, closed, tucked in, sleeves rolled up...).',
    fields: {
      item: { kind: 'ref', required: true },
      wear_mode: { kind: 'text', required: true, nullable: true, note: 'null clears the mode' },
    },
  },
  change_condition: {
    description: 'The physical condition of an item changed (wet, dirty, torn...).',
    fields: {
      item: { kind: 'ref', required: true },
      condition: { kind: 'text', required: true, nullable: true, note: 'null clears the condition' },
    },
  },
  move: {
    description:
      'A belonging moved to a new place without being worn: into a bag or pocket, into a hand, or onto a spot in the scene. Moving a container does not need one move per content item.',
    fields: {
      item: { kind: 'ref', required: true },
      kind: { kind: 'enum', values: ITEM_KINDS, note: 'only on first appearance; default "object"' },
      to: { kind: 'dest', required: true },
    },
  },
};

export const DESTINATIONS = {
  held: { fields: { hand: { kind: 'enum', values: HANDS } }, description: 'in a hand of the target character' },
  pocket: {
    fields: {
      container_item: { kind: 'ref', required: true, note: 'the garment that owns the pocket (must be known)' },
      pocket: { kind: 'text', note: 'e.g. "left pocket"; omit when the scene does not say' },
      side: { kind: 'enum', values: SIDES },
    },
    description: 'inside a pocket of a garment',
  },
  bag: {
    fields: { container_item: { kind: 'ref', required: true, note: 'the bag (created on first appearance)' } },
    description: 'inside a bag; it travels with the bag',
  },
  scene: {
    fields: { place: { kind: 'text', note: 'e.g. "chair in the living room"' } },
    description: 'left somewhere in the scene',
  },
};

export const DESTINATION_KEYS = DESTINATION_TYPES;

function fieldLine(name, spec) {
  const req = spec.required ? 'required' : 'optional';
  let type;
  switch (spec.kind) {
    case 'ref': type = `"${name}_id" and/or "${name}_name" (strings)`; break;
    case 'enum': type = spec.values.map((v) => `"${v}"`).join(' | '); break;
    case 'enumList': type = `array of ${spec.values.map((v) => `"${v}"`).join(' | ')}`; break;
    case 'pockets': type = 'array of {"label": string, "side"?: "left"|"right"|"both"|"center"}'; break;
    case 'dest': type = 'destination object'; break;
    default: type = spec.nullable ? 'string or null' : 'string';
  }
  const label = spec.kind === 'ref' ? `${name}_id / ${name}_name` : name;
  return `    - ${label} (${req}): ${type}${spec.note ? `. ${spec.note}` : ''}`;
}

/** Plain-text contract injected into the prompt at runtime. */
export function renderContract() {
  const lines = [];
  lines.push('OPERATION CONTRACT');
  lines.push('state_updates: object with only the changed values among ' +
    `${STATE_FIELDS.map((f) => `"${f}"`).join(', ')}. Each value is a short English string; ` +
    'makeup uses "none" when explicitly absent. Never use null here. Do not put clothing or accessories here.');
  lines.push('item_changes: array of operation objects. Every object has "op" plus the fields below.');
  for (const [op, spec] of Object.entries(OP_SPECS)) {
    lines.push(`  op "${op}": ${spec.description}`);
    for (const [name, f] of Object.entries(spec.fields)) lines.push(fieldLine(name, f));
  }
  lines.push('Destination object ("to"): { "type": ... } with:');
  for (const [type, d] of Object.entries(DESTINATIONS)) {
    lines.push(`  type "${type}" (${d.description})`);
    for (const [name, f] of Object.entries(d.fields)) lines.push(fieldLine(name, f));
  }
  lines.push(`Clothing slots (innermost layer first inside each slot): ${CLOTHING_SLOTS.join(', ')}. ` +
    '"footunderwear" is socks and hosiery; "footwear" is shoes; a cap is "headwear"; a one-piece garment ' +
    '(dress, jumpsuit) is one item: use its main slot and list the other slots in "covers".');
  lines.push(`Accessory slots: ${ACCESSORY_SLOTS.join(', ')}. ` +
    '"bottom-accessory" is the hip region. A hair clip is "head-accessory"; glasses are "eyes-accessory".');
  lines.push(`Bag slot: "${BAG_SLOT}" (backpack, handbag, crossbody bag). A pocket belongs to the garment that has it.`);
  lines.push('PREVIOUS STATE notes: null means unknown, [] means confirmed empty, and arrays list items ' +
    'innermost to outermost. Refer to known items by their "id" in item_id fields.');
  lines.push('"unresolved": array of short English strings describing ambiguous or unattributable details; ' +
    'the affected items must stay unchanged.');
  return lines.join('\n');
}

const REF_NAMES = (name) => `${name}_id|${name}_name`;

/** Short form of the contract, for channels with a hard size limit (kin ask: 8,000 characters). */
export function renderCompactContract() {
  const lines = [];
  lines.push('Reply with {"state_updates":{...},"item_changes":[...],"unresolved":[...]}, leaving out any key that has nothing.');
  lines.push(`state_updates: only changed ${STATE_FIELDS.join(', ')}; short English strings, never null; makeup "none" = confirmed no makeup.`);
  lines.push('item_changes: operations {"op":...}. Fields marked * are required; refs are item_id or item_name (use known ids).');
  for (const [op, spec] of Object.entries(OP_SPECS)) {
    const f = Object.entries(spec.fields).map(([name, d]) => {
      const label = d.kind === 'ref' ? REF_NAMES(name) : name;
      const hint = d.kind === 'enum' && d.values.length <= 4 ? `(${d.values.join('|')})` : d.kind === 'enumList' ? '[slots]' : d.kind === 'pockets' ? '[{label,side}]' : d.kind === 'dest' ? '(destination below)' : d.nullable ? '(text|null)' : '';
      return `${label}${d.required ? '*' : ''}${hint}`;
    });
    lines.push(`  ${op}: ${f.join(', ')}`);
  }
  lines.push('  to = {"type":"held","hand"} | {"type":"pocket","container_item_id|container_item_name","pocket","side"} | {"type":"bag","container_item_id|container_item_name"} | {"type":"scene","place"}');
  lines.push('Meanings: position = body posture only ("sitting on the sofa"); location = the place ("living room at the shared house"); hair = hairstyle or condition ("low bun", "wet"), never colour. Reuse the exact wording of a known place or item from PREVIOUS STATE.');
  lines.push(`clothing slots (inner layer first): ${CLOTHING_SLOTS.join(', ')}. One-piece garments use their main slot plus "covers". topwear = shirts, T-shirts, sweaters, jackets, coats, dresses; bottomwear = trousers, skirts, shorts; footwear = shoes; footunderwear = socks, tights; topunderwear/bottomunderwear = bra, undershirt, underpants only.`);
  lines.push(`accessory slots: ${ACCESSORY_SLOTS.join(', ')} (bottom-accessory = hips). Bags: "${BAG_SLOT}".`);
  lines.push('wear slots, for "slot": any clothing slot, accessory slot or "bags". In PREVIOUS STATE null = unknown, [] = confirmed empty; omitted slots are unknown.');
  return lines.join('\n');
}

/**
 * JSON Schema for the action the Kin calls to report scene changes. Deliberately permissive in nesting:
 * the real validation is validate.js, which runs again on whatever arrives.
 */
export function contractJsonSchema() {
  const type = { string: { type: 'string' } };
  const props = {};
  const destProps = {};
  for (const [name, d] of Object.entries(DESTINATIONS)) {
    for (const [fname, f] of Object.entries(d.fields)) {
      if (f.kind === 'ref') { destProps[`${fname}_id`] = type.string; destProps[`${fname}_name`] = type.string; }
      else if (f.kind === 'enum') destProps[fname] = { type: 'string', enum: f.values };
      else destProps[fname] = type.string;
    }
  }
  for (const spec of Object.values(OP_SPECS)) {
    for (const [name, f] of Object.entries(spec.fields)) {
      if (f.kind === 'ref') { props[`${name}_id`] = type.string; props[`${name}_name`] = type.string; }
      else if (f.kind === 'enum') props[name] = { type: 'string', enum: f.values };
      else if (f.kind === 'enumList') props[name] = { type: 'array', items: { type: 'string', enum: f.values } };
      else if (f.kind === 'pockets') props[name] = { type: 'array', items: { type: 'object', properties: { label: type.string, side: { type: 'string' } }, required: ['label'] } };
      else if (f.kind === 'dest') props[name] = { type: 'object', properties: { type: { type: 'string', enum: DESTINATION_TYPES }, ...destProps }, required: ['type'] };
      else props[name] = f.nullable ? { type: ['string', 'null'] } : type.string;
    }
  }
  props.op = { type: 'string', enum: Object.keys(OP_SPECS) };
  return {
    type: 'object',
    properties: {
      state_updates: { type: 'object', properties: Object.fromEntries(STATE_FIELDS.map((f) => [f, type.string])) },
      item_changes: { type: 'array', items: { type: 'object', properties: props, required: ['op'] } },
      unresolved: { type: 'array', items: type.string },
    },
  };
}
