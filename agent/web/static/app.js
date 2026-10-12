(() => {
  'use strict';

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrf = csrfMeta ? csrfMeta.content : '';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // The logo: if the image is missing, show the folder icon instead.
  $$('.logo-img').forEach((img) => {
    const fallback = () => { img.closest('.logo').classList.add('fallback'); img.remove(); };
    img.addEventListener('error', fallback);
    if (img.complete && img.naturalWidth === 0) fallback();
  });

  if (!csrfMeta) return; // the "link expired" page needs nothing else

  // ---------- helpers ----------
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
  const fmtUptime = (s) => {
    if (s < 90) return 'a minute';
    const m = Math.round(s / 60);
    if (m < 90) return m + ' minutes';
    const hrs = Math.round(m / 60);
    if (hrs < 48) return hrs + ' hours';
    return Math.round(hrs / 24) + ' days';
  };

  // ---------- state and API ----------
  const PAGES = { home: 'Home', folders: 'Folders', pair: 'Connect a phone', rules: 'Privacy & filters', activity: 'Activity & logs', doctor: 'Check my setup', settings: 'Settings' };
  const state = { status: null, folders: null, rules: null, logLines: [] };
  let currentPage = 'home';
  let stopped = false;
  let lastAddress = null;
  let tokenValue = '';
  let tokenShown = false;

  function showStopped(title, text) {
    stopped = true;
    $('#pages').replaceChildren(h('section', { class: 'card' }, h('h2', null, title), h('p', { class: 'muted' }, text)));
    $$('.nav-item').forEach((a) => a.setAttribute('aria-current', 'false'));
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

  // ---------- toasts and dialogs ----------
  function toast(message, kind) {
    const el = h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : '') }, message);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
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

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) closer.closest('dialog').close();
    if (e.target instanceof HTMLDialogElement) e.target.close(); // a click on the backdrop
  });

  async function copyText(text, button, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done || 'Copied');
    } catch (e) {
      toast('Copying isn\'t allowed here. Select the text and copy it yourself.', 'bad');
    }
  }

  // ---------- routing ----------
  function route() {
    if (stopped) return;
    const name = (location.hash || '#home').slice(1);
    showPage(PAGES[name] ? name : 'home');
  }

  function showPage(name) {
    currentPage = name;
    $$('.page').forEach((p) => { p.hidden = p.dataset.page !== name; });
    $$('.nav-item').forEach((a) => a.setAttribute('aria-current', a.dataset.page === name ? 'page' : 'false'));
    $('#page-title').textContent = PAGES[name];
    document.title = PAGES[name] + ' · agent';
    if (name === 'folders') loadFolders();
    if (name === 'pair') loadPairing();
    if (name === 'rules') loadRules();
    if (name === 'activity') { renderFeed(); if (!$('#panel-log').hidden) loadLogs(); }
    if (name === 'settings') loadAutostart();
    if (name === 'doctor' && !doctorText) runDoctor();
  }

  // ---------- status (all pages) ----------
  async function refresh() {
    if (stopped) return;
    try {
      state.status = await api('/api/status');
      renderStatus();
    } catch (e) {
      if (e.message !== 'locked' && !stopped) setStatus('bad', 'The agent is not responding');
    }
  }

  function renderStatus() {
    const s = state.status;
    if (!s) return;
    setStatus(s.scanning ? 'busy' : 'ok', s.scanning ? 'Scanning your folders...' : 'Running');
    renderHome();
    if (currentPage === 'activity') renderFeed();
  }

  function renderEvents(list, events, limit) {
    list.replaceChildren();
    const shown = events.slice(0, limit);
    if (!shown.length) list.append(h('li', { class: 'muted' }, 'Nothing yet.'));
    for (const e of shown) list.append(h('li', null, h('time', null, fmtClock(e.time)), h('span', null, e.text)));
  }

  function renderHome() {
    const s = state.status;
    const enabled = s.folders.filter((f) => !f.disabled);

    let kind = 'ok', title = 'Everything is running', sub, glyph = 'check';
    if (s.scanning) {
      kind = 'busy'; glyph = 'refresh'; title = 'Looking through your folders...'; sub = 'This can take a moment.';
    } else if (!enabled.length) {
      kind = 'warn'; glyph = 'folder'; title = 'No folders are shared'; sub = 'Add a folder to start sharing files with your phone.';
    } else {
      sub = 'Sharing ' + fmtNumber(s.files) + ' files from ' + enabled.length + (enabled.length === 1 ? ' folder.' : ' folders.');
    }
    $('#home-hero').className = 'hero card ' + kind;
    $('#home-icon').replaceChildren(icon(glyph));
    $('#home-title').textContent = title;
    $('#home-sub').textContent = sub;
    $('#home-rescan').disabled = s.scanning;

    $('#tile-files').textContent = fmtNumber(s.files);
    $('#tile-folders').textContent = enabled.length + (enabled.length === s.folders.length ? '' : ' of ' + s.folders.length);
    $('#tile-scan').textContent = fmtAgo(s.indexed_at);
    $('#tile-uptime').textContent = fmtUptime(s.uptime_seconds);

    const steps = [
      { done: enabled.length > 0, text: 'Choose the folders to share', href: '#folders' },
      { done: s.indexed_at > 0, text: 'Your folders are scanned' },
      { done: s.sync_count > 0, text: 'Connect your phone and tap Update', href: '#pair' },
    ];
    $('#getting-started').hidden = s.sync_count > 0;
    $('#gs-list').replaceChildren(...steps.map((step, i) =>
      h('li', { class: step.done ? 'done' : '' },
        h('span', { class: 'check-badge' }, step.done ? icon('check') : String(i + 1)),
        h('span', { class: 'check-text' }, step.text),
        !step.done && step.href ? h('a', { class: 'link', href: step.href }, 'Open') : null)));

    renderEvents($('#home-activity'), s.events, 5);
  }

  function renderFeed() {
    if (state.status) renderEvents($('#feed'), state.status.events, 50);
  }

  $('#home-rescan').addEventListener('click', async () => {
    $('#home-rescan').disabled = true;
    try {
      const r = await postJSON('/api/rescan');
      toast(r.started ? 'Scanning your folders...' : 'A scan is already running.');
      await refresh();
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  });

  // ---------- folders ----------
  async function loadFolders() {
    try {
      state.folders = await api('/api/folders');
      renderFolders();
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  }

  function switchEl(checked, label, onChange) {
    const input = h('input', { type: 'checkbox', 'aria-label': label });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'track' }));
  }

  async function changeFolder(body, message) {
    try {
      await postJSON('/api/folders/update', body);
      toast(message);
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
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
    try {
      await postJSON('/api/folders/remove', { label: f.label });
      toast('Stopped sharing ' + f.label);
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
    await loadFolders();
    refresh();
  }

  function folderCard(f) {
    return h('article', { class: 'folder-card' + (f.disabled ? ' off' : '') },
      h('div', { class: 'folder-icon' }, icon('folder')),
      h('div', { class: 'folder-meta' },
        h('strong', null, f.label),
        h('span', { class: 'folder-path' }, f.path),
        h('div', { class: 'folder-stats' },
          f.missing ? h('span', { class: 'chip warn' }, 'Can\'t be found right now') : null,
          h('span', { class: 'chip' }, fmtNumber(f.files) + ' files'),
          h('span', { class: 'chip' }, fmtSize(f.bytes)))),
      h('div', { class: 'folder-side' },
        switchEl(!f.disabled, 'Share ' + f.label, (on) => changeFolder({ label: f.label, disabled: !on }, on ? 'Sharing ' + f.label : f.label + ' is switched off')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Stop sharing ' + f.label, onClick: () => removeFolderAsk(f) }, icon('trash'))),
      h('div', { class: 'folder-extra' },
        h('label', { class: 'check' },
          (() => {
            const box = h('input', { type: 'checkbox' });
            box.checked = f.include_hidden;
            box.addEventListener('change', () => changeFolder({ label: f.label, include_hidden: box.checked }, 'Saved'));
            return box;
          })(),
          'Include hidden files in this folder')));
  }

  function renderFolders() {
    const { folders, suggestions } = state.folders;
    $('#folder-list').replaceChildren(...(folders.length
      ? folders.map(folderCard)
      : [h('div', { class: 'card' }, h('h2', null, 'No folders yet'), h('p', { class: 'muted' }, 'Add a folder to start sharing files with your phone.'))]));

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

  // ---------- the folder picker ----------
  const picker = { path: '', parent: '', home: '', hidden: false };

  function showPickerError(message) {
    const box = $('#picker-error');
    box.hidden = !message;
    box.textContent = message || '';
  }

  function folderName(path) {
    return path.split(/[\\/]/).filter(Boolean).pop() || '';
  }

  async function openPicker(start) {
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
    } catch (e) {
      if (e.message !== 'locked') showPickerError(e.message);
    }
  }

  $('#picker-up').addEventListener('click', () => loadPicker(picker.parent));
  $('#picker-home').addEventListener('click', () => loadPicker(''));
  $('#picker-hidden').addEventListener('change', (e) => { picker.hidden = e.target.checked; loadPicker(picker.path); });
  $('#picker-confirm').addEventListener('click', () => addFolder(picker.path, $('#picker-label').value.trim()));

  // ---------- connect a phone ----------
  async function loadPairing() {
    if (stopped) return;
    try {
      const p = await api('/api/pairing');
      tokenValue = p.token;
      renderToken();
      $('#address').textContent = p.address || 'unknown';
      $('#pair-warning').hidden = Boolean(p.address);

      const qr = $('#qr');
      if (!p.address) {
        qr.hidden = true;
        lastAddress = null;
      } else if (p.address !== lastAddress) {
        lastAddress = p.address;
        qr.src = '/api/pairing.svg?t=' + Date.now();
        qr.hidden = false;
      }
      const others = p.others || [];
      $('#others').hidden = others.length === 0;
      $('#others-list').replaceChildren(...others.map((ip) => h('span', { class: 'chip' }, ip)));
    } catch (e) { /* the status check shows the problem */ }
  }

  function renderToken() {
    $('#token').textContent = tokenShown ? tokenValue : '\u2022'.repeat(16);
    $('#token-toggle').textContent = tokenShown ? 'Hide' : 'Show';
  }
  $('#token-toggle').addEventListener('click', () => { tokenShown = !tokenShown; renderToken(); });
  $('#token-copy').addEventListener('click', () => copyText(tokenValue, $('#token-copy'), 'Token copied'));

  // ---------- privacy and filters ----------
  async function loadRules() {
    try {
      state.rules = await api('/api/rules');
      renderRules();
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
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
    try {
      await postJSON('/api/rules', { extra, include_hidden: includeHidden });
      toast('Saved. The agent is rescanning.');
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
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
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  }
  $('#test-run').addEventListener('click', runTest);
  $('#test-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runTest(); });

  // ---------- activity and logs ----------
  function selectTab(which) {
    const isLog = which === 'log';
    $('#tab-activity').setAttribute('aria-selected', String(!isLog));
    $('#tab-log').setAttribute('aria-selected', String(isLog));
    $('#panel-activity').hidden = isLog;
    $('#panel-log').hidden = !isLog;
    if (isLog) loadLogs(); else renderFeed();
  }
  $('#tab-activity').addEventListener('click', () => selectTab('activity'));
  $('#tab-log').addEventListener('click', () => selectTab('log'));

  async function loadLogs() {
    try {
      const res = await api('/api/logs?level=' + encodeURIComponent($('#log-filter').value) + '&limit=300');
      state.logLines = res.lines;
      $('#log-path').textContent = res.path || 'not available';
      renderLogs();
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
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
  $('#log-open').addEventListener('click', async () => {
    try { await postJSON('/api/logs/open'); }
    catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  });

  // ---------- report a problem ----------
  async function loadReport() {
    const mask = $('#report-mask').checked ? '1' : '0';
    try {
      $('#report-text').value = await api('/api/report?mask=' + mask);
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  }
  $('#open-report').addEventListener('click', () => { $('#report').showModal(); loadReport(); });
  $('#report-mask').addEventListener('change', loadReport);
  $('#report-copy').addEventListener('click', () => copyText($('#report-text').value, null, 'Report copied'));
  $('#report-download').addEventListener('click', () => h('a', { href: '/api/report?download=1&mask=' + ($('#report-mask').checked ? '1' : '0') }).click());

  // ---------- quit ----------
  $('#quit').addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Quit the agent?',
      text: 'Your phone won\'t be able to update until you start the agent again.',
      ok: 'Quit the agent', danger: true,
    });
    if (!yes) return;
    try {
      await postJSON('/api/quit');
      showStopped('The agent has stopped', 'You can close this tab. Start the agent again whenever you want to update your phone.');
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  });

  // ---------- settings ----------
  async function loadAutostart() {
    const box = $('#autostart-switch');
    const note = $('#autostart-error');
    try {
      const a = await api('/api/autostart');
      box.checked = a.enabled;
      box.disabled = !a.supported;
      note.hidden = !a.detail;
      note.textContent = a.detail || '';
    } catch (e) { if (e.message !== 'locked') toast(e.message, 'bad'); }
  }

  $('#autostart-switch').addEventListener('change', async (e) => {
    const box = e.target;
    const wanted = box.checked;
    box.disabled = true;
    try {
      await postJSON('/api/autostart', { enabled: wanted });
      toast(wanted ? 'The agent will start when you sign in' : 'The agent won\'t start by itself any more');
    } catch (err) {
      if (err.message !== 'locked') toast(err.message, 'bad');
    }
    await loadAutostart(); // shows what is really set now
  });

  // ---------- check my setup ----------
  const CHECK_ICONS = { ok: 'check', warn: 'alert', fail: 'x', info: 'help' };
  let doctorText = '';

  async function runDoctor() {
    const btn = $('#doctor-run');
    btn.disabled = true;
    $('#doctor-summary').hidden = true;
    $('#doctor-tips').hidden = true;
    $('#doctor-results').replaceChildren(h('div', { class: 'card muted' }, 'Checking... this takes a few seconds.'));
    try {
      renderDoctor(await postJSON('/api/doctor'));
    } catch (e) {
      $('#doctor-results').replaceChildren();
      if (e.message !== 'locked') toast(e.message, 'bad');
    }
    btn.disabled = false;
  }

  function renderDoctor(res) {
    const checks = res.checks;
    $('#doctor-results').replaceChildren(...checks.map((c) =>
    h('article', { class: 'check-card' },
      h('div', { class: 'check-icon ' + c.status }, icon(CHECK_ICONS[c.status] || 'help')),
      h('div', { class: 'check-body' },
        h('strong', null, c.title),
        h('div', { class: 'check-detail' }, c.detail),
        c.fix ? h('div', { class: 'check-fix' }, h('strong', null, 'How to fix: '), c.fix) : null))));

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

    doctorText = checks.map((c) => '[' + c.status.toUpperCase() + '] ' + c.title + ': ' + c.detail + (c.fix ? '\n    How to fix: ' + c.fix : '')).join('\n');
    $('#doctor-copy').hidden = false;
  }

  $('#doctor-run').addEventListener('click', runDoctor);
  $('#doctor-copy').addEventListener('click', () => copyText(doctorText, null, 'Results copied'));

  // ---------- start ----------
  window.addEventListener('hashchange', route);
  route();
  refresh();
  setInterval(refresh, 3000);
  setInterval(() => {
    if (stopped || document.hidden) return;
    if (currentPage === 'folders') loadFolders();
    if (currentPage === 'pair') loadPairing();
    if (currentPage === 'activity' && !$('#panel-log').hidden) loadLogs();
  }, 5000);
})();
