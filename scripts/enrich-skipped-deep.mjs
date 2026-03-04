import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { load as cheerioLoad } from 'cheerio';

const ROOT = process.cwd();
const REPORT_PATH = process.argv[2];
if (!REPORT_PATH) {
  console.error('Usage: node scripts/enrich-skipped-deep.mjs <report.json>');
  process.exit(1);
}

const CONCURRENCY = process.env.CONCURRENCY ? Math.max(1, Number(process.env.CONCURRENCY)) : 2;
const TIMEOUT_MS = process.env.TIMEOUT_MS ? Number(process.env.TIMEOUT_MS) : 15000;
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const CONTENT_DIR = path.join(ROOT, 'src/content/directory');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LISTINGS_IMG_DIR = path.join(PUBLIC_DIR, 'images/listings');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function safeSlug(id) {
  return id
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `https://${s}`;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'NEIC-GulfIslandsBot/1.0 (+https://gulfislands.com)' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function fetchBinary(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'NEIC-GulfIslandsBot/1.0 (+https://gulfislands.com)' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const ct = res.headers.get('content-type') || '';
    return { buf: Buffer.from(ab), contentType: ct };
  } finally { clearTimeout(t); }
}

function extFromContentType(ct) {
  const s = (ct || '').toLowerCase();
  if (s.includes('image/png')) return 'png';
  if (s.includes('image/svg')) return 'svg';
  if (s.includes('image/webp')) return 'webp';
  if (s.includes('image/jpeg') || s.includes('image/jpg')) return 'jpg';
  if (s.includes('image/gif')) return 'gif';
  return '';
}

function extFromUrl(url) {
  const u = url.split('?')[0].toLowerCase();
  const m = u.match(/\.(png|svg|webp|jpg|jpeg|gif)$/);
  if (!m) return '';
  return m[1] === 'jpeg' ? 'jpg' : m[1];
}

function pickSocialLinksFromDocument($, baseUrl) {
  const out = {};
  const links = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    const h = href.trim();
    if (!h || /^(mailto:|tel:|javascript:)/i.test(h)) return;
    let abs = h;
    try { abs = new URL(h, baseUrl).toString(); } catch {}
    if (!/^https?:/i.test(abs)) return;
    if (/(instagram\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com)/i.test(abs)) links.add(abs);
  });

  const arr = [...links];
  const firstMatch = (re) => arr.find(u => re.test(u));
  out.instagram = firstMatch(/instagram\.com\//i);
  out.facebook = firstMatch(/facebook\.com\//i);
  out.x = firstMatch(/x\.com\//i) || undefined;
  out.twitter = out.x ? undefined : firstMatch(/twitter\.com\//i);
  out.linkedin = firstMatch(/linkedin\.com\//i);
  out.youtube = firstMatch(/(youtube\.com\/|youtu\.be\/)/i);
  out.tiktok = firstMatch(/tiktok\.com\//i);
  out.pinterest = firstMatch(/pinterest\.com\//i);

  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

function pickLogoCandidates($, baseUrl) {
  const candidates = [];
  const rels = [
    'link[rel="apple-touch-icon"]',
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="mask-icon"]',
    'link[rel="logo"]',
  ];
  for (const sel of rels) {
    $(sel).each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      let abs = href;
      try { abs = new URL(href, baseUrl).toString(); } catch {}
      candidates.push({ url: abs, score: 60, reason: sel });
    });
  }

  $('img[src]').each((_, img) => {
    const src = $(img).attr('src') || '';
    const alt = ($(img).attr('alt') || '').toLowerCase();
    let abs = src;
    try { abs = new URL(src, baseUrl).toString(); } catch {}

    let score = 0;
    const s = abs.toLowerCase();
    if (alt.includes('logo')) score += 80;
    if (s.includes('logo')) score += 70;
    if (s.includes('brand')) score += 20;
    if (s.includes('sprite')) score -= 50;
    if (s.includes('favicon')) score += 30;
    if (s.match(/\.(jpg|jpeg)$/)) score -= 15;

    if (score > 30) candidates.push({ url: abs, score, reason: `img alt=${alt}` });
  });

  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    uniq.push(c);
  }
  uniq.sort((a, b) => b.score - a.score);
  return uniq;
}

const SEARCH_DELAY_MS = process.env.SEARCH_DELAY_MS ? Number(process.env.SEARCH_DELAY_MS) : 1200;
const SEARCH_RETRIES = process.env.SEARCH_RETRIES ? Number(process.env.SEARCH_RETRIES) : 5;

async function braveWebSearch(query) {
  const apiKey = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error('Missing BRAVE_API_KEY in env for deep-search mode');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');

  for (let attempt = 1; attempt <= SEARCH_RETRIES; attempt++) {
    // throttle between searches
    await sleep(SEARCH_DELAY_MS);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
          'User-Agent': 'NEIC-GulfIslandsBot/1.0'
        },
        signal: ctrl.signal,
      });

      if (res.status === 429) {
        // exponential backoff
        const backoff = Math.min(30000, 1500 * Math.pow(2, attempt));
        await sleep(backoff);
        continue;
      }

      if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
      const json = await res.json();
      const items = json?.web?.results || [];
      return items.map(r => ({ url: r.url, title: r.title, description: r.description }));
    } finally {
      clearTimeout(t);
    }
  }

  throw new Error('Brave HTTP 429 (rate limited)');
}

function scoreCandidate(url, name) {
  const u = (url || '').toLowerCase();
  const n = (name || '').toLowerCase();
  let s = 0;
  if (!u.startsWith('http')) return -999;
  if (u.includes('facebook.com') || u.includes('instagram.com') || u.includes('x.com') || u.includes('twitter.com')) return -50;
  if (u.includes('tripadvisor') || u.includes('yelp') || u.includes('yellowpages') || u.includes('linkedin.com')) s -= 10;
  if (u.includes('gulfislands.com') || u.includes('saltspring.com')) s -= 15;
  if (u.includes(n.replace(/\s+/g, ''))) s += 10;
  if (u.includes('gov.bc.ca')) s += 5;
  return s;
}

async function enrichFromUrl(file, url) {
  const fullPath = path.join(CONTENT_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data || {};

  const listingUrl = normalizeUrl(url || data.url);
  if (!listingUrl) return { status: 'skip:no-url' };

  let html;
  try {
    html = await fetchText(listingUrl);
  } catch (e) {
    return { status: 'skip:dead-url', error: String(e) };
  }

  const $ = cheerioLoad(html);
  const social = pickSocialLinksFromDocument($, listingUrl);
  if (Object.keys(social).length) social.website = listingUrl;

  const logoCandidates = pickLogoCandidates($, listingUrl);
  let logoRelPath = data.logo || '';
  let logoSaved = false;

  if (FORCE || !data.logo) {
    const best = logoCandidates[0];
    if (best?.url) {
      try {
        const { buf, contentType } = await fetchBinary(best.url);
        const ext = extFromContentType(contentType) || extFromUrl(best.url) || 'png';
        const finalExt = ['png', 'svg', 'webp', 'gif', 'jpg'].includes(ext) ? ext : 'png';
        const outDir = path.join(LISTINGS_IMG_DIR, safeSlug(file));
        const outPath = path.join(outDir, `logo.${finalExt}`);
        const rel = `/images/listings/${safeSlug(file)}/logo.${finalExt}`;
        if (!DRY_RUN) {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(outPath, buf);
        }
        logoRelPath = rel;
        logoSaved = true;
      } catch {}
    }
  }

  const nextData = { ...data };
  if (FORCE || !data.url) nextData.url = listingUrl;
  if ((FORCE || !data.logo) && logoRelPath) nextData.logo = logoRelPath;
  if (FORCE || !data.social || !Object.keys(data.social).length) {
    if (Object.keys(social).length) nextData.social = { ...(nextData.social || {}), ...social };
  } else if (FORCE) {
    if (Object.keys(social).length) nextData.social = { ...(nextData.social || {}), ...social };
  }

  const newRaw = matter.stringify(parsed.content, nextData);
  if (!DRY_RUN) fs.writeFileSync(fullPath, newRaw);

  return { status: 'updated', logoSaved, socialCount: nextData.social ? Object.keys(nextData.social).length : 0 };
}

async function deepSearchAndEnrich(file) {
  const fullPath = path.join(CONTENT_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const { data } = matter(raw);

  const name = data?.name || file;
  const island = data?.island || '';

  // If url exists, just try enrich from it again with FORCE.
  if (data?.url) {
    return await enrichFromUrl(file, data.url);
  }

  // Deep search for a likely official website.
  const q = `${name} ${island} official website`;
  let results = [];
  try {
    results = await braveWebSearch(q);
  } catch (e) {
    return { status: 'error:search', error: String(e) };
  }

  // pick best candidate
  const best = results
    .map(r => ({ ...r, score: scoreCandidate(r.url, name) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best?.url) return { status: 'skip:search-no-hit' };

  // attempt enrich using that URL
  const res = await enrichFromUrl(file, best.url);
  return { ...res, foundUrl: best.url, foundTitle: best.title };
}

async function run() {
  const report = JSON.parse(fs.readFileSync(path.resolve(REPORT_PATH), 'utf8'));
  const skipped = (report.results || []).filter(r => r.status?.startsWith('skip:'));
  const files = skipped.map(r => r.file);

  const out = {
    startedAt: new Date().toISOString(),
    sourceReport: REPORT_PATH,
    force: FORCE,
    dryRun: DRY_RUN,
    concurrency: CONCURRENCY,
    results: [],
    counts: {},
  };

  let idx = 0;
  const active = new Set();

  async function worker(file) {
    // general jitter; search function also throttles itself
    await sleep(300 + Math.random() * 500);
    const res = await deepSearchAndEnrich(file);
    const row = { file, ...res };
    out.results.push(row);
    out.counts[row.status] = (out.counts[row.status] || 0) + 1;
  }

  async function spawnOne() {
    if (idx >= files.length) return;
    const file = files[idx++];
    const p = (async () => {
      try { await worker(file); }
      finally { active.delete(p); }
    })();
    active.add(p);
  }

  while (idx < files.length) {
    while (active.size < CONCURRENCY && idx < files.length) await spawnOne();
    if (active.size === 0) break;
    await Promise.race(active);
  }
  await Promise.allSettled([...active]);

  out.finishedAt = new Date().toISOString();
  const outPath = path.join(ROOT, 'scripts', `deep-enrich-report-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  const summary = Object.entries(out.counts).map(([k,v]) => `${k}: ${v}`).join(', ');
  console.log(`Done. ${summary}`);
  console.log(`Report: ${outPath}`);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
