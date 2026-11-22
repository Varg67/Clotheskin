// Tiny DOM helpers. Text always goes in as text nodes, never as HTML (the guide: "Put anything that came from saved
// data on the page as text, never as HTML").

/** Hyperscript: h('button', { class, onClick, ... }, ...children). Handlers use onXxx; the rest are attributes. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) setAttribute(el, k, v);
  append(el, children);
  return el;
}

const FLAGS = new Set(['checked', 'disabled', 'open']); // set as properties (undefined and false never get here)

function setAttribute(el, k, v) {
  if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
  else if (k === 'class') el.className = v;
  else if (k === 'value') el.value = v;
  else if (FLAGS.has(k)) el[k] = true;
  else el.setAttribute(k, v === true ? '' : String(v));
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Runs `fn` (which rebuilds the DOM inside `root`) and gives focus back to the control with the same data-key. */
export function keepFocus(root, fn) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.getAttribute('data-key') : null;
  fn();
  if (!key) return;
  const next = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (next) next.focus({ preventScroll: true });
}
