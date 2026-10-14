(() => {
  'use strict';

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrf = csrfMeta ? csrfMeta.content : '';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* private mode */ } },
  };

  // The logo: if the image is missing, show the folder icon instead.
  $$('.logo-img').forEach((img) => {
    const fallback = () => { img.closest('.logo').classList.add('fallback'); img.remove(); };
    img.addEventListener('error', fallback);
    if (img.complete && img.naturalWidth === 0) fallback();
  });

  if (!csrfMeta) return; // the "link expired" page needs nothing else

  // =====================================================================
  // Helpers
  // =====================================================================
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === false || value == null) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  const fmtNumber = (n) => n.toLocaleString();
  const fmtSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
  };
  const fmtClock = (unix) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtAgo = (unix) => {
    if (!unix) return 'not yet';
    const s = Math.max(0, Math.round(Date.now() / 1000 - unix));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    const hrs = Math.round(m / 60);
    if (hrs < 48) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    return Math.round(hrs / 24) + ' days ago';
  };
  const unskeleton = (el, text) => { el.classList.remove('skeleton'); el.textContent = text; };

  // =====================================================================
  // State and API
  // =====================================================================
  const state = { status: null, folders: null, rules: null, devices: null, uploads: null, logLines: [] };
  let current = { page: 'home', section: '' };
  let stopped = false;
  let doctorText = '';

  function showStopped(title, text) {
    stopped = true;
    $('#content').replaceChildren(
      h('section', { class: 'card empty-state' },
        h('span', { class: 'empty-icon' }, icon('power')),
        h('h2', null, title),
        h('p', { class: 'muted' }, text)));
    $$('.nav-item[data-page]').forEach((a) => a.setAttribute('aria-current', 'false'));
    $('#conn-banner').hidden = true;
    setStatus('bad', title);
  }

  function setStatus(kind, text) {
    $('#status-dot').className = 'dot ' + kind;
    $('#status-text').textContent = text;
  }

  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(path, { ...options, cache: 'no-store', headers: { 'X-CSRF-Token': csrf, ...(options.headers || {}) } });
    } catch (e) {
      throw new Error('The agent is not responding.');
    }
    if (res.status === 401 || res.status === 403) {
      showStopped('This page has expired', 'Run "fsagent -ui" (or double-click the agent) to open the dashboard again.');
      throw new Error('locked');
    }
    const isJSON = (res.headers.get('content-type') || '').includes('json');
    const data = isJSON ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
    return data;
  }
  const postJSON = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const oops = (e) => { if (e.message !== 'locked') toast(e.message, 'bad'); };

  // =====================================================================
  // UI primitives: toast, confirm, busy buttons, clipboard
  // =====================================================================
  function toast(message, kind) {
    const el = h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : '') }, icon(kind === 'bad' ? 'alert' : 'check'), h('span', null, message));
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, kind === 'bad' ? 6500 : 3500);
  }

  function confirmDialog({ title, text, ok, danger }) {
    return new Promise((resolve) => {
      const dlg = $('#confirm');
      const okBtn = $('#confirm-ok');
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      okBtn.textContent = ok || 'Confirm';
      okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
      let answer = false;
      const onOk = () => { answer = true; dlg.close(); };
      okBtn.addEventListener('click', onOk, { once: true });
      dlg.addEventListener('close', () => { okBtn.removeEventListener('click', onOk); resolve(answer); }, { once: true });
      dlg.showModal();
    });
  }

  async function busy(btn, fn) {
    if (!btn) return fn();
    btn.disabled = true;
    btn.classList.add('loading');
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); }
  }

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done || 'Copied');
    } catch (e) {
      toast("Copying isn't allowed here. Select the text and copy it yourself.", 'bad');
    }
  }

  // Dialogs: the close button, and a click on the backdrop.
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) closer.closest('dialog').close();
    if (e.target instanceof HTMLDialogElement) e.target.close();
  });

  // =====================================================================
  // Shell: sidebar, drawer, theme, delegated actions
  // =====================================================================
  const SIDEBAR_KEY = 'fsagent.sidebar';
  const THEME_KEY = 'fsagent.theme';

  function applySidebar(mode) {
    document.body.dataset.sidebar = mode;
    const btn = $('[data-action="toggle-sidebar"]');
    const label = mode === 'collapsed' ? 'Expand the sidebar' : 'Collapse the sidebar';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
  function initSidebar() {
    const saved = store.get(SIDEBAR_KEY);
    applySidebar(saved === 'collapsed' || saved === 'expanded' ? saved : (window.innerWidth < 1100 ? 'collapsed' : 'expanded'));
  }

  function openDrawer() {
    document.body.classList.add('nav-open');
    $('.menu-btn').setAttribute('aria-expanded', 'true');
    $('.main-col').inert = true;
    const first = $('.nav-item[aria-current="page"]') || $('.nav-item');
    if (first) first.focus();
  }
  function closeDrawer() {
    if (!document.body.classList.contains('nav-open')) return;
    document.body.classList.remove('nav-open');
    $('.menu-btn').setAttribute('aria-expanded', 'false');
    $('.main-col').inert = false;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  function currentTheme() {
    const t = store.get(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  }
  function setTheme(choice) {
    if (choice === 'light' || choice === 'dark') { store.set(THEME_KEY, choice); document.documentElement.dataset.theme = choice; }
    else { store.set(THEME_KEY, null); delete document.documentElement.dataset.theme; }
    renderTheme();
  }
  function renderTheme() {
    const t = currentTheme();
    $$('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === t)));
  }

  document.addEventListener('click', (e) => {
    const themeBtn = e.target.closest('[data-theme-choice]');
    if (themeBtn) { setTheme(themeBtn.dataset.themeChoice); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'toggle-sidebar': {
        const next = document.body.dataset.sidebar === 'collapsed' ? 'expanded' : 'collapsed';
        applySidebar(next);
        store.set(SIDEBAR_KEY, next);
        break;
      }
      case 'open-drawer': openDrawer(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'report': openReport(); break;
      case 'quit': quit(); break;
      case 'rescan': rescan(el); break;
      case 'open-logs': openLogFolder(); break;
      case 'copy-address': copyText((state.status && state.status.address) || '', 'Address copied'); break;
      default: break;
    }
  });

  // =====================================================================
  // Router: #page, #page/section  (tabs, or the id of something to open)
  // =====================================================================
  const PAGES = {
    home: { title: 'Home', sub: 'Your PC is ready to share files with your phone.' },
    phones: { title: 'Phones', sub: 'Pair phones and manage who can connect.' },
    folders: { title: 'Folders', sub: 'Choose what your phone can see.', tabs: ['shared', 'filters'] },
    settings: { title: 'Settings', sub: 'Permissions, startup and advanced options.' },
    help: { title: 'Help', sub: 'Check your setup, see what happened, report a problem.', tabs: ['check', 'activity', 'log'] },
  };
  // Links from earlier versions (and the first-run link from the terminal) keep working.
  const ALIASES = { pair: 'phones', rules: 'folders/filters', activity: 'help/activity', doctor: 'help/check', logs: 'help/log' };

  function parseHash() {
    let raw = decodeURIComponent((location.hash || '#home').slice(1));
    if (ALIASES[raw]) raw = ALIASES[raw];
    const [page, section = ''] = raw.split('/');
    return PAGES[page] ? { page, section } : { page: 'home', section: '' };
  }

  function go(hash) {
    if (location.hash === '#' + hash) route(); else location.hash = hash;
  }

  function selectTab(page, tab) {
    const root = $('.page[data-page="' + page + '"]');
    $$('[role="tab"]', root).forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $$('[data-panel]', root).forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  }

  function route() {
    if (stopped) return;
    const { page, section } = parseHash();
    const def = PAGES[page];
    const tab = def.tabs ? (def.tabs.includes(section) ? section : def.tabs[0]) : '';
    current = { page, section: def.tabs ? tab : section };

    $$('.page').forEach((p) => { p.hidden = p.dataset.page !== page; });
    $$('.nav-item[data-page]').forEach((a) => a.setAttribute('aria-current', a.dataset.page === page ? 'page' : 'false'));
    $('#page-title').textContent = def.title;
    $('#page-sub').textContent = def.sub;
    document.title = def.title + ' · agent';
    closeDrawer();

    if (def.tabs) selectTab(page, tab);
    onShow(page, def.tabs ? tab : section);

    const target = !def.tabs && section ? document.getElementById(section) : null;
    if (target) {
      if (target.tagName === 'DETAILS') target.open = true;
      target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1700);
    } else {
      window.scrollTo(0, 0);
    }
  }

  function onShow(page, where) {
    if (page === 'phones') loadPairing();
    if (page === 'folders') { if (where === 'filters') loadRules(); else loadFolders(); }
    if (page === 'settings') loadSettings();
    if (page === 'help') {
      if (where === 'check' && !doctorText) runDoctor();
      if (where === 'activity') renderFeed();
      if (where === 'log') loadLogs();
    }
  }

  // Tabs: click, and arrow keys.
  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[role="tab"]');
    if (!tabBtn) return;
    const page = tabBtn.closest('.page').dataset.page;
    go(tabBtn.dataset.tab === PAGES[page].tabs[0] ? page : page + '/' + tabBtn.dataset.tab);
  });
  document.addEventListener('keydown', (e) => {
    const tabBtn = e.target.closest('[role="tab"]');
    if (!tabBtn || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = $$('[role="tab"]', tabBtn.closest('[role="tablist"]'));
    let i = tabs.indexOf(tabBtn);
    if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
    else i = e.key === 'Home' ? 0 : tabs.length - 1;
    e.preventDefault();
    tabs[i].focus();
    tabs[i].click();
  });

  // =====================================================================
  // Status (every page) and Home
  // =====================================================================
  async function refresh() {
    if (stopped) return;
    try {
      state.status = await api('/api/status');
      $('#conn-banner').hidden = true;
      renderStatus();
    } catch (e) {
      if (e.message !== 'locked' && !stopped) {
        setStatus('bad', 'Not responding');
        $('#conn-banner').hidden = false;
      }
    }
  }

  function renderStatus() {
    const s = state.status;
    if (!s) return;
    setStatus(s.scanning ? 'busy' : 'ok', s.scanning ? 'Scanning...' : 'Running');
    renderHome();
    if (current.page === 'help' && current.section === 'activity') renderFeed();
    if (current.page === 'settings') renderAdvancedInfo();
  }

  function renderEvents(list, events, limit) {
    list.replaceChildren();
    const shown = events.slice(0, limit);
    if (!shown.length) list.append(h('li', { class: 'muted' }, 'Nothing yet.'));
    for (const e of shown) list.append(h('li', null, h('time', null, fmtClock(e.time)), h('span', null, e.text)));
  }

  function permRow(iconName, label, hint, on, always) {
    return h('li', { class: 'perm' },
      h('span', { class: 'perm-icon' }, icon(iconName)),
      h('span', { class: 'perm-text' }, h('strong', null, label), h('span', { class: 'muted small' }, hint)),
      always ? h('span', { class: 'chip ok' }, 'On') : h('a', { class: 'chip ' + (on ? 'ok' : 'off'), href: '#settings', title: 'Change in Settings' }, on ? 'On' : 'Off'));
  }

  function renderHome() {
    const s = state.status;
    const enabled = s.folders.filter((f) => !f.disabled);

    let kind = 'ok', glyph = 'check', title = 'Your files are ready', sub;
    if (s.scanning) {
      kind = 'busy'; glyph = 'refresh'; title = 'Looking through your folders...'; sub = 'This can take a moment.';
    } else if (!enabled.length) {
      kind = 'warn'; glyph = 'folder'; title = 'Nothing is shared yet'; sub = 'Add a folder to start sharing files with your phone.';
    } else {
      sub = 'Sharing ' + fmtNumber(s.files) + ' files from ' + enabled.length + (enabled.length === 1 ? ' folder.' : ' folders.');
    }
    $('#home-hero').className = 'card hero ' + kind;
    $('#home-icon').replaceChildren(icon(glyph));
    $('#home-title').textContent = title;
    $('#home-sub').textContent = sub;
    $('#home-rescan').disabled = s.scanning;

    unskeleton($('#tile-files'), fmtNumber(s.files));
    unskeleton($('#tile-folders'), enabled.length + (enabled.length === s.folders.length ? '' : ' of ' + s.folders.length));
    unskeleton($('#tile-phones'), fmtNumber(s.phones));
    unskeleton($('#tile-scan'), fmtAgo(s.indexed_at));

    $('#perm-list').replaceChildren(
      permRow('file', 'See file names', 'Any paired phone', true, true),
      permRow('download', 'Open and download files', s.file_access ? 'Phones can read your files' : 'Phones can only see names', s.file_access),
      permRow('upload', 'Send files to this PC', s.uploads ? 'Into your drop folder' : 'Switched off', s.uploads));

    const steps = [
      { done: enabled.length > 0, text: 'Choose the folders to share', href: '#folders' },
      { done: s.indexed_at > 0, text: 'Your folders are scanned' },
      { done: s.sync_count > 0, text: 'Connect your phone and tap Update', href: '#phones' },
    ];
    $('#getting-started').hidden = s.sync_count > 0;
    $('#gs-list').replaceChildren(...steps.map((step, i) =>
      h('li', { class: step.done ? 'done' : '' },
        h('span', { class: 'check-badge' }, step.done ? icon('check') : String(i + 1)),
        h('span', { class: 'check-text' }, step.text),
        !step.done && step.href ? h('a', { class: 'link', href: step.href }, 'Open') : null)));

    renderEvents($('#home-activity'), s.events, 6);
  }

  function renderFeed() {
    if (state.status) renderEvents($('#feed'), state.status.events, 60);
  }

  async function rescan(btn) {
    await busy(btn, async () => {
      try {
        const r = await postJSON('/api/rescan');
        toast(r.started ? 'Scanning your folders...' : 'A scan is already running.');
        await refresh();
      } catch (e) { oops(e); }
    });
  }

  // =====================================================================
  // Phones: pairing code, QR, paired phones
  // =====================================================================
  let lastQrKey = null;
  let pairExpires = 0;
  let pairRefreshing = false;

  async function loadPairing() {
    if (stopped) return;
    try { renderPairing(await api('/api/pairing')); } catch (e) { /* the status check shows the problem */ }
    loadDevices();
  }

  function renderPairing(p) {
    pairExpires = p.expires_at;
    $('#pair-code').textContent = p.code;
    $('#address-code').textContent = p.code;
    $('#address').textContent = p.address || 'unknown';
    $('#pair-warning').hidden = Boolean(p.address);

    const qr = $('#qr');
    if (!p.address) {
      qr.hidden = true;
      $('#qr-empty').hidden = false;
      lastQrKey = null;
    } else {
      $('#qr-empty').hidden = true;
      const key = p.address + '|' + p.code;
      if (key !== lastQrKey) {
        lastQrKey = key;
        qr.src = '/api/pairing.svg?t=' + Date.now();
        qr.hidden = false;
      }
    }
    const others = p.others || [];
    $('#others').hidden = others.length === 0;
    $('#others-list').replaceChildren(...others.map((ip) => h('span', { class: 'chip' }, ip)));
    tickExpiry();
  }

  function tickExpiry() {
    const note = $('#pair-expiry');
    if (!pairExpires) { note.textContent = ''; return; }
    const left = Math.round(pairExpires - Date.now() / 1000);
    if (left <= 0) {
      note.textContent = 'Getting a new code...';
      if (current.page === 'phones' && !pairRefreshing) {
        pairRefreshing = true;
        loadPairing().finally(() => { pairRefreshing = false; });
      }
      return;
    }
    note.textContent = 'Works once, for ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' more';
  }
  setInterval(() => { if (!stopped && current.page === 'phones') tickExpiry(); }, 1000);

  $('#pair-new').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      renderPairing(await postJSON('/api/pairing/new'));
      toast('A new code is ready');
    } catch (err) { oops(err); }
  }));

  async function loadDevices() {
    try { renderDevices(await api('/api/devices')); } catch (e) { /* the status check shows the problem */ }
  }

  function renderDevices(res) {
    state.devices = res;
    $('#phone-empty').hidden = res.devices.length > 0;
    $('#phone-list').replaceChildren(...res.devices.map((d) =>
      h('article', { class: 'phone-card' },
        h('div', { class: 'phone-icon' }, icon('phone')),
        h('div', { class: 'folder-meta' },
          h('strong', null, d.name),
          h('span', { class: 'folder-path' }, 'Paired ' + fmtAgo(d.created_at) + ' · last seen ' + fmtAgo(d.last_seen) + (d.last_ip ? ' · ' + d.last_ip : ''))),
        h('button', { class: 'btn danger sm', type: 'button', onClick: () => revokeDevice(d) }, icon('trash'), 'Remove'))));
    $('#legacy-note').hidden = !res.legacy.enabled || !(res.devices.length > 0 || res.legacy.last_used);
    renderLegacy();
  }

  async function revokeDevice(d) {
    const yes = await confirmDialog({
      title: 'Remove ' + d.name + '?',
      text: 'This phone can no longer read your file list. It can pair again with a new code.',
      ok: 'Remove phone', danger: true,
    });
    if (!yes) return;
    try {
      await postJSON('/api/devices/revoke', { id: d.id });
      toast(d.name + ' was removed');
    } catch (e) { oops(e); }
    loadDevices();
    refresh();
  }

  // =====================================================================
  // Folders: shared folders, picker, privacy filters
  // =====================================================================
  async function loadFolders() {
    try { state.folders = await api('/api/folders'); renderFolders(); } catch (e) { oops(e); }
  }

  function switchEl(checked, label, onChange) {
    const input = h('input', { type: 'checkbox', 'aria-label': label });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'track' }));
  }

  async function changeFolder(body, message) {
    try { await postJSON('/api/folders/update', body); toast(message); } catch (e) { oops(e); }
    await loadFolders();
    refresh();
  }

  async function removeFolderAsk(f) {
    const yes = await confirmDialog({
      title: 'Stop sharing "' + f.label + '"?',
      text: 'It disappears from your phone at its next update. Nothing on this computer is deleted.',
      ok: 'Stop sharing', danger: true,
    });
    if (!yes) return;
    try { await postJSON('/api/folders/remove', { label: f.label }); toast('Stopped sharing ' + f.label); } catch (e) { oops(e); }
    await loadFolders();
    refresh();
  }

  function folderCard(f) {
    const hidden = h('input', { type: 'checkbox' });
    hidden.checked = f.include_hidden;
    hidden.addEventListener('change', () => changeFolder({ label: f.label, include_hidden: hidden.checked }, 'Saved'));

    return h('article', { class: 'folder-card' + (f.disabled ? ' off' : '') },
      h('div', { class: 'folder-icon' }, icon('folder')),
      h('div', { class: 'folder-meta' },
        h('strong', null, f.label),
        h('span', { class: 'folder-path' }, f.path),
        h('div', { class: 'folder-stats' },
          f.missing ? h('span', { class: 'chip warn' }, "Can't be found right now") : null,
          h('span', { class: 'chip' }, fmtNumber(f.files) + ' files'),
          h('span', { class: 'chip' }, fmtSize(f.bytes)))),
      h('div', { class: 'folder-side' },
        switchEl(!f.disabled, 'Share ' + f.label, (on) => changeFolder({ label: f.label, disabled: !on }, on ? 'Sharing ' + f.label : f.label + ' is switched off')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Stop sharing ' + f.label, title: 'Stop sharing', onClick: () => removeFolderAsk(f) }, icon('trash'))),
      h('div', { class: 'folder-extra' }, h('label', { class: 'check' }, hidden, 'Include hidden files in this folder')));
  }

  function renderFolders() {
    const { folders, suggestions } = state.folders;
    $('#folder-list').replaceChildren(...(folders.length
      ? folders.map(folderCard)
      : [h('div', { class: 'empty-state' },
          h('span', { class: 'empty-icon' }, icon('folder')),
          h('strong', null, 'No folders yet'),
          h('span', { class: 'muted small' }, 'Add a folder to start sharing files with your phone.'))]));
    $('#folder-suggestions').hidden = suggestions.length === 0;
    $('#suggestion-chips').replaceChildren(...suggestions.map((s) =>
      h('button', { class: 'chip', type: 'button', onClick: () => addFolder(s.path, s.label) }, icon('plus'), s.label)));
  }

  async function addFolder(path, label) {
    try {
      const r = await postJSON('/api/folders/add', { path, label });
      toast('Now sharing ' + r.label + '. Scanning...');
      $('#picker').close();
    } catch (e) {
      if (e.message === 'locked') return;
      if ($('#picker').open) showPickerError(e.message); else toast(e.message, 'bad');
      return;
    }
    await loadFolders();
    refresh();
  }

  $('#add-folder').addEventListener('click', () => openPicker(''));

  // ----- the folder picker (also used to choose the drop folder) -----
  const picker = { path: '', parent: '', home: '', hidden: false };
  let pickerOnPick = null;

  function showPickerError(message) {
    const box = $('#picker-error');
    box.hidden = !message;
    box.textContent = message || '';
  }
  const folderName = (path) => path.split(/[\\/]/).filter(Boolean).pop() || '';

  async function openPicker(start, opts) {
    pickerOnPick = opts && opts.onPick ? opts.onPick : null;
    const choosing = Boolean(pickerOnPick);
    $('#picker-title').textContent = choosing ? 'Choose the drop folder' : 'Choose a folder to share';
    $('#picker-confirm').textContent = choosing ? 'Use this folder' : 'Share this folder';
    $('#picker-label-field').hidden = choosing;
    $('#picker-label').value = '';
    showPickerError('');
    $('#picker').showModal();
    await loadPicker(start);
  }

  async function loadPicker(path) {
    try {
      const res = await api('/api/fs/list?path=' + encodeURIComponent(path || '') + (picker.hidden ? '&hidden=1' : ''));
      showPickerError('');
      picker.path = res.path;
      picker.parent = res.parent;
      picker.home = res.home;
      $('#picker-current').textContent = res.path || 'This computer';
      $('#picker-up').hidden = !res.parent;
      $('#picker-confirm').disabled = !res.path;
      $('#picker-label').placeholder = folderName(res.path) || 'Name';

      const list = $('#picker-list');
      list.replaceChildren();
      if (!res.entries.length) list.append(h('div', { class: 'picker-empty' }, 'No folders in here.'));
      for (const entry of res.entries) {
        list.append(h('button', { class: 'picker-item', type: 'button', role: 'listitem', onClick: () => loadPicker(entry.path) },
          icon('folder'), h('span', null, entry.name), icon('chevron')));
      }
      if (res.truncated) list.append(h('div', { class: 'picker-empty' }, 'Only the first 1,000 folders are shown.'));
      list.scrollTop = 0;
    } catch (e) { if (e.message !== 'locked') showPickerError(e.message); }
  }

  $('#picker-up').addEventListener('click', () => loadPicker(picker.parent));
  $('#picker-home').addEventListener('click', () => loadPicker(''));
  $('#picker-hidden').addEventListener('change', (e) => { picker.hidden = e.target.checked; loadPicker(picker.path); });
  $('#picker-confirm').addEventListener('click', () => {
    if (pickerOnPick) {
      const pick = pickerOnPick;
      $('#picker').close();
      pick(picker.path);
      return;
    }
    addFolder(picker.path, $('#picker-label').value.trim());
  });
  $('#picker-mkdir').addEventListener('click', async () => {
    if (!picker.path) { showPickerError('Open a folder first.'); return; }
    const name = window.prompt('Name of the new folder');
    if (!name) return;
    try {
      const res = await postJSON('/api/fs/mkdir', { parent: picker.path, name });
      await loadPicker(res.path);
    } catch (e) { if (e.message !== 'locked') showPickerError(e.message); }
  });

  // ----- privacy filters -----
  async function loadRules() {
    try { state.rules = await api('/api/rules'); renderRules(); } catch (e) { oops(e); }
  }

  function renderRules() {
    const r = state.rules;
    $('#rule-hidden').checked = r.include_hidden;
    $('#rule-empty').hidden = r.extra.length > 0;
    $('#rule-chips').replaceChildren(...r.extra.map((p) =>
      h('span', { class: 'chip' }, h('code', null, p),
        h('button', { type: 'button', 'aria-label': 'Remove the rule ' + p, onClick: () => saveRules(r.extra.filter((x) => x !== p), r.include_hidden) }, icon('x')))));
    $('#builtin').replaceChildren(...r.builtin.map((g) =>
      h('div', { class: 'rule-group' },
        h('h3', null, g.source[0].toUpperCase() + g.source.slice(1)),
        h('p', { class: 'muted small' }, g.note),
        h('div', { class: 'chips' }, g.patterns.map((p) => h('code', null, p))))));
  }

  async function saveRules(extra, includeHidden) {
    try { await postJSON('/api/rules', { extra, include_hidden: includeHidden }); toast('Saved. The agent is rescanning.'); } catch (e) { oops(e); }
    await loadRules();
    refresh();
  }
  $('#rule-hidden').addEventListener('change', (e) => saveRules(state.rules.extra, e.target.checked));

  function addRule() {
    const input = $('#rule-input');
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    saveRules([...state.rules.extra, value], state.rules.include_hidden);
  }
  $('#rule-add').addEventListener('click', addRule);
  $('#rule-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addRule(); });

  async function runTest() {
    const value = $('#test-input').value;
    if (!value.trim()) return;
    try {
      const v = await postJSON('/api/rules/test', { path: value });
      const box = $('#test-result');
      box.hidden = false;
      box.className = 'verdict ' + (v.shared ? 'yes' : 'no');
      box.replaceChildren(icon(v.shared ? 'check' : 'x'), h('span', null, v.reason));
    } catch (e) { oops(e); }
  }
  $('#test-run').addEventListener('click', runTest);
  $('#test-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runTest(); });

  // =====================================================================
  // Settings
  // =====================================================================
  async function loadSettings() {
    renderTheme();
    await Promise.all([loadAutostart(), loadFileAccess(), loadUploads(), loadDevices()]);
    renderAdvancedInfo();
  }

  async function loadAutostart() {
    const box = $('#autostart-switch');
    const note = $('#autostart-error');
    try {
      const a = await api('/api/autostart');
      box.checked = a.enabled;
      box.disabled = !a.supported;
      note.hidden = !a.detail;
      note.textContent = a.detail || '';
    } catch (e) { oops(e); }
  }
  $('#autostart-switch').addEventListener('change', async (e) => {
    const box = e.target;
    const wanted = box.checked;
    box.disabled = true;
    try {
      await postJSON('/api/autostart', { enabled: wanted });
      toast(wanted ? 'The agent will start when you sign in' : "The agent won't start by itself any more");
    } catch (err) { oops(err); }
    await loadAutostart();
  });

  async function loadFileAccess() {
    try { $('#fileaccess-switch').checked = (await api('/api/fileaccess')).enabled; } catch (e) { oops(e); }
  }
  $('#fileaccess-switch').addEventListener('change', async (e) => {
    const box = e.target;
    const wanted = box.checked;
    if (wanted) {
      const yes = await confirmDialog({
        title: 'Let paired phones open and download files?',
        text: 'A paired phone will be able to read any file the agent lists, not just its name. Files travel over your network without encryption: do this only on a network you trust, or with a direct hotspot link between your phone and this PC.',
        ok: 'Turn it on',
      });
      if (!yes) { box.checked = false; return; }
    }
    box.disabled = true;
    try {
      await postJSON('/api/fileaccess', { enabled: wanted });
      toast(wanted ? 'Phones can now open files' : 'Phones can only see file names');
    } catch (err) { oops(err); }
    box.disabled = false;
    await loadFileAccess();
    refresh();
  });

  // ----- receiving files -----
  let uploadDir = '';

  async function loadUploads() {
    try {
      state.uploads = await api('/api/uploads');
      uploadDir = state.uploads.dir;
      renderUploads();
    } catch (e) { oops(e); }
  }

  function renderUploadDir() {
    const u = state.uploads;
    $('#upload-dir').textContent = uploadDir || 'No folder chosen yet';
    $('#upload-dir-warn').hidden = !(uploadDir && u && uploadDir === u.dir && !u.dir_ok);
    $('#upload-open').hidden = !(u && u.dir && uploadDir === u.dir);
  }

  function renderUploads() {
    const u = state.uploads;
    $('#upload-switch').checked = u.enabled;
    $('#upload-max').value = u.max_mb;
    $('#upload-hour').value = u.per_hour;
    $('#upload-programs').checked = u.allow_programs;
    $('#upload-used').textContent = u.used_this_hour + ' received in the last hour';
    renderUploadDir();
  }

  $('#upload-choose').addEventListener('click', () =>
    openPicker(uploadDir || '', { onPick: (path) => { uploadDir = path; renderUploadDir(); } }));
  $('#upload-open').addEventListener('click', async () => {
    try { await postJSON('/api/uploads/open'); } catch (e) { oops(e); }
  });

  async function saveUploads(btn) {
    const wanted = $('#upload-switch').checked;
    if (wanted && !state.uploads.enabled) {
      const yes = await confirmDialog({
        title: 'Let paired phones send files to this PC?',
        text: 'A paired phone will be able to put files into the drop folder (never overwriting anything). Files travel over your network without encryption: do this only on a network you trust, or with a direct hotspot link between your phone and this PC.',
        ok: 'Turn it on',
      });
      if (!yes) { $('#upload-switch').checked = false; return; }
    }
    await busy(btn, async () => {
      try {
        state.uploads = await postJSON('/api/uploads', {
          enabled: wanted,
          dir: uploadDir,
          max_mb: Number($('#upload-max').value),
          per_hour: Number($('#upload-hour').value),
          allow_programs: $('#upload-programs').checked,
        });
        uploadDir = state.uploads.dir;
        renderUploads();
        toast('Saved');
        refresh();
      } catch (e) { oops(e); }
    });
  }
  $('#upload-save').addEventListener('click', (e) => saveUploads(e.currentTarget));
  $('#upload-save-adv').addEventListener('click', (e) => saveUploads(e.currentTarget));

  // ----- advanced: the old shared token, and where things are -----
  function renderLegacy() {
    const l = state.devices && state.devices.legacy;
    if (!l) return;
    $('#legacy-state').textContent = l.enabled
      ? 'On.' + (l.last_used ? ' An older app used it ' + fmtAgo(l.last_used) + '.' : '')
      : 'Off. Only phones paired with a code can connect.';
    $('#legacy-off').hidden = !l.enabled;
  }

  $('#legacy-off').addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Turn off the old shared token?',
      text: 'Phones that were paired the old way stop working until they pair again with a code. Phones paired with a code are not affected.',
      ok: 'Turn it off', danger: true,
    });
    if (!yes) return;
    try { await postJSON('/api/devices/legacy', { enabled: false }); toast('The old shared token is off'); } catch (e) { oops(e); }
    loadDevices();
  });

  function renderAdvancedInfo() {
    const s = state.status;
    if (!s) return;
    $('#adv-version').textContent = s.version + ' (API ' + s.api_version + ')';
    $('#adv-address').textContent = s.address || 'unknown';
    $('#adv-discovery').textContent = s.discovery || '-';
    $('#adv-config').textContent = s.config_path || '-';
    $('#adv-log').textContent = s.log_path || '-';
  }

  async function openLogFolder() {
    try { await postJSON('/api/logs/open'); } catch (e) { oops(e); }
  }

  // =====================================================================
  // Help: check my setup, activity, technical log, report
  // =====================================================================
  const CHECK_ICONS = { ok: 'check', warn: 'alert', fail: 'x', info: 'info' };

  async function runDoctor() {
    const btn = $('#doctor-run');
    btn.disabled = true;
    $('#doctor-summary').hidden = true;
    $('#doctor-tips').hidden = true;
    $('#doctor-results').replaceChildren(h('div', { class: 'card muted' }, 'Checking... this takes a few seconds.'));
    try { renderDoctor(await postJSON('/api/doctor')); }
    catch (e) { $('#doctor-results').replaceChildren(); oops(e); }
    btn.disabled = false;
  }

  function checkCard(c) {
    return h('article', { class: 'check-card' },
      h('div', { class: 'check-icon ' + c.status }, icon(CHECK_ICONS[c.status] || 'info')),
      h('div', { class: 'check-body' },
        h('strong', null, c.title),
        h('div', { class: 'check-detail' }, c.detail),
        c.fix ? h('div', { class: 'check-fix' }, h('strong', null, 'How to fix: '), c.fix) : null));
  }

  function checkRow(c) {
    return h('div', { class: 'check-row' },
      h('div', { class: 'check-icon ' + c.status }, icon(CHECK_ICONS[c.status] || 'info')),
      h('div', { class: 'check-body' }, h('strong', null, c.title), h('div', { class: 'check-detail' }, c.detail)));
  }

  function renderDoctor(res) {
    const rank = { fail: 0, warn: 1, info: 2, ok: 3 };
    const sorted = [...res.checks].sort((a, b) => rank[a.status] - rank[b.status]);
    const attention = sorted.filter((c) => c.status === 'fail' || c.status === 'warn');
    const rest = sorted.filter((c) => c.status === 'info' || c.status === 'ok');

    $('#doctor-results').replaceChildren(
      ...attention.map(checkCard),
      rest.length
        ? h('details', { class: 'card disclosure', open: attention.length === 0 },
            h('summary', null,
              h('span', { class: 'disc-icon' }, icon('check')),
              h('span', { class: 'disc-text' }, h('strong', null, rest.length + (rest.length === 1 ? ' check looks fine' : ' checks look fine')), h('span', { class: 'muted small' }, 'Tap to see them')),
              h('svg', { class: 'icon chev', 'aria-hidden': 'true' }, h('use', { href: '#i-down' }))),
            h('div', { class: 'check-list' }, rest.map(checkRow)))
        : null);

    const kind = res.fail > 0 ? 'no' : res.warn > 0 ? 'maybe' : 'yes';
    const text = res.fail > 0
      ? res.fail + (res.fail === 1 ? ' problem to fix' : ' problems to fix')
      : res.warn > 0
        ? 'Mostly fine: ' + res.warn + (res.warn === 1 ? ' thing to look at' : ' things to look at')
        : 'Everything checks out';
    const summary = $('#doctor-summary');
    summary.hidden = false;
    summary.className = 'verdict ' + kind;
    summary.replaceChildren(icon(kind === 'yes' ? 'check' : 'alert'), h('span', null, text));

    const addr = state.status && state.status.address ? state.status.address : 'ADDRESS:PORT';
    $('#doctor-ping-url').textContent = 'http://' + addr + '/api/v1/ping';
    $('#doctor-tips').hidden = false;

    doctorText = res.checks.map((c) => '[' + c.status.toUpperCase() + '] ' + c.title + ': ' + c.detail + (c.fix ? '\n    How to fix: ' + c.fix : '')).join('\n');
    $('#doctor-copy').hidden = false;
  }
  $('#doctor-run').addEventListener('click', runDoctor);
  $('#doctor-copy').addEventListener('click', () => copyText(doctorText, 'Results copied'));

  async function loadLogs() {
    try {
      const res = await api('/api/logs?level=' + encodeURIComponent($('#log-filter').value) + '&limit=300');
      state.logLines = res.lines;
      $('#log-path').textContent = res.path || 'not available';
      renderLogs();
    } catch (e) { oops(e); }
  }

  const LOG_LINE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (DEBUG|INFO|WARN|ERROR)\s+(.*)$/;

  function renderLogs() {
    const view = $('#log-view');
    const term = $('#log-search').value.trim().toLowerCase();
    const atEnd = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
    const lines = state.logLines.filter((l) => !term || l.toLowerCase().includes(term));

    view.replaceChildren();
    if (!lines.length) view.append(h('div', { class: 'muted' }, 'No log lines match.'));
    for (const line of lines) {
      const m = LOG_LINE.exec(line);
      view.append(m
        ? h('div', { class: 'log-line ' + m[2] }, h('span', { class: 't' }, m[1] + ' '), h('span', { class: 'l' }, m[2].padEnd(5) + ' '), m[3])
        : h('div', { class: 'log-line' }, line));
    }
    if (atEnd) view.scrollTop = view.scrollHeight;
  }
  $('#log-filter').addEventListener('change', loadLogs);
  $('#log-search').addEventListener('input', renderLogs);
  $('#log-download').addEventListener('click', () => h('a', { href: '/api/logs/download' }).click());
  $('#log-open').addEventListener('click', openLogFolder);

  async function loadReport() {
    const mask = $('#report-mask').checked ? '1' : '0';
    try { $('#report-text').value = await api('/api/report?mask=' + mask); } catch (e) { oops(e); }
  }
  function openReport() { $('#report').showModal(); loadReport(); }
  $('#report-mask').addEventListener('change', loadReport);
  $('#report-copy').addEventListener('click', () => copyText($('#report-text').value, 'Report copied'));
  $('#report-download').addEventListener('click', () => h('a', { href: '/api/report?download=1&mask=' + ($('#report-mask').checked ? '1' : '0') }).click());

  async function quit() {
    const yes = await confirmDialog({
      title: 'Quit the agent?',
      text: "Your phone won't be able to update until you start the agent again.",
      ok: 'Quit the agent', danger: true,
    });
    if (!yes) return;
    try {
      await postJSON('/api/quit');
      showStopped('The agent has stopped', 'You can close this tab. Start the agent again whenever you want to update your phone.');
    } catch (e) { oops(e); }
  }

  // =====================================================================
  // Start
  // =====================================================================
  initSidebar();
  renderTheme();
  window.addEventListener('hashchange', route);
  route();
  refresh();
  setInterval(refresh, 3000);
  setInterval(() => {
    if (stopped || document.hidden) return;
    if (current.page === 'phones') loadPairing();
    if (current.page === 'folders' && current.section === 'shared') loadFolders();
    if (current.page === 'help' && current.section === 'log') loadLogs();
  }, 5000);
})();