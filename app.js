import {
  scaleIngredient, parseIngredient, ingredientKey, formatQty, normalize, TIME_BUCKETS,
} from './lib/ingredients.js';

/* ================================================================== *
 *  Tilstand
 * ================================================================== */

const COURSE_LABELS = {
  aftensmad: 'Aftensmad', frokost: 'Frokost', suppe: 'Suppe', salat: 'Salat', tilbehør: 'Tilbehør',
  morgenmad: 'Morgenmad', brød: 'Brød', 'kage & dessert': 'Kage & dessert', drikke: 'Drikke',
};
const DEFAULTS = {
  count: 3, time: 'any', includeUnknownTime: true, dairy: 'prefer', showSubs: true,
  courses: ['aftensmad'], sources: null, include: '', exclude: '', servings: 4,
  fresh: true, popular: false, weekplan: false, images: true, onlyVeg: true,
  pantry: 'salt, peber, vand, olivenolie, olie, rapsolie',
  theme: 'auto', fontScale: 1,
};
const KEY = 'opskrifter.';
const store = {
  get(k, f) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* privat tilstand */ } },
};

const S = { ...DEFAULTS, ...store.get('settings', {}) };
let ALL = [];
let BY_ID = new Map();
let META = null;
let view = 'forslag';
let shown = store.get('shown', []); // [{ id, locked }]
const favorites = new Set(store.get('favorites', []));
let seen = store.get('seen', []);
const have = new Set(store.get('have', [])); // "id|index" – har jeg allerede
const outOfList = new Set(store.get('outOfList', [])); // opskrift-id'er fravalgt indkøbslisten
const doneItems = new Set();

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function save() {
  store.set('settings', S);
  store.set('shown', shown);
  store.set('favorites', [...favorites]);
  store.set('seen', seen.slice(-3000));
  store.set('have', [...have]);
  store.set('outOfList', [...outOfList]);
}

/* ================================================================== *
 *  Data
 * ================================================================== */

async function load() {
  $('#cards').innerHTML = '<li class="skeleton"></li><li class="skeleton"></li>';
  try {
    const [r, m] = await Promise.all([
      fetch('data/recipes.json', { cache: 'no-cache' }),
      fetch('data/meta.json', { cache: 'no-cache' }),
    ]);
    ALL = r.ok ? await r.json() : [];
    META = m.ok ? await m.json() : null;
  } catch {
    ALL = [];
  }
  BY_ID = new Map(ALL.map((x) => [x.id, x]));
  HAS_VEG_DATA = ALL.some((x) => 'veg' in x);
  $('#cards').innerHTML = '';
  if (!ALL.length) {
    status('Opskrifterne er ved at blive hentet for første gang. Kom tilbage om lidt – det tager typisk 10–20 minutter.');
    return;
  }
  renderSourceOptions();
  renderCourseOptions();
  renderMeta();
  updatePool();

  // Delt link: #vis=id1,id2&pers=4
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('vis')) {
    const ids = hash.get('vis').split(',').map(decodeURIComponent).filter((id) => BY_ID.has(id));
    if (ids.length) {
      shown = ids.map((id) => ({ id, locked: false }));
      if (hash.get('pers')) S.servings = Math.max(1, +hash.get('pers') || 4);
      syncForm();
      history.replaceState(null, '', location.pathname);
    }
  }
  shown = shown.filter((s) => BY_ID.has(s.id));
  if (!shown.length) pick();
  render();
}

function renderMeta() {
  if (!META) return;
  const names = Object.fromEntries((META.sources || []).map((s) => [s.id, s.name]));
  const parts = Object.entries(META.bySource || {}).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${names[id] || id} (${n})`);
  const d = new Date(META.updated);
  $('#meta-line').textContent = `${META.total} vegetariske opskrifter fra ${parts.join(', ')}. Opdateret ${d.toLocaleDateString('da-DK', { day: 'numeric', month: 'long' })} kl. ${d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}.`;
}

/* ================================================================== *
 *  Filtrering og udvælgelse
 * ================================================================== */

const terms = (s) => String(s || '').split(',').map((t) => normalize(t)).filter(Boolean);

let HAS_VEG_DATA = false;

function matches(r, { ignoreSeen = false } = {}) {
  if (S.onlyVeg && HAS_VEG_DATA && r.veg !== 1) return false;
  if (S.sources && !S.sources.includes(r.source)) return false;
  if (S.time !== 'any') {
    if (r.time ? r.time !== S.time : !S.includeUnknownTime) return false;
  }
  if (S.dairy === 'exclude' && r.dairy?.length) return false;
  if (S.courses.length && !S.courses.some((c) => r.courses?.includes(c))) return false;
  if (S.popular && !(r.rating >= 4 && (r.ratingCount || 0) >= 10)) return false;
  const hay = normalize(`${r.title} ${r.ingredients.join(' ')}`);
  const inc = terms(S.include);
  if (inc.length && !inc.some((t) => hay.includes(t))) return false;
  const exc = terms(S.exclude);
  if (exc.length && exc.some((t) => normalize(r.ingredients.join(' ')).includes(t))) return false;
  if (!ignoreSeen && S.fresh && seenSet().has(r.id)) return false;
  return true;
}

let _seenSet = null;
function seenSet() { return (_seenSet ||= new Set(seen)); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Rangér: uden mejeri først (ved "helst uden"), ellers tilfældigt. */
function rank(list) {
  const shuffled = shuffle(list.slice());
  if (S.dairy !== 'prefer') return shuffled;
  return shuffled.sort((a, b) => (a.dairy?.length || 0) - (b.dairy?.length || 0));
}

function candidates(excludeIds) {
  let pool = ALL.filter((r) => !excludeIds.has(r.id) && matches(r));
  if (!pool.length && S.fresh) {
    // Alle er set – nulstil historikken for dette filter
    const ids = new Set(ALL.filter((r) => matches(r, { ignoreSeen: true })).map((r) => r.id));
    seen = seen.filter((id) => !ids.has(id));
    _seenSet = null;
    pool = ALL.filter((r) => !excludeIds.has(r.id) && matches(r));
    if (pool.length) toast('Du har set alle opskrifter med disse indstillinger – starter forfra.');
  }
  return rank(pool);
}

function markSeen(ids) {
  seen.push(...ids);
  _seenSet = null;
}

function pick() {
  const n = Math.max(1, Math.min(50, +S.count || 1));
  const locked = shown.filter((s) => s.locked && BY_ID.has(s.id));
  const exclude = new Set(locked.map((s) => s.id));
  const need = Math.max(0, n - locked.length);
  let fresh = candidates(exclude).slice(0, need);
  if (fresh.length < need && S.fresh) {
    // Fyld op med opskrifter du har set før, hvis der ikke er nok nye
    const taken = new Set([...exclude, ...fresh.map((r) => r.id)]);
    const old = rank(ALL.filter((r) => !taken.has(r.id) && matches(r, { ignoreSeen: true })));
    fresh = [...fresh, ...old.slice(0, need - fresh.length)];
  }
  shown = [...locked, ...fresh.map((r) => ({ id: r.id, locked: false }))];
  markSeen(fresh.map((r) => r.id));
  save();
  if (!shown.length) status('Ingen opskrifter passer til dine indstillinger. Prøv at slække lidt på filtrene – fx tid, måltid eller ingredienser.');
  else if (fresh.length + locked.length < n) status(`Der var kun ${shown.length} opskrift${shown.length === 1 ? '' : 'er'}, der passede til dine indstillinger.`);
  else status('');
}

function swap(id) {
  const exclude = new Set(shown.map((s) => s.id));
  const next = candidates(exclude)[0];
  if (!next) return toast('Ikke flere opskrifter med disse indstillinger.');
  shown = shown.map((s) => (s.id === id ? { id: next.id, locked: false } : s));
  markSeen([next.id]);
  save();
  render();
}

function updatePool() {
  const n = ALL.filter((r) => matches(r, { ignoreSeen: true })).length;
  const fresh = S.fresh ? ALL.filter((r) => matches(r)).length : n;
  $('#pool').textContent = `${n} opskrifter passer${S.fresh && fresh !== n ? ` (${fresh} du ikke har set)` : ''}.`;
}

/* ================================================================== *
 *  Visning
 * ================================================================== */

function status(msg) { $('#status').textContent = msg; }

function currentList() {
  if (view === 'favoritter') return [...favorites].filter((id) => BY_ID.has(id)).map((id) => ({ id, locked: false }));
  return shown;
}

// Tvetydig "bouillon"/"fond" vises altid som grøntsagsvarianten
const vegify = (line) => line.replace(/\b(hønse|kylling|okse)?(bouillon|fond)/i, 'grøntsags$2');
const lineOf = (r, i) => ((r.ambiguous || []).includes(i) ? vegify(r.ingredients[i]) : r.ingredients[i]);
const isGroup = (line) => /:\s*$/.test(line) && line.length < 60;
const factorFor = (r) => (r.servings ? S.servings / r.servings : 1);
const DAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

function render() {
  const list = currentList();
  const cards = $('#cards');
  cards.innerHTML = '';
  if (view === 'favoritter' && !list.length) status('Du har ingen favoritter endnu. Tryk ♡ på en opskrift for at gemme den her.');
  else if (view === 'favoritter') status('');
  const sourceName = Object.fromEntries((META?.sources || []).map((s) => [s.id, s.name]));
  const today = new Date().getDay();

  list.forEach((s, idx) => {
    const r = BY_ID.get(s.id);
    if (!r) return;
    const factor = factorFor(r);
    const dairySubs = new Map((r.dairy || []).map((d) => [d.i, d.sub]));
    const amb = new Set(r.ambiguous || []);
    const tb = TIME_BUCKETS.find((b) => b.id === r.time);
    const fav = favorites.has(r.id);
    const inList = !outOfList.has(r.id);
    const day = S.weekplan && view === 'forslag' ? DAYS[(today + idx) % 7] : '';

    const ings = r.ingredients.map((line, i) => {
      if (isGroup(line)) return `<li class="group">${esc(line)}</li>`;
      const k = `${r.id}|${i}`;
      const txt = scaleIngredient(lineOf(r, i), factor);
      const isDairy = dairySubs.has(i);
      return `<li class="${have.has(k) ? 'have' : ''}"><label>
        <input type="checkbox" data-have="${esc(k)}" ${have.has(k) ? 'checked' : ''} aria-label="Har jeg: ${esc(txt)}">
        <span class="txt">${isDairy ? '<span class="dairy-mark" title="Mælkeprodukt">●</span> ' : ''}${esc(txt)}
        ${isDairy && S.showSubs ? `<span class="sub">→ prøv: ${esc(dairySubs.get(i))}</span>` : ''}
        ${amb.has(i) ? '<span class="note">Kilden skriver blot "' + esc(line) + '"</span>' : ''}</span>
      </label></li>`;
    }).join('');

    const badges = [
      `<span class="badge">${esc(sourceName[r.source] || r.source)}</span>`,
      r.veg === 1 ? '<span class="badge good">Vegetar ifølge kilden</span>' : '',
      r.minutes ? `<span class="badge">⏱ ${fmtMin(r.minutes)}${tb ? ` · ${tb.label}` : ''}</span>` : '<span class="badge">⏱ tid ikke angivet</span>',
      r.dairy?.length
        ? `<span class="badge warn">Mælkeprodukter (${r.dairy.length})${S.showSubs ? ' – kan erstattes' : ''}</span>`
        : '<span class="badge good">Uden mælkeprodukter</span>',
      r.rating ? `<span class="badge">★ ${String(r.rating).replace('.', ',')}${r.ratingCount ? ` (${r.ratingCount})` : ''}</span>` : '',
    ].join('');

    const li = document.createElement('li');
    li.className = `card${s.locked ? ' locked' : ''}`;
    li.dataset.id = r.id;
    li.innerHTML = `
      ${S.images && r.image ? `<div class="card-img">${day ? `<span class="day">${day}</span>` : ''}<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="card-body">
        ${day && !(S.images && r.image) ? `<span class="day">${day}</span>` : ''}
        <h3><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></h3>
        <div class="badges">${badges}</div>
        ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
        <div class="ing-head">
          <h4>Ingredienser${r.servings ? ` · ${S.servings} pers.` : ''}</h4>
          <p class="help">${r.servings && factor !== 1 ? `Omregnet fra ${r.servings} pers.` : 'Sæt flueben ved det du har'}</p>
        </div>
        <ul class="ings">${ings}</ul>
        <label class="inlist"><input type="checkbox" data-inlist="${esc(r.id)}" ${inList ? 'checked' : ''}> Med på indkøbslisten</label>
        <div class="card-actions">
          <a class="go" href="${esc(r.url)}" target="_blank" rel="noopener">Se fremgangsmåde ↗</a>
          <button type="button" data-fav="${esc(r.id)}" aria-pressed="${fav}">${fav ? '♥ Favorit' : '♡ Gem'}</button>
          ${view === 'forslag' ? `
            <button type="button" data-lock="${esc(r.id)}" aria-pressed="${s.locked}" title="Behold denne, når du finder nye">${s.locked ? '🔒 Beholdes' : '🔓 Behold'}</button>
            <button type="button" data-swap="${esc(r.id)}" title="Byt kun denne opskrift">↻ Byt</button>` : ''}
          <button type="button" data-copy="${esc(r.id)}">Kopiér ingredienser</button>
        </div>
      </div>`;
    cards.appendChild(li);
  });
  renderShopping();
  $('#fav-count').textContent = favorites.size;
}

function fmtMin(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} t ${r} min` : `${h} t`;
}

/* ================================================================== *
 *  Indkøbsliste
 * ================================================================== */

function pantryTerms() { return terms(S.pantry); }

function isPantry(key) {
  const pt = pantryTerms();
  const parts = key.split(/ og | & |\/|,/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => pt.some((t) => p === t || p.endsWith(` ${t}`) || (t.length > 3 && p.endsWith(t))));
}

function buildShopping() {
  const groups = new Map();
  for (const s of currentList()) {
    const r = BY_ID.get(s.id);
    if (!r || outOfList.has(r.id)) continue;
    const factor = factorFor(r);
    r.ingredients.forEach((line, i) => {
      if (isGroup(line) || have.has(`${r.id}|${i}`)) return;
      const scaled = scaleIngredient(lineOf(r, i), factor);
      const p = parseIngredient(scaled);
      const key = ingredientKey(scaled) || normalize(scaled);
      if (!groups.has(key)) groups.set(key, { key, items: [], recipes: new Set() });
      const g = groups.get(key);
      g.items.push(p);
      g.recipes.add(r.title);
    });
  }
  const out = [];
  for (const g of groups.values()) {
    let text;
    if (g.items.length === 1) text = g.items[0].raw;
    else {
      const units = new Set(g.items.map((p) => p.unit));
      if (g.items.every((p) => p.qty !== null) && units.size === 1) {
        const sum = g.items.reduce((a, p) => a + p.qty, 0);
        text = [formatQty(sum), [...units][0], g.key].filter(Boolean).join(' ');
      } else {
        text = `${g.key}: ${g.items.map((p) => [p.qty !== null ? formatQty(p.qty) : '', p.unit].filter(Boolean).join(' ') || 'lidt').join(' + ')}`;
      }
    }
    out.push({ key: g.key, text, pantry: isPantry(g.key), from: [...g.recipes] });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, 'da'));
}

function renderShopping() {
  const list = buildShopping();
  const showPantry = $('#show-pantry').checked;
  const visible = list.filter((x) => showPantry || !x.pantry);
  $('#shopping').hidden = !currentList().length;
  $('#shopping-list').innerHTML = visible.map((x) => `
    <li class="${x.pantry ? 'pantry' : ''} ${doneItems.has(x.key) ? 'done' : ''}">
      <input type="checkbox" data-done="${esc(x.key)}" ${doneItems.has(x.key) ? 'checked' : ''} aria-label="Lagt i kurven: ${esc(x.text)}">
      <span class="txt">${esc(x.text)}${x.from.length > 1 ? `<span class="from">${x.from.length} opskrifter</span>` : ''}</span>
    </li>`).join('') || '<li>Intet at købe – du har det hele 🎉</li>';
  const n = visible.filter((x) => !doneItems.has(x.key)).length;
  $('#fab-n').textContent = n;
  $('#fab').hidden = !n;
}

function shoppingText({ bullets = false, header = false } = {}) {
  const showPantry = $('#show-pantry').checked;
  const items = buildShopping().filter((x) => (showPantry || !x.pantry) && !doneItems.has(x.key)).map((x) => x.text);
  const lines = items.map((t) => (bullets ? `- ${t}` : t));
  if (!header) return lines.join('\n');
  const titles = currentList().map((s) => BY_ID.get(s.id)).filter((r) => r && !outOfList.has(r.id));
  return [
    `Indkøbsliste (${S.servings} pers.)`, '',
    ...lines, '',
    'Opskrifter:', ...titles.map((r) => `${r.title}: ${r.url}`),
  ].join('\n');
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function shareLink() {
  const ids = currentList().map((s) => encodeURIComponent(s.id)).join(',');
  return `${location.origin}${location.pathname}#vis=${ids}&pers=${S.servings}`;
}

/* ================================================================== *
 *  Formular <-> indstillinger
 * ================================================================== */

function renderSourceOptions() {
  const counts = {};
  for (const r of ALL) counts[r.source] = (counts[r.source] || 0) + 1;
  const srcs = (META?.sources || []).filter((s) => counts[s.id]);
  $('#sources').innerHTML = srcs.map((s) => `
    <label class="check"><input type="checkbox" name="source" value="${esc(s.id)}" ${!S.sources || S.sources.includes(s.id) ? 'checked' : ''}>
    ${esc(s.name)} <span class="count">${counts[s.id]}</span></label>`).join('');
}

function renderCourseOptions() {
  const counts = {};
  for (const r of ALL) for (const c of r.courses || []) counts[c] = (counts[c] || 0) + 1;
  $('#courses').innerHTML = Object.entries(COURSE_LABELS).filter(([id]) => counts[id]).map(([id, label]) =>
    `<button type="button" data-course="${esc(id)}" aria-pressed="${S.courses.includes(id)}">${esc(label)}</button>`).join('');
}

function syncForm() {
  const f = $('#settings');
  f.count.value = S.count;
  $$('#count-quick button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.count === +S.count)));
  $$('input[name="time"]', f).forEach((i) => { i.checked = i.value === S.time; });
  $$('input[name="dairy"]', f).forEach((i) => { i.checked = i.value === S.dairy; });
  for (const k of ['includeUnknownTime', 'showSubs', 'fresh', 'popular', 'weekplan', 'images', 'onlyVeg']) f[k].checked = !!S[k];
  f.include.value = S.include;
  f.exclude.value = S.exclude;
  f.servings.value = S.servings;
  f.pantry.value = S.pantry;
}

function readForm() {
  const f = $('#settings');
  S.count = Math.max(1, Math.min(50, parseInt(f.count.value, 10) || 1));
  S.time = ($('input[name="time"]:checked', f) || {}).value || 'any';
  S.dairy = ($('input[name="dairy"]:checked', f) || {}).value || 'prefer';
  for (const k of ['includeUnknownTime', 'showSubs', 'fresh', 'popular', 'weekplan', 'images', 'onlyVeg']) S[k] = f[k].checked;
  S.include = f.include.value;
  S.exclude = f.exclude.value;
  S.servings = Math.max(1, Math.min(30, parseInt(f.servings.value, 10) || 4));
  S.pantry = f.pantry.value;
  const srcBoxes = $$('input[name="source"]', f);
  if (srcBoxes.length) {
    const on = srcBoxes.filter((b) => b.checked).map((b) => b.value);
    S.sources = on.length === srcBoxes.length ? null : on;
  }
  $$('#count-quick button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.count === +S.count)));
  save();
  updatePool();
}

/* ================================================================== *
 *  Hændelser
 * ================================================================== */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function bind() {
  const f = $('#settings');
  f.addEventListener('submit', (e) => e.preventDefault());
  f.addEventListener('input', (e) => {
    readForm();
    // Visnings-indstillinger slår igennem med det samme; filtre først ved "Find opskrifter"
    if (['servings', 'showSubs', 'weekplan', 'images', 'pantry'].includes(e.target.name)) render();
  });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'time' && e.target.value !== 'any') {
      // Ved valgt tid giver det mest mening kun at vise opskrifter med kendt tid
      f.includeUnknownTime.checked = false;
      readForm();
    }
  });
  $('#count-quick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    f.count.value = b.dataset.count;
    readForm();
  });
  $('#courses').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const c = b.dataset.course;
    S.courses = S.courses.includes(c) ? S.courses.filter((x) => x !== c) : [...S.courses, c];
    b.setAttribute('aria-pressed', String(S.courses.includes(c)));
    save();
    updatePool();
  });
  $('#serv-down').addEventListener('click', () => { f.servings.value = Math.max(1, S.servings - 1); readForm(); render(); });
  $('#serv-up').addEventListener('click', () => { f.servings.value = Math.min(30, S.servings + 1); readForm(); render(); });

  $('#go').addEventListener('click', () => {
    if (view !== 'forslag') setView('forslag');
    readForm();
    pick();
    render();
    if (window.matchMedia('(max-width: 900px)').matches) {
      $('#settings-details').open = false;
      $('#resultater').scrollIntoView();
    }
  });

  $('#cards').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fav) {
      const id = b.dataset.fav;
      favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      save();
      render();
    } else if (b.dataset.lock) {
      shown = shown.map((s) => (s.id === b.dataset.lock ? { ...s, locked: !s.locked } : s));
      save();
      render();
    } else if (b.dataset.swap) {
      swap(b.dataset.swap);
    } else if (b.dataset.copy) {
      const r = BY_ID.get(b.dataset.copy);
      const f2 = factorFor(r);
      const txt = r.ingredients.map((l, i) => (isGroup(l) ? null : scaleIngredient(lineOf(r, i), f2))).filter(Boolean).join('\n');
      if (await copy(txt)) toast('Ingredienserne er kopieret.');
    }
  });
  $('#cards').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.have) {
      t.checked ? have.add(t.dataset.have) : have.delete(t.dataset.have);
      t.closest('li').classList.toggle('have', t.checked);
      save();
      renderShopping();
    } else if (t.dataset.inlist) {
      t.checked ? outOfList.delete(t.dataset.inlist) : outOfList.add(t.dataset.inlist);
      save();
      renderShopping();
    }
  });

  $('#shopping-list').addEventListener('change', (e) => {
    const k = e.target.dataset.done;
    if (!k) return;
    e.target.checked ? doneItems.add(k) : doneItems.delete(k);
    renderShopping();
  });
  $('#show-pantry').addEventListener('change', renderShopping);

  if (navigator.share) {
    $('#exp-share').hidden = false;
    $('#exp-share').addEventListener('click', async () => {
      try { await navigator.share({ title: 'Indkøbsliste', text: shoppingText() }); } catch { /* annulleret */ }
    });
  }
  $('#exp-keep').addEventListener('click', async () => {
    const ok = await copy(shoppingText());
    toast(ok ? 'Listen er kopieret – opret en ny liste i Keep og sæt ind.' : 'Kunne ikke kopiere – prøv "Hent som .txt".');
    window.open('https://keep.google.com/', '_blank', 'noopener');
  });
  $('#exp-copy').addEventListener('click', async () => {
    if (await copy(shoppingText({ header: true }))) toast('Indkøbslisten er kopieret.');
  });
  $('#exp-txt').addEventListener('click', () => download('indkobsliste.txt', shoppingText({ bullets: true, header: true })));
  $('#exp-mail').addEventListener('click', () => {
    location.href = `mailto:?subject=${encodeURIComponent('Indkøbsliste')}&body=${encodeURIComponent(shoppingText({ bullets: true, header: true }))}`;
  });
  $('#exp-print').addEventListener('click', () => window.print());
  $('#exp-link').addEventListener('click', async () => {
    if (await copy(shareLink())) toast('Link kopieret – modtageren ser præcis de samme opskrifter.');
  });

  $('#tab-forslag').addEventListener('click', () => setView('forslag'));
  $('#tab-favoritter').addEventListener('click', () => setView('favoritter'));

  $('#font-up').addEventListener('click', () => setScale(S.fontScale + 0.1));
  $('#font-down').addEventListener('click', () => setScale(S.fontScale - 0.1));
  $('#theme-toggle').addEventListener('click', () => {
    const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    S.theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = S.theme;
    save();
  });
}

function setScale(v) {
  S.fontScale = Math.round(Math.max(0.8, Math.min(1.6, v)) * 10) / 10;
  document.documentElement.style.setProperty('--scale', S.fontScale);
  save();
}

function setView(v) {
  view = v;
  $('#tab-forslag').setAttribute('aria-selected', String(v === 'forslag'));
  $('#tab-favoritter').setAttribute('aria-selected', String(v === 'favoritter'));
  $('#go').textContent = 'Find opskrifter';
  status('');
  render();
}

syncForm();
bind();
load();
