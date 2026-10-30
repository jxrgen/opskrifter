#!/usr/bin/env node
// Indsamler vegetariske opskrifter fra danske madsider.
// Kører i GitHub Actions (dagligt) og skriver data/recipes.json, som websitet læser.
//
// Princip:
//  1. Find opskrifts-URL'er via sitemaps og vegetar-oversigtssider.
//  2. Hent kun nye/ændrede sider (data/state.json husker hvad der er set).
//  3. Læs struktureret data (schema.org/Recipe som JSON-LD eller microdata).
//  4. Afvis alt med kød, fisk, fjerkræ, skaldyr eller gelatine (lib/ingredients.js).
//  5. Gem titel, kort beskrivelse, ingredienser, tid og link – fremgangsmåden linkes til kilden.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { SOURCES } from './sources.js';
import {
  checkRecipe, checkDairyLine, isoDurationToMinutes, timeBucket, normalize, FILTER_VERSION, cleanTitle,
} from '../lib/ingredients.js';

const UA = 'Mozilla/5.0 (compatible; opskrifter-bot/1.0; +https://github.com/jxrgen/opskrifter)';
const DATA_DIR = new URL('../data/', import.meta.url);
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 45);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const ONLY = process.env.ONLY_SOURCE || '';
const RECHECK = process.env.RECHECK === '1'; // hent alt igen (fx efter ændret filter)
const started = Date.now();
const outOfTime = () => (Date.now() - started) / 60000 > MAX_MINUTES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- HTTP ---------------- */

async function get(url, { tries = 2, binary = false } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'da,en;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 404 || res.status === 410) return { status: res.status, text: '' };
      if (res.status === 429 || res.status >= 500) {
        await sleep(3000 * (i + 1));
        continue;
      }
      if (!res.ok) return { status: res.status, text: '' };
      let text;
      if (binary || url.endsWith('.gz')) {
        const buf = Buffer.from(await res.arrayBuffer());
        text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
      } else text = await res.text();
      return { status: res.status, text, finalUrl: res.url };
    } catch (e) {
      if (i === tries - 1) return { status: 0, text: '', error: e.message };
      await sleep(1500);
    }
  }
  return { status: 0, text: '' };
}

/* ---------------- robots.txt ---------------- */

async function loadRobots(base) {
  const { text } = await get(`${base}/robots.txt`, { tries: 1 });
  const rules = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'sitemap') sitemaps.push(val);
    else if (key === 'user-agent') applies = val === '*' || /opskrifter-bot/i.test(val);
    else if (applies && key === 'disallow' && val) rules.push({ allow: false, path: val });
    else if (applies && key === 'allow' && val) rules.push({ allow: true, path: val });
  }
  const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  const compiled = rules.map((r) => ({ ...r, re: toRe(r.path), len: r.path.length }));
  const allowed = (url) => {
    let path;
    try { path = new URL(url).pathname + new URL(url).search; } catch { return false; }
    let best = null;
    for (const r of compiled) if (r.re.test(path) && (!best || r.len > best.len)) best = r;
    return !best || best.allow;
  };
  return { allowed, sitemaps };
}

/* ---------------- Sitemaps ---------------- */

const SKIP_SITEMAP = /(page-sitemap|category|tag|author|attachment|product|post_tag|wprm_|media|image|video|news|faq|shop|brand|ingredien|cuisine|course|wp-sitemap-users|wp-sitemap-taxonomies|local)/i;
const SKIP_URL = /\/(kategori|category|tag|tags|author|forfatter|side|page|om|kontakt|cookie|privatliv|wp-content|wp-json|feed|soeg|search|shop|butik|nyhedsbrev|konkurrence)\b|\.(jpg|jpeg|png|webp|gif|pdf)$/i;

async function collectSitemap(url, depth = 0, out = new Map()) {
  if (depth > 3 || outOfTime()) return out;
  const { text, status } = await get(url, { tries: 2 });
  if (!text) {
    log(`  sitemap ${url} → ${status}`);
    return out;
  }
  const locs = [...text.matchAll(/<(sitemap|url)>([\s\S]*?)<\/\1>/g)];
  if (text.includes('<sitemapindex')) {
    const subs = locs.map((m) => (m[2].match(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/) || [])[1]).filter(Boolean);
    log(`  sitemap-index ${url}: ${subs.length} under-sitemaps`);
    for (const s of subs) {
      if (SKIP_SITEMAP.test(s)) continue;
      await collectSitemap(decode(s), depth + 1, out);
    }
  } else {
    let n = 0;
    for (const m of locs) {
      const loc = (m[2].match(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/) || [])[1];
      if (!loc) continue;
      const lm = (m[2].match(/<lastmod>(.*?)<\/lastmod>/) || [])[1] || '';
      const u = decode(loc).trim();
      if (SKIP_URL.test(new URL(u).pathname)) continue;
      out.set(u, lm);
      n++;
    }
    log(`  sitemap ${url}: ${n} URL'er`);
  }
  return out;
}

/* ---------------- Oversigtssider (vegetar-kategorier) ---------------- */

async function crawlSeeds(source, robots) {
  const found = new Set();
  const host = new URL(source.base).host;
  for (const seed of source.seeds || []) {
    if (outOfTime()) break;
    let empty = 0;
    for (let page = 1; page <= 80; page++) {
      const url = page === 1 ? seed : `${seed.replace(/\/$/, '')}/page/${page}/`;
      if (!robots.allowed(url)) break;
      const { text, status } = await get(url, { tries: 1 });
      if (!text) {
        if (page === 1) log(`  seed ${seed} → ${status}`);
        break;
      }
      const before = found.size;
      for (const m of text.matchAll(/href="([^"#?]+)"/g)) {
        let u;
        try { u = new URL(decode(m[1]), url); } catch { continue; }
        if (u.host !== host) continue;
        const p = u.pathname;
        if (SKIP_URL.test(p) || p === '/' || p.split('/').filter(Boolean).length > 3) continue;
        if (seedPathsOf(source).some((s) => p.startsWith(s))) continue;
        found.add(u.origin + p);
      }
      const added = found.size - before;
      if (page === 1) log(`  seed ${seed}: ${added} links på side 1`);
      if (added < 3) { if (++empty >= 2) break; } else empty = 0;
      await sleep(400);
    }
  }
  return found;
}

function seedPathsOf(source) {
  return (source.seeds || []).map((s) => new URL(s).pathname);
}

/* ---------------- Udtræk af opskrift ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾',
  aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å', eacute: 'é', egrave: 'è', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', times: '×', uuml: 'ü', ouml: 'ö', auml: 'ä' };

function decode(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n] ?? m);
}

const stripTags = (s) => decode(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipeNode(n); if (r) return r; }
    return null;
  }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  if (node['@graph']) return findRecipeNode(node['@graph']);
  if (node.mainEntity) return findRecipeNode(node.mainEntity);
  return null;
}

// Lister: kategorier/nøgleord må deles ved komma – ingredienser må IKKE ("0,5 tsk", "salt, peber")
function asList(v, split = true) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => asList(x, split));
  if (typeof v === 'object') return [v.name || v.text || v.url || ''].filter(Boolean);
  return split ? String(v).split(/,\s*/).filter(Boolean) : [String(v)];
}

function imageOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return imageOf(v[v.length > 1 ? 1 : 0]) || imageOf(v[0]);
  return v.url || v.contentUrl || '';
}

function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [])[0];
  if (!tag) return '';
  return decode((tag.match(/content=["']([^"']*)["']/i) || [])[1] || '');
}

function yieldNumber(y) {
  const s = Array.isArray(y) ? y.join(' ') : String(y ?? '');
  const m = s.match(/(\d+)/);
  return m ? Math.min(+m[1], 40) : null;
}

function extractRecipe(html, url) {
  // 1) JSON-LD
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch {
      try { data = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; }
    }
    const r = findRecipeNode(data);
    if (!r) continue;
    const ingredients = asList(r.recipeIngredient || r.ingredients, false).map(stripTags).filter(Boolean);
    if (!ingredients.length) continue;
    const minutes = isoDurationToMinutes(r.totalTime)
      || ((isoDurationToMinutes(r.prepTime) || 0) + (isoDurationToMinutes(r.cookTime) || 0)) || null;
    return {
      title: stripTags(r.name) || metaContent(html, 'og:title'),
      description: stripTags(r.description) || metaContent(html, 'og:description') || metaContent(html, 'description'),
      image: imageOf(r.image) || metaContent(html, 'og:image'),
      ingredients,
      minutes,
      servings: yieldNumber(r.recipeYield),
      category: [...asList(r.recipeCategory), ...asList(r.recipeCuisine)].map(stripTags),
      keywords: asList(r.keywords).map(stripTags),
      rating: r.aggregateRating ? Math.round(parseFloat(r.aggregateRating.ratingValue) * 10) / 10 || null : null,
      ratingCount: r.aggregateRating ? parseInt(r.aggregateRating.ratingCount || r.aggregateRating.reviewCount, 10) || null : null,
      published: (r.datePublished || '').slice(0, 10),
    };
  }
  // 2) Microdata
  const ing = [...html.matchAll(/<[^>]+itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/(?:li|span|p|div|td)>/gi)]
    .map((m) => stripTags(m[1])).filter(Boolean);
  if (ing.length) {
    const itemprop = (name) => {
      const tag = (html.match(new RegExp(`<[^>]+itemprop=["']${name}["'][^>]*>`, 'i')) || [])[0] || '';
      return decode((tag.match(/(?:content|datetime)=["']([^"']*)["']/i) || [])[1] || '');
    };
    return {
      title: metaContent(html, 'og:title') || stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]),
      description: metaContent(html, 'og:description') || metaContent(html, 'description'),
      image: metaContent(html, 'og:image'),
      ingredients: ing,
      minutes: isoDurationToMinutes(itemprop('totalTime')) || null,
      servings: yieldNumber(itemprop('recipeYield')),
      category: [],
      keywords: [],
      rating: null,
      ratingCount: null,
      published: (metaContent(html, 'article:published_time') || '').slice(0, 10),
    };
  }
  return null;
}

// Tid i fri tekst, hvis der ikke er struktureret tid ("Tid i alt: 45 min", "Tid: 1 time")
function textTime(html) {
  const text = stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
  const m = text.match(/(?:tid i alt|samlet tid|tilberedningstid|arbejdstid|tid)\s*:?\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(min|minutter|t\b|time|timer)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const mins = /^t/i.test(m[2]) ? n * 60 : n;
  return mins >= 5 && mins <= 24 * 60 ? Math.round(mins) : null;
}

/* ---------------- Kategorisering til websitets filtre ---------------- */

const COURSES = [
  ['aftensmad', /aftensmad|hovedret|middag|gryde|lasagne|pasta|risotto|curry|karry|tærte|pizza|wok|gratin|dahl|chili|burger|tacos?|suppe|bowl/],
  ['frokost', /frokost|madpakke|sandwich|wrap|smørrebrød|tapas|snack|frittata/],
  ['suppe', /suppe/],
  ['salat', /salat/],
  ['tilbehør', /tilbehør|dressing|dip|sauce|pesto|hummus|kartoffel|kartofler|ovnbagt|ovnbagte|coleslaw|pickle|syltet/],
  ['morgenmad', /morgenmad|brunch|grød|granola|pandekage|smoothie|vafler/],
  ['brød', /brød|boller|bagels?|focaccia|foccacia|pizzadej|rugbrød|scones|flutes|hveder|biscuits|horn\b/],
  ['kage & dessert', /kage|dessert|is\b|tærte med|cookie|småkage|muffin|brownie|chokolade|konfekt|trifle|mousse|cheesecake|kringle|snegle|lagkage|risalamande|karamel|fudge|klejner|kranse|snitter|kugler|toppe|trøfler|flødebolle/],
  ['drikke', /drink|cocktail|saft\b|lemonade|smoothie|\bte\b|\bkaffe\b|juice|shake|lassi|mojito|\bgin\b|\brom\b|toddy|kakao\b|latte|gløgg|punch/],
];

function classify(rec) {
  const hay = normalize([rec.title, ...rec.category, ...rec.keywords].join(' | '));
  const courses = COURSES.filter(([, re]) => re.test(hay)).map(([id]) => id);
  return [...new Set(courses)];
}

function hasVegSignal(rec) {
  return /vegetar|vegansk|vegan\b|veggie|kødfri|plantebaseret|grøn aftensmad/.test(normalize([...rec.category, ...rec.keywords, rec.title].join(' ')));
}

function shortDescription(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 220) return s;
  const cut = s.slice(0, 220);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + ' …';
}

function buildRecord(source, url, rec, vegSignal) {
  if (/konkurrence|vind en |\bguide:|sådan (skærer|sier)|fuglefoder|hundekiks|hundegodbid/i.test(rec.title)) return { status: 'norecipe' };
  const check = checkRecipe(rec, vegSignal);
  if (!check.ok) return { status: 'animal', why: check.hits.slice(0, 3).join(', ') || `tvetydig: ${check.ambiguous[0]}` };
  const dairy = rec.ingredients
    .map((line, i) => ({ i, d: checkDairyLine(line) }))
    .filter((x) => x.d)
    .map((x) => ({ i: x.i, sub: x.d.sub }));
  return {
    status: 'ok',
    recipe: {
      id: `${source.id}:${new URL(url).pathname.replace(/^\/|\/$/g, '')}`,
      source: source.id,
      url,
      title: cleanTitle(rec.title),
      description: shortDescription(rec.description),
      image: rec.image || '',
      ingredients: rec.ingredients.slice(0, 60),
      minutes: rec.minutes || null,
      time: timeBucket(rec.minutes),
      servings: rec.servings,
      veg: vegSignal ? 1 : 0,
      courses: classify(rec),
      tags: [...new Set([...rec.category, ...rec.keywords].map((t) => t.toLowerCase()).filter((t) => t && t.length < 40))].slice(0, 12),
      dairy,
      ambiguous: check.ambiguous.length ? check.ambiguous.map((l) => rec.ingredients.indexOf(l)).filter((i) => i >= 0) : undefined,
      rating: rec.rating || undefined,
      ratingCount: rec.ratingCount || undefined,
      published: rec.published || undefined,
    },
  };
}

/* ---------------- Hovedløkke ---------------- */

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA_DIR), 'utf8')); } catch { return fallback; }
}

async function pool(items, n, fn) {
  let idx = 0;
  const workers = Array.from({ length: n }, async () => {
    while (idx < items.length && !outOfTime()) {
      const item = items[idx++];
      await fn(item);
      await sleep(250);
    }
  });
  await Promise.all(workers);
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const state = await readJson('state.json', {});
  const existing = await readJson('recipes.json', []);
  const recipes = new Map(existing.map((r) => [r.url, r]));
  const stats = {};

  for (const source of SOURCES) {
    if (ONLY && source.id !== ONLY) continue;
    if (outOfTime()) break;
    log(`== ${source.name} ==`);
    const st = (stats[source.id] = { candidates: 0, fetched: 0, ok: 0, animal: 0, norecipe: 0, error: 0 });
    const robots = await loadRobots(source.base);

    const vegUrls = await crawlSeeds(source, robots);
    log(`  ${vegUrls.size} URL'er fra vegetar-oversigter`);

    const sitemapList = [...new Set([...robots.sitemaps.filter((s) => s.includes(new URL(source.base).host.replace('www.', ''))), ...source.sitemaps])];
    let sm = new Map();
    for (const s of sitemapList) {
      sm = await collectSitemap(s, 0, sm);
      if (sm.size > 0) break;
    }
    log(`  ${sm.size} URL'er fra sitemap`);

    // Vegetar-sider først, derefter resten af sitemap'et
    const all = [...new Set([...vegUrls, ...sm.keys()])].filter((u) => robots.allowed(u));
    st.candidates = all.length;
    // Rækkefølge: opskrifter der allerede vises (tjekkes igen med nyt filter) → nye → resten
    const prio = (u) => (state[u]?.s === 'ok' ? 0 : !state[u] ? 1 : 2);
    const todo = all.filter((u) => {
      const s = state[u];
      if (RECHECK) return true;
      if (!s) return true;
      if (s.s === 'error' && (s.n || 0) < 3) return true;
      if (sm.get(u) && s.lm && sm.get(u) !== s.lm) return true; // ændret siden sidst
      if (s.s === 'ok' && !recipes.has(u)) return true;
      if (s.s === 'animal' && (s.fv || 1) < FILTER_VERSION) return true; // filteret er ændret siden
      if (s.s === 'ok' && (s.fv || 1) < FILTER_VERSION) return true; // gemt med et ældre filter
      return false;
    }).sort((a, b) => prio(a) - prio(b))
      .slice(0, source.maxNew);
    log(`  ${todo.length} sider skal hentes`);

    await pool(todo, CONCURRENCY, async (url) => {
      const res = await get(url);
      st.fetched++;
      const prev = state[url] || {};
      const base = { lm: sm.get(url) || '', t: new Date().toISOString().slice(0, 10) };
      if (!res.text) {
        state[url] = { ...base, s: res.status === 404 || res.status === 410 ? 'gone' : 'error', n: (prev.n || 0) + 1 };
        if (state[url].s === 'gone') recipes.delete(url);
        st.error++;
        return;
      }
      const rec = extractRecipe(res.text, url);
      if (!rec) {
        state[url] = { ...base, s: 'norecipe' };
        recipes.delete(url);
        st.norecipe++;
        return;
      }
      if (!rec.minutes) rec.minutes = textTime(res.text);
      const r = buildRecord(source, url, rec, vegUrls.has(url) || hasVegSignal(rec));
      state[url] = { ...base, s: r.status, fv: FILTER_VERSION, ...(r.why ? { w: r.why } : {}) };
      if (r.status === 'ok') { recipes.set(url, r.recipe); st.ok++; } else { recipes.delete(url); st.animal++; }
      if (st.fetched % 100 === 0) log(`  … ${st.fetched}/${todo.length} hentet (${st.ok} vegetariske)`);
    });
    log(`  færdig: ${JSON.stringify(st)}`);
    // Gem løbende, så en afbrudt kørsel ikke spilder arbejde
    await save(state, recipes, stats);
  }

  // Kør filteret igen på alt gemt, så strammere regler slår igennem uden at hente igen
  for (const [url, r] of recipes) {
    const check = checkRecipe(r, true);
    if (check.hits.length || /konkurrence|vind en |\bguide:|fuglefoder|hundekiks|hundegodbid/i.test(r.title)) {
      recipes.delete(url);
      if (state[url]) state[url].s = check.hits.length ? 'animal' : 'norecipe';
      continue;
    }
    r.title = cleanTitle(r.title);
    if (r.tags) r.courses = classify({ title: r.title, category: r.tags, keywords: [] });
  }
  await save(state, recipes, stats);
  log(`I alt ${recipes.size} vegetariske opskrifter. Tid: ${((Date.now() - started) / 60000).toFixed(1)} min`);
}

async function save(state, recipes, stats) {
  const list = [...recipes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const bySource = {};
  for (const r of list) bySource[r.source] = (bySource[r.source] || 0) + 1;
  const meta = {
    updated: new Date().toISOString(),
    total: list.length,
    bySource,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, base: s.base })),
    lastRun: stats,
  };
  await writeFile(new URL('recipes.json', DATA_DIR), JSON.stringify(list));
  await writeFile(new URL('meta.json', DATA_DIR), JSON.stringify(meta, null, 1));
  await writeFile(new URL('state.json', DATA_DIR), JSON.stringify(state));
}

// Eksporteres til test
export { extractRecipe, buildRecord, textTime, classify };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
