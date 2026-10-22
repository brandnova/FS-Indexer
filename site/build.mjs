// Builds the Perigee Files website into site/_site:
// the landing page, the Markdown docs as pages, the assets, a sitemap and robots.txt.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const src = path.join(here, 'src');
const out = path.join(here, '_site');
const cfg = JSON.parse(await readFile(path.join(here, 'site.json'), 'utf8'));
const releasesUrl = `https://github.com/${cfg.repo}/releases`;
const blob = (p) => `https://github.com/${cfg.repo}/blob/main/${p}`;

// ---------- small helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RAW = new Set(['header', 'footer', 'content', 'docNav', 'galleryJson', 'configJson', 'jsonld']);
const fill = (tpl, vars) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? (RAW.has(k) ? vars[k] : esc(vars[k])) : ''));
const readSrc = (p) => readFile(path.join(src, p), 'utf8');
const jsonForHtml = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

async function copyIfExists(from, to) {
  if (!existsSync(from)) {
    console.warn(`  (missing) ${path.relative(repoRoot, from)}`);
    return false;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
  return true;
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { w: 1280, h: 800 };
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ---------- what gets published ----------
// Markdown in the repository becomes a page here. Keep the files in step with the website's addresses.
const DOCS = [
  { src: 'docs/PRIVACY.md', url: 'privacy/', title: 'Privacy policy' },
  { src: 'SECURITY.md', url: 'security/', title: 'Security policy' },
  { src: 'docs/SECURITY_MODEL.md', url: 'docs/security-model/', title: 'Security model' },
  { src: 'docs/GETTING_STARTED.md', url: 'docs/getting-started/', title: 'Getting started' },
  { src: 'docs/FAQ.md', url: 'docs/faq/', title: 'FAQ' },
  { src: 'docs/API.md', url: 'docs/api/', title: 'API reference' },
];
const LINKS = Object.fromEntries(DOCS.map((d) => [path.posix.basename(d.src), d.url]));

// Screenshots: the file name (in docs/images/agent or docs/images/app) and its caption.
// A screenshot that doesn't exist yet is simply left out.
const SHOTS = {
  agent: {
    'home.png': 'Home: your files, what phones can do, recent activity',
    'phones.png': 'Pair a phone by scanning a QR code',
    'folders.png': 'Choose which folders to share',
    'filters.png': 'Privacy filters, and a tester that shows what would be shared',
    'settings.png': 'Settings: decide what your phone can do',
    'help-check.png': 'Check my setup finds problems and says how to fix them',
    'home-dark.png': 'The dashboard in dark mode',
  },
  app: {
    'welcome.png': 'A short first-run walkthrough',
    'pairing.png': 'Connect by scanning the QR code',
    'home.png': 'Home: update your list and jump back into your files',
    'search.png': 'Search your PC from your phone',
    'details.png': 'Download, open or share a file',
    'downloads.png': 'Queue several downloads and watch their progress',
    'downloads-bar.png': 'Progress is always visible while files download',
    'upload.png': 'Send files from your phone to your PC',
    'settings.png': 'App settings',
    'home-dark.png': 'The app in dark mode',
  },
};

// ---------- build ----------
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets', 'vendor'), { recursive: true });
await cp(path.join(src, 'assets'), path.join(out, 'assets'), { recursive: true });
await writeFile(path.join(out, '.nojekyll'), '');

// Alpine and the font come from npm, so nothing third-party is checked into the repository.
const alpine = path.join(here, 'node_modules/alpinejs/dist/cdn.min.js');
if (!existsSync(alpine)) throw new Error('Run "npm install" in the site/ folder first.');
await cp(alpine, path.join(out, 'assets/vendor/alpine.min.js'));

const fontDir = path.join(here, 'node_modules/@fontsource-variable/nunito/files');
const fontFile = existsSync(fontDir) ? (await readdir(fontDir)).find((f) => /latin-wght-normal\.woff2$/.test(f)) : null;
if (fontFile) {
  await mkdir(path.join(out, 'assets/fonts'), { recursive: true });
  await cp(path.join(fontDir, fontFile), path.join(out, 'assets/fonts/nunito.woff2'));
} else {
  console.warn('  (missing) the Nunito font: the page will use the system font');
}

// Logos and favicon
await copyIfExists(path.join(repoRoot, 'docs/images/logo-agent.png'), path.join(out, 'assets/logo-agent.png'));
await copyIfExists(path.join(repoRoot, 'docs/images/logo-client.png'), path.join(out, 'assets/logo-client.png'));
const favicon = path.join(repoRoot, 'agent/web/static/images/favicon.png');
await copyIfExists(existsSync(favicon) ? favicon : path.join(repoRoot, 'docs/images/logo-agent.png'), path.join(out, 'assets/favicon.png'));

// Screenshots
const gallery = [];
for (const [group, files] of Object.entries(SHOTS)) {
  for (const [file, caption] of Object.entries(files)) {
    const from = path.join(repoRoot, 'docs/images', group, file);
    if (!existsSync(from)) continue;
    const dest = path.join(out, 'assets/shots', group, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(from, dest);
    const { w, h } = pngSize(await readFile(from));
    gallery.push({ group, src: `assets/shots/${group}/${file}`, caption, w, h });
  }
}

const year = new Date().getFullYear();
const hasOg = existsSync(path.join(src, 'assets/og.png'));
const baseVars = {
  name: cfg.name, short: cfg.short, tagline: cfg.tagline, description: cfg.description,
  siteUrl: cfg.siteUrl, repo: cfg.repo, email: cfg.email, brandName: cfg.brandName, brandUrl: cfg.brandUrl,
  playStoreUrl: cfg.playStoreUrl, appStoreUrl: cfg.appStoreUrl, version: cfg.version, year,
  releasesUrl, issuesUrl: `https://github.com/${cfg.repo}/issues`, repoUrl: `https://github.com/${cfg.repo}`,
  ogImage: `${cfg.siteUrl}assets/${hasOg ? 'og.png' : 'logo-client.png'}`,
};

const headerTpl = await readSrc('partials/header.html');
const footerTpl = await readSrc('partials/footer.html');
const withShell = (root) => {
  const v = { ...baseVars, root, home: root, homeUrl: root || './' };
  return { ...v, header: fill(headerTpl, v), footer: fill(footerTpl, v) };
};

const write = async (rel, html) => {
  const file = path.join(out, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
};

// The landing page
const jsonld = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: cfg.name,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Windows, macOS, Linux, Android',
  description: cfg.description,
  url: cfg.siteUrl,
  license: 'https://opensource.org/licenses/MIT',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Organization', name: cfg.brandName, url: cfg.brandUrl },
};
const clientConfig = { repo: cfg.repo, email: cfg.email, playStoreUrl: cfg.playStoreUrl, appStoreUrl: cfg.appStoreUrl, version: cfg.version };
await write(
  'index.html',
  fill(await readSrc('index.html'), {
    ...withShell(''),
    jsonld: jsonForHtml(jsonld),
    galleryJson: jsonForHtml(gallery),
    configJson: jsonForHtml(clientConfig),
  }),
);

// The Markdown pages
const slug = (s) =>
  s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

const docTpl = await readSrc('docs.html');
for (const d of DOCS) {
  const md = await readFile(path.join(repoRoot, d.src), 'utf8');
  let html = await marked.parse(md);
  const depth = d.url.split('/').filter(Boolean).length;
  const root = '../'.repeat(depth);
  const srcDir = path.posix.dirname(d.src);

  html = html
    .replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (_, l, inner) => `<h${l} id="${slug(inner)}">${inner}</h${l}>`)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/href="([^"]+)"/g, (m, href) => {
      if (/^(https?:|mailto:|#)/.test(href)) return m;
      const [file, hash = ''] = href.split('#');
      const target = LINKS[path.posix.basename(file)];
      if (target) return `href="${root}${target}${hash ? '#' + hash : ''}"`;
      return `href="${blob(path.posix.normalize(path.posix.join(srcDir, file)))}"`;
    });

  const docNav = DOCS.map(
    (x) => `<li><a href="${root}${x.url}"${x.url === d.url ? ' aria-current="page"' : ''}>${esc(x.title)}</a></li>`,
  ).join('');
  await write(
    `${d.url}index.html`,
    fill(docTpl, { ...withShell(root), title: d.title, content: html, docNav, galleryJson: '[]', configJson: jsonForHtml(clientConfig) }),
  );
}

await write(
  '404.html',
  fill(await readSrc('404.html'), { ...withShell(''), configJson: jsonForHtml(clientConfig), galleryJson: '[]' }),
);

// Sitemap and robots.txt
const urls = ['', ...DOCS.map((d) => d.url)];
await write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${cfg.siteUrl}${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}sitemap.xml\n`);

console.log(`Built ${urls.length} pages and ${gallery.length} screenshots into site/_site`);