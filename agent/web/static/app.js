(() => {
  'use strict';

  // Everything shown comes from the agent (folder names, addresses...), so it is only
  // ever put on the page with textContent, never as HTML.
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const $ = (id) => document.getElementById(id);

  let tokenValue = '';
  let tokenShown = false;
  let lastAddress = null;
  let stopped = false;
  const timers = [];

  const fmtNumber = (n) => n.toLocaleString();
  const fmtSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
  };
  const fmtClock = (unix) =>
    new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtUptime = (seconds) => {
    if (seconds < 90) return 'less than a minute';
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return minutes + ' minutes';
    const hours = Math.round(minutes / 60);
    if (hours < 48) return hours + ' hours';
    return Math.round(hours / 24) + ' days';
  };

  function showMessage(title, text) {
    stopped = true;
    timers.forEach(clearInterval);
    const main = $('content');
    main.replaceChildren();
    const card = document.createElement('section');
    card.className = 'card';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    card.append(h, p);
    main.appendChild(card);
    setStatus('bad', title);
  }

  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: { 'X-CSRF-Token': csrf, ...(options.headers || {}) },
    });
    if (res.status === 401 || res.status === 403) {
      showMessage('This page has expired', 'Run "fsagent -ui" (or double-click the agent) to open the dashboard again.');
      throw new Error('locked');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function renderStatus(s) {
    setStatus(s.scanning ? 'busy' : 'ok', s.scanning ? 'Scanning your folders...' : 'Running');

    $('summary').textContent =
      fmtNumber(s.files) + ' files in ' + s.folders.length + (s.folders.length === 1 ? ' folder' : ' folders') +
      ' · last scan ' + (s.indexed_at ? fmtClock(s.indexed_at) : 'not yet') +
      ' · running for ' + fmtUptime(s.uptime_seconds);
    $('config-path').textContent = s.config_path;
    $('rescan').disabled = s.scanning;

    const body = $('folders-body');
    body.replaceChildren();
    for (const f of s.folders) {
      const tr = document.createElement('tr');
      [f.label, f.path, fmtNumber(f.files), fmtSize(f.bytes)].forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i >= 2) td.className = 'num';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }

    const list = $('activity-list');
    list.replaceChildren();
    if (s.events.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Nothing yet.';
      list.appendChild(li);
    }
    for (const e of s.events) {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = fmtClock(e.time);
      const text = document.createElement('span');
      text.textContent = e.text;
      li.append(time, text);
      list.appendChild(li);
    }
  }

  async function refresh() {
    if (stopped) return;
    try {
      renderStatus(await api('/api/status'));
    } catch (e) {
      if (e.message !== 'locked' && !stopped) setStatus('bad', 'The agent is not responding');
    }
  }

  function renderToken() {
    $('token').textContent = tokenShown ? tokenValue : '••••••••••••••••';
    $('token-toggle').textContent = tokenShown ? 'Hide' : 'Show';
  }

  async function loadPairing() {
    if (stopped) return;
    try {
      const p = await api('/api/pairing');
      tokenValue = p.token;
      renderToken();
      $('address').textContent = p.address || 'unknown';
      $('pair-warning').hidden = Boolean(p.address);

      const qr = $('qr');
      if (!p.address) {
        qr.hidden = true;
        lastAddress = null;
      } else if (p.address !== lastAddress) {
        lastAddress = p.address;
        qr.src = '/api/pairing.svg?t=' + Date.now();
        qr.hidden = false;
      }
    } catch (e) {
      /* the status check shows the problem */
    }
  }

  function flash(id, text) {
    const button = $(id);
    const original = button.textContent;
    button.textContent = text;
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  $('token-toggle').addEventListener('click', () => { tokenShown = !tokenShown; renderToken(); });

  $('token-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(tokenValue);
      flash('token-copy', 'Copied');
    } catch (e) {
      flash('token-copy', 'Copy failed');
    }
  });

  $('rescan').addEventListener('click', async () => {
    $('rescan').disabled = true;
    try {
      await api('/api/rescan', { method: 'POST' });
      await refresh();
    } catch (e) {
      /* handled in api() */
    }
  });

  $('quit').addEventListener('click', async () => {
    if (!confirm('Stop the agent? Your phone won\'t be able to update until you start it again.')) return;
    try {
      await api('/api/quit', { method: 'POST' });
      showMessage('The agent has stopped', 'You can close this tab. Start the agent again whenever you want to update your phone.');
    } catch (e) {
      /* handled in api() */
    }
  });

  refresh();
  loadPairing();
  timers.push(setInterval(refresh, 3000));
  timers.push(setInterval(loadPairing, 20000));
})();