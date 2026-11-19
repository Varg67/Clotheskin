/** Tiny hyperscript helper. Handlers use onXxx; everything else becomes an attribute. */
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

/**
 * Modal sheet with Save / Cancel. Escape and Cancel discard.
 * `build(body, api)` fills the body; `onSave()` may return a string to show as an error and keep the sheet open.
 */
export function openSheet({ title, build, onSave, saveLabel = 'Save', cancelLabel = 'Cancel', onClose = () => {} }) {
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' });
  const body = h('div', { class: 'sheet-body' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: '' });
  const close = () => { dlg.close(); dlg.remove(); onClose(); };
  const api = {
    close,
    setError(msg) { error.textContent = msg || ''; error.hidden = !msg; },
  };
  const save = h('button', {
    type: 'button', class: 'btn primary',
    onClick: async () => {
      const res = await onSave(api);
      if (typeof res === 'string') api.setError(res);
      else close();
    },
  }, saveLabel);
  dlg.append(
    h('header', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, title)),
    body, error,
    h('footer', { class: 'sheet-foot' },
      h('button', { type: 'button', class: 'btn ghost', onClick: close }, cancelLabel), save),
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  build(body, api);
  dlg.showModal();
  return { dlg, body, api };
}
