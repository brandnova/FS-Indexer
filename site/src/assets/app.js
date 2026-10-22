// The website's small interactive parts. Everything works without this file (the links go to the
// releases page); Alpine adds the system detection, the live download links, the stepper and the gallery.
document.documentElement.classList.add('js');

document.addEventListener('alpine:init', () => {
  const cfg = JSON.parse(document.getElementById('site-config')?.textContent || '{}');
  const releasesUrl = `https://github.com/${cfg.repo}/releases`;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- the visitor's system ----------
  function detectOS() {
    const ua = navigator.userAgent || '';
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';
    if (/mac/i.test(platform) || /macintosh/i.test(ua)) return 'macos';
    if (/linux|x11|cros/i.test(platform + ua)) return 'linux';
    return 'windows';
  }

  // ---------- the latest release (pre-releases count) ----------
  const ASSET = {
    winX64: /^perigee_.*_windows_amd64\.zip$/,
    winArm: /^perigee_.*_windows_arm64\.zip$/,
    macArm: /^Perigee-Files_.*_macOS_arm64\.app\.zip$/,
    macIntel: /^Perigee-Files_.*_macOS_amd64\.app\.zip$/,
    rpm: /^perigee_.*_linux_amd64\.rpm$/,
    deb: /^perigee_.*_linux_amd64\.deb$/,
    tgz: /^perigee_.*_linux_amd64\.tar\.gz$/,
    apk: /^perigee-.*\.apk$/,
    sums: /^checksums\.txt$/,
  };

  async function loadRelease() {
    const key = 'perigee.release';
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
    } catch (e) { /* no storage */ }
    try {
      const res = await fetch(`https://api.github.com/repos/${cfg.repo}/releases?per_page=8`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return null;
      const list = (await res.json()).filter((r) => !r.draft).sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      if (!list.length) return null;
      const r = list[0];
      const data = {
        tag_name: r.tag_name, prerelease: r.prerelease, published_at: r.published_at, html_url: r.html_url,
        assets: r.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url })),
      };
      try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
      return data;
    } catch (e) {
      return null;
    }
  }

  Alpine.store('rel', {
    os: detectOS(),
    state: 'loading',
    release: null,
    async init() {
      this.release = await loadRelease();
      this.state = this.release ? 'ready' : 'error';
    },
    get osLabel() {
      return { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iPhone' }[this.os] || 'your device';
    },
    get tag() { return this.release ? this.release.tag_name : 'v' + cfg.version; },
    get isPre() { return this.release ? this.release.prerelease : /-/.test(cfg.version); },
    get date() { return this.release ? new Date(this.release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; },
    get notesUrl() { return this.release ? this.release.html_url : releasesUrl; },
    find(kind) { return this.release && this.release.assets.find((a) => ASSET[kind].test(a.name)); },
    url(kind) { const a = this.find(kind); return a ? a.browser_download_url : releasesUrl; },
    size(kind) { const a = this.find(kind); return a ? (a.size / 1048576).toFixed(a.size > 10485760 ? 0 : 1) + ' MB' : ''; },
  });

  // ---------- header ----------
  Alpine.data('nav', () => ({
    open: false,
    scrolled: false,
    active: '',
    cfg,
    init() {
      const onScroll = () => { this.scrolled = window.scrollY > 12; };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(
          (entries) => entries.forEach((e) => { if (e.isIntersecting) this.active = e.target.id; }),
          { rootMargin: '-45% 0px -50% 0px' },
        );
        ['how', 'features', 'privacy', 'screens', 'download', 'faq'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) io.observe(el);
        });
      }
    },
    close() { this.open = false; },
  }));

  // ---------- how it works ----------
  Alpine.data('how', () => ({
    step: 0,
    manual: false,
    hover: false,
    timer: null,
    steps: [
      { title: 'Install it on your PC', text: 'Run Perigee on Windows, macOS or Linux. A friendly dashboard opens where you choose which folders to share. Passwords and keys are always skipped.', note: 'The program lists the folders you choose, and nothing else.' },
      { title: 'Scan once to pair', text: 'Open the app and scan the QR code. Each phone gets its own key, and the code works once and runs out in ten minutes.', note: 'A one-time code makes the phone and the PC trust each other.' },
      { title: 'Search from anywhere', text: 'Your phone keeps its own copy of the file list, so search is instant, even offline. Opening and downloading files is optional and off until you switch it on.', note: 'Your phone now holds the list, so you can search without a connection.' },
    ],
    init() {
      if (reduced()) { this.manual = true; return; }
      this.timer = setInterval(() => {
        if (!this.manual && !this.hover && !document.hidden) this.step = (this.step + 1) % this.steps.length;
      }, 6500);
    },
    go(i) { this.step = i; this.manual = true; },
    destroy() { clearInterval(this.timer); },
  }));

  // ---------- tabs (the download panels) ----------
  Alpine.data('tabs', () => ({
    tab: 'windows',
    cfg,
    list: [
      { id: 'windows', label: 'Windows' },
      { id: 'macos', label: 'macOS' },
      { id: 'linux', label: 'Linux' },
      { id: 'android', label: 'Android' },
      { id: 'ios', label: 'iPhone' },
    ],
    init() { this.tab = Alpine.store('rel').os; },
    key(e) {
      const ids = this.list.map((t) => t.id);
      let i = ids.indexOf(this.tab);
      if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
      else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
      else return;
      e.preventDefault();
      this.tab = ids[i];
      this.$nextTick(() => document.getElementById('tab-' + this.tab)?.focus());
    },
  }));

  // ---------- copy button ----------
  Alpine.data('copy', (text) => ({
    done: false,
    async run() {
      try { await navigator.clipboard.writeText(text); this.done = true; setTimeout(() => { this.done = false; }, 1800); } catch (e) { /* ignore */ }
    },
  }));

  // ---------- screenshots ----------
  Alpine.data('gallery', () => ({
    items: [],
    group: 'agent',
    index: -1,
    init() {
      try { this.items = JSON.parse(document.getElementById('gallery-data').textContent); } catch (e) { this.items = []; }
      if (this.items.length && !this.items.some((i) => i.group === 'agent')) this.group = this.items[0].group;
    },
    get groups() { return [...new Set(this.items.map((i) => i.group))]; },
    get shown() { return this.items.filter((i) => i.group === this.group); },
    get current() { return this.index >= 0 ? this.shown[this.index] : null; },
    show(i) { this.index = i; this.$nextTick(() => this.$refs.dialog.showModal()); },
    close() { this.$refs.dialog.close(); },
    step(d) { const n = this.shown.length; if (n) this.index = (this.index + d + n) % n; },
    onClose() { this.index = -1; },
  }));
});

// Copy buttons on code blocks in the documentation pages.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.prose pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-code';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.innerText);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      } catch (e) { /* ignore */ }
    });
    pre.append(btn);
  });
});