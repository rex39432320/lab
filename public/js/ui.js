// Reusable, accessible UI primitives.
import { h, replace } from './dom.js';
import { icon } from './icons.js';
import { refreshRoute } from './router.js';
import { CATEGORY_CLASS, initials } from './format.js';

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++idCounter}`;

export function announce(message) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => {
    el.textContent = message;
  }, 40);
}

export function toast(message, { type = 'info', title, ms = 5200 } = {}) {
  const host = document.getElementById('toasts');
  const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert' : 'info';
  const color =
    type === 'success' ? 'var(--success-text)' : type === 'error' ? 'var(--danger-text)' : 'var(--info-text)';
  const el = h(
    'div',
    { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : undefined },
    h('span', { vars: { color } }, icon(iconName)),
    h(
      'div',
      null,
      title && h('div', { class: 'toast__title' }, title),
      h('div', { class: 'small muted' }, message),
    ),
    h(
      'button',
      {
        class: 'btn btn--ghost btn--icon btn--sm',
        'aria-label': 'Dismiss notification',
        onclick: () => el.remove(),
      },
      icon('x', { size: 16 }),
    ),
  );
  host.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible modal dialog: focus trap, Escape to close, focus restore. */
export function openModal({ title, body, actions = [], wide = false, description }) {
  const previous = document.activeElement;
  const titleId = uid('modal-title');
  let overlay;
  const close = (result) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    previous?.focus?.();
    resolveFn?.(result);
  };
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });

  const footer =
    actions.length &&
    h(
      'div',
      { class: 'modal__foot' },
      actions.map((a) =>
        h(
          'button',
          {
            type: 'button',
            class: `btn ${a.variant ? `btn--${a.variant}` : ''}`,
            disabled: a.disabled,
            onclick: async (e) => {
              const btn = e.currentTarget;
              if (!a.onClick) return close(a.value);
              btn.disabled = true;
              try {
                if ((await a.onClick(close)) === false) btn.disabled = false;
              } catch (err) {
                btn.disabled = false;
                throw err;
              }
            },
          },
          a.label,
        ),
      ),
    );

  const dialog = h(
    'div',
    {
      class: `modal ${wide ? 'modal--wide' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
    h(
      'div',
      { class: 'modal__head' },
      h(
        'div',
        null,
        h('h2', { class: 'modal__title', id: titleId }, title),
        description && h('p', { class: 'muted small' }, description),
      ),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost btn--icon',
          'aria-label': 'Close dialog',
          onclick: () => close(null),
        },
        icon('x'),
      ),
    ),
    body,
    footer,
  );
  overlay = h(
    'div',
    {
      class: 'overlay',
      onmousedown: (e) => {
        if (e.target === overlay) close(null);
      },
    },
    dialog,
  );

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(null);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  (dialog.querySelector('[autofocus]') ?? dialog.querySelector(FOCUSABLE) ?? dialog).focus();
  return { close, promise, el: dialog };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return openModal({
    title,
    body: h('p', { class: 'muted' }, message),
    actions: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', value: true },
    ],
  }).promise.then(Boolean);
}

export const badge = (text, variant = '', iconName) =>
  h(
    'span',
    { class: `badge ${variant ? `badge--${variant}` : ''}` },
    iconName && icon(iconName, { size: 13 }),
    text,
  );

export function emptyState({ iconName = 'inbox', title, text, action }) {
  return h(
    'div',
    { class: 'empty card card--flat' },
    h('div', { class: 'empty__icon' }, icon(iconName, { size: 28 })),
    h('h3', null, title),
    text && h('p', { class: 'small' }, text),
    action,
  );
}

export function errorState(err, retry) {
  return h(
    'div',
    { class: 'alert alert--danger', role: 'alert' },
    icon('alert'),
    h(
      'div',
      null,
      h('strong', null, 'Something went wrong. '),
      err.message,
      retry && h('div', { class: 'row' }, h('button', { class: 'btn btn--sm', onclick: retry }, 'Try again')),
    ),
  );
}

export const skeletonGrid = (n = 6) =>
  h(
    'div',
    { class: 'grid grid--auto', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: n }, () => h('div', { class: 'skeleton skeleton--card' })),
  );

export const tile = (eq, size = '') =>
  h(
    'div',
    { class: `tile ${size ? `tile--${size}` : ''} ${CATEGORY_CLASS[eq.category] ?? 'cat-dev'}` },
    icon(eq.icon ?? 'chip', { size: size === 'lg' ? 30 : size === 'sm' ? 18 : 24 }),
  );
export const avatar = (name) => h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(name));

export function progress(pct, variant = '', label) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return h(
    'div',
    {
      class: `progress ${variant ? `progress--${variant}` : ''}`,
      role: 'progressbar',
      'aria-valuenow': value,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-label': label,
    },
    h('div', { class: 'progress__bar', vars: { '--pct': `${value}%` } }),
  );
}

export function ring({ value, max, size = 84, label, color = '#8b6cff', text }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const pct = max ? Math.min(1, value / max) : 0;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls, extra) => {
    const c = document.createElementNS(NS, 'circle');
    Object.entries({ cx: 50, cy: 50, r, fill: 'none', 'stroke-width': 10, class: cls, ...extra }).forEach(
      ([k, v]) => c.setAttribute(k, v),
    );
    return c;
  };
  const arc = mk('ring__value', { stroke: color, 'stroke-dasharray': circ, 'stroke-dashoffset': circ });
  svg.append(mk('ring__track'), arc);
  requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', circ * (1 - pct)));
  return h(
    'div',
    { class: 'ring', role: 'img', 'aria-label': label, vars: { '--size': `${size}px` } },
    svg,
    h('div', { class: 'ring__label' }, text ?? `${Math.round(pct * 100)}%`),
  );
}

/** Labelled form field; `control` receives the generated id. */
export function field(label, makeControl, { hint, error, full = false } = {}) {
  const id = uid('f');
  const hintId = hint ? `${id}-hint` : undefined;
  const control = makeControl(id, hintId);
  return h(
    'div',
    { class: `field ${full ? 'full' : ''}` },
    h('label', { class: 'label', for: id }, label),
    control,
    hint && h('span', { class: 'hint', id: hintId }, hint),
    error && h('span', { class: 'error-text', role: 'alert' }, error),
  );
}

export const textInput =
  (props = {}) =>
  (id, hintId) =>
    h('input', { class: 'input', id, 'aria-describedby': hintId, ...props });
export const selectInput =
  (options, selected, props = {}) =>
  (id) =>
    h(
      'select',
      { class: 'select', id, ...props },
      options.map(([value, text]) =>
        h('option', { value, selected: String(value) === String(selected) }, text),
      ),
    );

export function setBusy(button, busy, busyLabel = 'Working…') {
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    replace(button, icon('hourglass', { size: 16, cls: 'spin' }), busyLabel);
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = button.dataset.label ?? button.textContent;
  }
}

/** Run an async action with toast-based error handling. */
export async function guarded(fn, { success, button, busy } = {}) {
  if (button) setBusy(button, true, busy);
  try {
    const result = await fn();
    if (success) toast(success, { type: 'success' });
    return result;
  } catch (err) {
    toast(err.message, { type: 'error', title: 'Could not complete that' });
    return undefined;
  } finally {
    if (button?.isConnected) setBusy(button, false);
  }
}

export function tabs(items, active, onChange, label) {
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const buttons = items.map(([key, text, count]) =>
    h(
      'button',
      {
        type: 'button',
        class: 'tab',
        role: 'tab',
        'aria-selected': String(key === active),
        tabindex: key === active ? '0' : '-1',
        dataset: { key },
        onclick: () => onChange(key),
        onkeydown: (e) => {
          const i = items.findIndex(([k]) => k === key);
          const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
          if (next === undefined) return;
          e.preventDefault();
          onChange(items[(next + items.length) % items.length][0], true);
        },
      },
      text,
      count !== undefined && h('span', { class: 'count' }, count),
    ),
  );
  list.append(...buttons);
  return list;
}

/**
 * Primary action for a form dialog: runs `submit`, then shows `onSuccess`, closes and refreshes the
 * page. A failure keeps the dialog open and shows the server's message inline in `message`.
 */
export function submitAction({ label, message, submit, onSuccess }) {
  return {
    label,
    variant: 'primary',
    onClick: async (close) => {
      message.replaceChildren();
      try {
        await submit();
        onSuccess?.();
        close(true);
        refreshRoute();
      } catch (err) {
        message.append(h('div', { class: 'alert alert--danger' }, icon('alert', { size: 18 }), err.message));
        return false;
      }
    },
  };
}
