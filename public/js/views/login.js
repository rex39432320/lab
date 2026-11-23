import { api } from '../api.js';
import { h, svgEl } from '../dom.js';
import { icon } from '../icons.js';
import { state, update } from '../state.js';
import { field, setBusy, selectInput } from '../ui.js';

const FEATURES = [
  ['search', 'Discover by describing', 'Say what you are building; AI finds the right instruments and kits.'],
  ['calendar-check', 'Intelligent slot booking', 'A live calendar with fair-use quotas and instant validation.'],
  ['shield', 'Project-based access', 'Request equipment for a project; faculty approve in one click.'],
  ['swap', 'Fair conflict resolution', 'Ranked alternatives, swaps and a smart waitlist, explained.'],
];

function heroArt() {
  const tile = (cls, name, size = 38) => h('div', { class: `hero-tile ${cls}`, 'aria-hidden': 'true' }, icon(name, { size }));
  const lines = svgEl('svg', { class: 'hero-line', viewBox: '0 0 540 270', 'aria-hidden': 'true' },
    svgEl('path', { d: 'M110 50 C190 60 220 90 270 120' }), svgEl('path', { d: 'M440 46 C380 60 330 90 290 120' }),
    svgEl('path', { d: 'M62 220 C150 200 220 170 262 150' }), svgEl('path', { d: 'M470 214 C400 200 330 170 290 150' }));
  return h('div', { class: 'hero-art' }, lines, tile('hero-tile--a', 'microscope'), tile('hero-tile--b', 'robot'), tile('hero-tile--c', 'chip'), tile('hero-tile--d', 'flask'), tile('hero-tile--main', 'calendar-check', 56));
}

export function loginView({ onSignedIn }) {
  let mode = 'login';
  const card = h('div', { class: 'card auth__card stack' });
  const demoBox = h('div', { class: 'stack stack--sm' });

  async function submit(path, body, button, errorEl) {
    errorEl.textContent = '';
    setBusy(button, true, 'Signing in…');
    try {
      const { user } = await api.post(path, body);
      const { unread } = await api.get('/api/auth/me');
      update({ user, unread });
      onSignedIn();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.focus();
      setBusy(button, false);
    }
  }

  function renderLogin() {
    const error = h('div', { class: 'alert alert--danger', role: 'alert', tabindex: '-1', hidden: true });
    const showError = new MutationObserver(() => { error.hidden = !error.textContent; });
    showError.observe(error, { childList: true, characterData: true, subtree: true });
    const pw = h('input', { class: 'input', id: 'login-password', type: 'password', autocomplete: 'current-password', required: true, maxlength: '200' });
    const email = h('input', { class: 'input', id: 'login-email', type: 'email', autocomplete: 'username', required: true, maxlength: '120', placeholder: 'you@lablink.edu' });
    const toggle = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-pressed': 'false', onclick: (e) => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-pressed', String(show));
      e.currentTarget.textContent = show ? 'Hide' : 'Show';
    } }, 'Show');
    const submitBtn = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' }, 'Sign in');
    const form = h('form', { class: 'stack', novalidate: false, onsubmit: (e) => { e.preventDefault(); submit('/api/auth/login', { email: email.value, password: pw.value }, submitBtn, error); } },
      error,
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'login-email' }, 'Email'), email),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'login-password' }, 'Password'), h('div', { class: 'input-group' }, pw, toggle)),
      submitBtn);
    card.replaceChildren(
      h('div', null, h('h2', { class: 'page__title' }, 'Welcome back'), h('p', { class: 'muted' }, 'Sign in to book equipment and manage your projects.')),
      form, demoBox,
      h('p', { class: 'small muted' }, 'New here? ', h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { mode = 'register'; renderRegister(); } }, 'Create a student account')));
    setTimeout(() => email.focus(), 0);
    loadDemo(email, pw, form);
  }

  function renderRegister() {
    const error = h('div', { class: 'alert alert--danger', role: 'alert', tabindex: '-1', hidden: true });
    new MutationObserver(() => { error.hidden = !error.textContent; }).observe(error, { childList: true, characterData: true, subtree: true });
    const submitBtn = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' }, 'Create account');
    const inputs = {};
    const depts = Object.entries(state.meta.departments);
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      submit('/api/auth/register', Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])), submitBtn, error);
    } },
    error,
    field('Full name', (id) => (inputs.name = h('input', { class: 'input', id, required: true, minlength: '2', maxlength: '60', autocomplete: 'name' }))),
    field('Campus email', (id) => (inputs.email = h('input', { class: 'input', id, type: 'email', required: true, maxlength: '120', autocomplete: 'email' }))),
    field('Department', (id) => (inputs.department = selectInput(depts, depts[0][0])(id))),
    field('Password', (id, hid) => (inputs.password = h('input', { class: 'input', id, type: 'password', required: true, minlength: '8', maxlength: '128', autocomplete: 'new-password', 'aria-describedby': hid })), { hint: 'At least 8 characters, with a letter and a number.' }),
    submitBtn);
    card.replaceChildren(
      h('div', null, h('h2', { class: 'page__title' }, 'Create your account'), h('p', { class: 'muted' }, 'Student accounts can request project access and book equipment.')),
      form, h('p', { class: 'small muted' }, 'Already registered? ', h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { mode = 'login'; renderLogin(); } }, 'Sign in')));
    setTimeout(() => inputs.name.focus(), 0);
  }

  async function loadDemo(email, pw, form) {
    if (!state.meta.demoMode) return;
    try {
      const { accounts, password } = await api.get('/api/auth/demo');
      if (mode !== 'login' || !accounts.length) return;
      demoBox.replaceChildren(
        h('div', { class: 'divider-text' }, 'Try a demo account'),
        h('div', { class: 'demo-grid' }, accounts.map((a) => h('button', { type: 'button', class: 'demo-btn', 'aria-label': `Sign in as ${a.role} demo account ${a.name}`, onclick: () => {
          email.value = a.email;
          pw.value = password;
          form.requestSubmit();
        } }, h('b', null, a.name), h('span', null, `${a.role} · ${a.title}`)))));
    } catch { /* demo accounts are optional */ }
  }

  renderLogin();
  return h('div', { class: 'auth' },
    h('section', { class: 'auth__hero', 'aria-label': 'About LabLink' },
      h('div', { class: 'brand' }, h('span', { class: 'brand__mark' }, icon('target', { size: 22 })), h('span', { class: 'brand__name' }, 'LabLink')),
      h('div', null, h('p', { class: 'eyebrow' }, 'GenAI-powered lab sharing'),
        h('h1', null, 'Making college laboratories ', h('span', { class: 'gradient-text' }, 'more accessible.'))),
      h('p', { class: 'lead' }, 'Discover specialised equipment across departments, book intelligent slots, request project-based access and let AI resolve scheduling conflicts fairly.'),
      heroArt(),
      h('ul', { class: 'feature-list' }, FEATURES.map(([ic, title, text]) => h('li', { class: 'feature' }, icon(ic, { size: 20 }), h('span', null, h('strong', null, title), text))))),
    h('main', { class: 'auth__panel', id: 'main' }, card));
}
