// Tiny DOM helpers. Text always goes in as text nodes, never as HTML (the guide: "Put anything that came from saved
// data on the page as text, never as HTML").

/** Hyperscript: h('button', { class, onClick, ... }, ...children). Handlers use onXxx; the rest are attributes. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'open' || k === 'readOnly') el[k] = true; // undefined/false were skipped above
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Runs `fn` (which rebuilds DOM inside `root`) and restores focus + caret by data-key. */
export function keepFocus(root, fn) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.getAttribute('data-key') : null;
  const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  fn();
  if (!key) return;
  const next = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (next) {
    next.focus({ preventScroll: true });
    if (sel && 'setSelectionRange' in next) { try { next.setSelectionRange(...sel); } catch { /* not a text control */ } }
  }
}
