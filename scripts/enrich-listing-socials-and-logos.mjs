import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { load as cheerioLoad } from 'cheerio';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src/content/directory');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LISTINGS_IMG_DIR = path.join(PUBLIC_DIR, 'images/listings');

const MAX_LISTINGS = process.env.MAX_LISTINGS ? Number(process.env.MAX_LISTINGS) : Infinity;
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const CONCURRENCY = process.env.CONCURRENCY ? Math.max(1, Number(process.env.CONCURRENCY)) : 3;
const TIMEOUT_MS = process.env.TIMEOUT_MS ? Number(process.env.TIMEOUT_MS) : 15000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
  // tolerate `www.` etc
  return `https://${s}`;
}

function pickSocialLinksFromDocument($, baseUrl) {
  const out = {};
  const links = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    const h = href.trim();
    if (!h) return;
    // Skip mail/tel
    if (/^(mailto:|tel:|javascript:)/i.test(h)) return;

    // Resolve relative
    let abs = h;
    try {
      abs = new URL(h, baseUrl).toString();
    } catch {}

    if (!/^https?:/i.test(abs)) return;
    if (/(instagram\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com)/i.test(abs)) {
      links.add(abs);
    }
  });

  const arr = [...links];

  const firstMatch = (re) => arr.find(u => re.test(u));
  out.instagram = firstMatch(/instagram\.com\//i);
  out.facebook = firstMatch(/facebook\.com\//i);
  // prefer x.com over twitter.com
  out.x = firstMatch(/x\.com\//i) || undefined;
  out.twitter = out.x ? undefined : firstMatch(/twitter\.com\//i);
  out.linkedin = firstMatch(/linkedin\.com\//i);
  out.youtube = firstMatch(/(youtube\.com\/|youtu\.be\/)/i);
  out.tiktok = firstMatch(/tiktok\.com\//i);
  out.pinterest = firstMatch(/pinterest\.com\//i);

  // Remove empties
  for (const k of Object.keys(out)) {
    if (!out[k]) delete out[k];
  }

  return out;
}

function pickLogoCandidates($, baseUrl) {
  const candidates = [];

  // Prefer explicit site icons/logos
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

  // Then images that look like logo
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
    if (s.includes('header')) score += 10;
    if (s.includes('sprite')) score -= 50;
    if (s.includes('icon')) score += 10;
    if (s.includes('favicon')) score += 30;

    // deprioritize huge photos
    if (s.match(/\.(jpg|jpeg)$/)) score -= 15;

    if (score > 30) {
      candidates.push({ url: abs, score, reason: `img alt="${alt}"` });
    }
  });

  // Dedup by URL
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

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'NEIC-GulfIslandsBot/1.0 (+https://gulfislands.com)'
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) {
      // still allow some HTML-ish
      if (!ct.includes('text/') && !ct.includes('xml')) throw new Error(`non-html content-type: ${ct}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchBinary(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'NEIC-GulfIslandsBot/1.0 (+https://gulfislands.com)'
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const ct = res.headers.get('content-type') || '';
    return { buf: Buffer.from(ab), contentType: ct };
  } finally {
    clearTimeout(t);
  }
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

async function processListing(file) {
  const fullPath = path.join(CONTENT_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data || {};

  const listingUrl = normalizeUrl(data.url);
  const slug = safeSlug(file);

  const alreadyHasLogo = Boolean(data.logo);
  const alreadyHasSocial = Boolean(data.social && Object.keys(data.social).length);

  if (!listingUrl) {
    return { file, slug, status: 'skip:no-url' };
  }

  if (!FORCE && alreadyHasLogo && alreadyHasSocial) {
    return { file, slug, status: 'skip:already-enriched' };
  }

  let html;
  try {
    html = await fetchText(listingUrl);
  } catch (e) {
    return { file, slug, status: 'skip:dead-url', error: String(e) };
  }

  const $ = cheerioLoad(html);

  const social = pickSocialLinksFromDocument($, listingUrl);
  if (Object.keys(social).length) {
    social.website = listingUrl;
  }

  const logoCandidates = pickLogoCandidates($, listingUrl);

  let logoRelPath = data.logo || '';
  let logoSaved = false;

  if (!alreadyHasLogo || FORCE) {
    const best = logoCandidates[0];
    if (best?.url) {
      try {
        const { buf, contentType } = await fetchBinary(best.url);
        const ext = extFromContentType(contentType) || extFromUrl(best.url) || 'png';
        const outDir = path.join(LISTINGS_IMG_DIR, slug);
        const outName = `logo.${ext === 'jpg' ? 'png' : ext}`;
        // If jpg, we still save as jpg? JP said png ok; but keep ext if png/svg/webp, else default png.
        const finalExt = (ext === 'png' || ext === 'svg' || ext === 'webp' || ext === 'gif' || ext === 'jpg') ? ext : 'png';
        const finalName = `logo.${finalExt}`;
        const outPath = path.join(outDir, finalName);
        const rel = `/images/listings/${slug}/${finalName}`;

        if (!DRY_RUN) {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(outPath, buf);
        }
        logoRelPath = rel;
        logoSaved = true;
      } catch (e) {
        // ignore logo failure
      }
    }
  }

  // Merge data
  const nextData = { ...data };

  if (!alreadyHasLogo || FORCE) {
    if (logoRelPath) nextData.logo = logoRelPath;
  }

  if (!alreadyHasSocial || FORCE) {
    if (Object.keys(social).length) {
      nextData.social = { ...(nextData.social || {}), ...social };
    }
  }

  const newRaw = matter.stringify(parsed.content, nextData);
  if (!DRY_RUN) fs.writeFileSync(fullPath, newRaw);

  const wrote = (!alreadyHasLogo && !!nextData.logo) || (!alreadyHasSocial && !!nextData.social) || FORCE;

  return {
    file,
    slug,
    status: wrote ? 'updated' : 'no-change',
    logoSaved,
    socialCount: nextData.social ? Object.keys(nextData.social).length : 0,
  };
}

async function run() {
  fs.mkdirSync(LISTINGS_IMG_DIR, { recursive: true });

  const files = fs.readdirSync(CONTENT_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  const report = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    force: FORCE,
    maxListings: MAX_LISTINGS,
    concurrency: CONCURRENCY,
    timeoutMs: TIMEOUT_MS,
    results: [],
    counts: {},
  };

  let idx = 0;
  async function worker(file) {
    // small jitter to avoid thundering herd
    await sleep(150 + Math.random() * 250);
    const res = await processListing(file);
    report.results.push(res);
    report.counts[res.status] = (report.counts[res.status] || 0) + 1;
  }

  // Concurrency loop
  const active = new Set();

  async function spawnOne() {
    if (idx >= files.length) return;
    if (report.results.length + active.size >= MAX_LISTINGS) return;
    const file = files[idx++];
    const p = (async () => {
      try {
        await worker(file);
      } finally {
        active.delete(p);
      }
    })();
    active.add(p);
  }

  while (idx < files.length && report.results.length < MAX_LISTINGS) {
    while (active.size < CONCURRENCY && idx < files.length && report.results.length + active.size < MAX_LISTINGS) {
      await spawnOne();
    }
    if (active.size === 0) break;
    await Promise.race(active);
  }
  await Promise.allSettled([...active]);

  report.finishedAt = new Date().toISOString();

  const outPath = path.join(ROOT, 'scripts', `enrich-report-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const summary = Object.entries(report.counts).map(([k,v]) => `${k}: ${v}`).join(', ');
  console.log(`Done. ${summary}`);
  console.log(`Report: ${outPath}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
