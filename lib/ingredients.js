// Fælles logik for ingredienser – bruges både af indsamleren (Node) og websitet (browser).
// Ingen afhængigheder.

/* ------------------------------------------------------------------ *
 *  Normalisering
 * ------------------------------------------------------------------ */

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/crème/g, 'creme')
    .replace(/fraîche/g, 'fraiche')
    .replace(/[éèê]/g, 'e')
    .replace(/[áàâ]/g, 'a')
    .replace(/ä/g, 'æ')
    .replace(/ö/g, 'ø')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(s) {
  return normalize(s).match(/[a-zæøåüíóú]+/g) || [];
}

/* ------------------------------------------------------------------ *
 *  Dyrefilter – ingen kød, fisk, fjerkræ, skaldyr eller gelatine
 * ------------------------------------------------------------------ */

// Ord, som – hvis de indgår i samme ord eller står lige før – gør et "blødt" ord vegetarisk
// (fx "linsefrikadeller", "vegetarisk fars", "frugtkød", "kødfri").
const VEG_QUALIFIERS = [
  'plante', 'vegetar', 'vegansk', 'vegan', 'veggie', 'vego', 'soja', 'bønne', 'linse', 'kikært',
  'grønt', 'grønsag', 'grøntsag', 'svampe', 'champignon', 'tofu', 'seitan', 'tempeh', 'quinoa',
  'squash', 'rødbede', 'majs', 'kartoffel', 'gulerod', 'havre', 'ærte', 'falafel', 'nødde',
  'blomkål', 'broccoli', 'spinat', 'jackfrugt', 'halloumi', 'frugt', 'græskar', 'kokos',
  'avocado', 'melon', 'mango', 'aubergine', 'kødfri', 'oumph', 'quorn', 'pastinak', 'selleri', 'kål', 'beluga', 'krydderi',
];

// Hårde stammer: ordet udelukkes, hvis det indeholder stammen (medmindre en undtagelse matcher).
const HARD_CONTAINS = [
  ['kylling'], ['kalkun'], ['høns'], ['hønse'], ['perlehøne'], ['agerhøne'],
  ['okse', ['bokse']], ['svine'], ['svinekød'], ['gris', ['grissini']], ['pattegris'],
  ['bacon'], ['skinke'], ['pancetta'], ['prosciutto'], ['guanciale'], ['lardo'], ['nduja'],
  ['chorizo'], ['salami'], ['pepperoni'], ['spegepølse'], ['rullepølse'], ['medister'],
  ['leverpostej'], ['flæsk'], ['spæk', ['spækket']], ['flæskesvær'], ['ribben'], ['mørbrad'],
  ['culotte'], ['entrecote'], ['tyndsteg'], ['inderlår'], ['yderlår'], ['tykkam'], ['nakkekam'],
  ['kalv'], ['lamme', ['lammeøre']], ['vildt', ['vildtvoksende']], ['hjort', ['hjortetak']], ['rådyr'], ['dådyr'],
  ['kanin'], ['fasan'], ['gåse'], ['vagtel', ['vagtelæg']], ['struds'], ['kænguru'],
  ['gelatine'], ['husblas'], ['skumfidus'], ['marshmallow'], ['vingummi'], ['gummibams'], ['haribo'], ['fisk'], ['laks'], ['torsk'], ['kuller'], ['rødspætte'],
  ['helleflynder'], ['pighvar'], ['kulmule'], ['makrel'], ['sild'], ['ansjos'], ['sardin'],
  ['reje'], ['krabbe'], ['hummer'], ['languster'], ['musling'], ['østers', ['østershat']],
  ['blæksprutte'], ['calamar'], ['rogn'], ['kaviar'], ['løjrom'], ['stenbider'], ['havaborre'],
  ['dorade'], ['tilapia'], ['pangasius'], ['skaldyr'], ['worcester'], ['katsuobushi'],
  ['bonito'], ['dashi'], ['marvben'], ['blodpølse'], ['blodbudding'], ['nyretalg'],
  ['andebryst'], ['andelår'], ['andefedt'], ['andesteg'], ['andeconfit'], ['andekød'],
  ['andelever'], ['andefond'], ['kebabkød'], ['hamburgerryg'], ['hakkebøf'], ['oksebøf'],
  ['bresaola'], ['mortadella'], ['pastrami'], ['kotelet'], ['flanksteak'], ['roastbeef'], ['spareribs'],
  ['cuvette'], ['dyrefedt'], ['tunsteak'], ['nakkefilet'], ['svinenakke'], ['oksehale'], ['hakkekød'],
  ['ørred', ['tørred', 'tørre']], ['lyssej'], ['kulsej'], ['sejfilet'], ['langefilet'], ['rødtunge'], ['søtunge'], ['aborre'],
  ['gedde'], ['sandart'], ['brosme'], ['multe', ['multebær']], ['havkat'], ['skrubbefilet'], ['krebs'], ['surimi'],
  ['gullasch'], ['brisket'], ['shawarma'], ['chicken'], ['beef'], ['pork'], ['prawn'], ['shrimp'],
  ['salmon'], ['turkey'], ['sausage'], ['høne'], ['slethvar'], ['hvilling'], ['mørksej'], ['nyretap'],
  ['hotwings'], ['iberico'], ['ribeye'], ['caviar'], ['salsiccia'], ['striploin'], ['tenderloin'], ['tomahawk'],
  ['porterhouse'], ['picanha'], ['rullesteg'], ['spidsbryst'], ['havbars'], ['havbrasen'], ['røye'], ['brisling'],
  ['snapper'], ['barramundi'], ['halibut'], ['trout'], ['mackerel'], ['escargot'], ['frølår'], ['kyllinge'], ['fish'], ['anchov'], ['mince'], ['tri-tip'], ['wagyu'], ['tournedos'],
];

// Hele ord (inkl. almindelige bøjninger) der udelukker.
export const FILTER_VERSION = 8;

const HARD_WHOLE = [
  'and', 'ænder', 'gås', 'gæs', 'lam', 'lever', 'tun', 'ål', 'sej', 'elg', 'hare', 'harer',
  'sylte', 'tatar', 'ister', 'smult', 'talg', 'nyrer', 'hane', 'ham', 'lamb', 'duck', 'tuna', 'cod', 'hake', 'tunge', 'lubbe', 'filet', 'fileter', 'filetter', 'bone', 'flank',
];

// "Bløde" ord: udelukkes, medmindre ordet selv eller ordet før gør dem vegetariske.
const SOFT_CONTAINS = [
  'kød', 'fars', 'frikadelle', 'bøf', 'pølse', 'burger', 'nugget', 'schnitzel', 'kebab',
  'gyros', 'pulled', 'carpaccio', 'kødbolle', 'hotdog', 'pålæg', 'paté', 'pate', 'postej', 'steak', 'bolognese', 'wings', 'frikasse',
];

// Tvetydige: bouillon/fond uden angivelse af type → beholdes kun i opskrifter, der er markeret
// vegetariske, og får en note om at bruge grøntsagsbouillon.
const AMBIGUOUS = ['bouillon', 'buljong', 'fond', 'sky', 'jus'];

// Ord der må stå FØR/EFTER et blødt ord ("vegetarisk hakket kød", "pulled oumph")
const STRONG_QUALIFIERS = ['vegetar', 'vegansk', 'vegan', 'veggie', 'vego', 'plante', 'soja', 'kødfri', 'oumph',
  'quorn', 'tofu', 'seitan', 'tempeh', 'jackfrugt'];

function hasVegQualifier(s) {
  return VEG_QUALIFIERS.some((q) => s.includes(q));
}

function wholeMatch(word, base) {
  if (base === 'and') return word === 'and'; // "anden" betyder oftest "den anden halvdel"
  return new RegExp(`^${base}(e|er|en|ene|erne|s|n)?$`).test(word);
}

/**
 * Tjekker en ingredienslinje. Returnerer { hit: string|null, ambiguous: string|null }
 */
export function checkAnimalLine(line) {
  const ws = words(line);
  const norm = normalize(line);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const prev = ws[i - 1] || '';
    for (const [stem, exceptions = []] of HARD_CONTAINS) {
      if (w.includes(stem) && !exceptions.some((e) => w.includes(e))) {
        return { hit: w, ambiguous: null };
      }
    }
    for (const base of HARD_WHOLE) {
      if (wholeMatch(w, base)) return { hit: w, ambiguous: null };
    }
    for (const stem of SOFT_CONTAINS) {
      if (w.includes(stem)) {
        if (['burger', 'hotdog', 'pølse'].includes(stem) && /brød|bolle/.test(w)) continue; // burgerboller, hotdogbrød
        const ctx = [ws[i - 2] || '', prev, ws[i + 1] || ''].join(' ');
        if (hasVegQualifier(w) || STRONG_QUALIFIERS.some((q) => ctx.includes(q))) continue;
        return { hit: w, ambiguous: null };
      }
    }
  }
  if (/\b(med|uden) (skind og )?ben\b|\bben og skind\b/.test(norm)) return { hit: 'ben', ambiguous: null };
  for (const a of AMBIGUOUS) {
    const found = ws.find((w) => (a === 'fond' ? (w === a || w.endsWith(a)) : a === 'sky' || a === 'jus' ? w === a : w.includes(a)));
    if (found && !hasVegQualifier(norm) && !/miso|gær|urte|tang|kombu/.test(norm)) {
      return { hit: null, ambiguous: found };
    }
  }
  return { hit: null, ambiguous: null };
}

// Titler tjekkes kun for helt entydige ord (titler er fri tekst – "vildt god", "spækket med").
const TITLE_STEMS = [
  'kylling', 'kalkun', 'bacon', 'skinke', 'laks', 'torsk', 'rejer', 'reje', 'tunfisk', 'fisk',
  'okse', 'svine', 'flæsk', 'lamme', 'kalv', 'chorizo', 'pølse', 'frikadelle', 'kødboller',
  'muslinger', 'hummer', 'krabbe', 'andebryst', 'medister', 'pulled pork', 'hakkebøf',
  'kødsovs', 'kødsauce', 'kødstrimler', 'burger', 'steak', 'kotelet', 'mørbrad', 'culotte', 'entrecote',
  ' ørred', 'havørred', 'regnbueørred', ' sej ', ' tun ', 'hamburgerryg', 'roastbeef', 'spareribs', 'ribbensteg', 'gullasch', 'boller i karry',
  'chili con carne', 'kebab', 'shawarma', 'gyros', 'brisket', 'pastrami', 'chicken', 'beef', 'pork', 'salmon',
  'bolognese', 'høne', 'slethvar', 'hvilling', 'mørksej', 'ribeye', 'iberico', 'salsiccia', 'caviar', 'nyretap',
  'wings', 'frikasse', 'tarteletter med høns',
];

// Ord i titler, som er ok, hvis titlen selv siger vegetar/vegansk ("Vegetarisk sloppy joes burger")
const TITLE_SOFT = ['pølse', 'frikadelle', 'kødboller', 'burger', 'kødsovs', 'kødsauce', 'kødstrimler', 'hakkebøf', 'pulled pork', 'bolognese', 'steak', 'gyros', 'kebab', 'shawarma', 'chili con carne', 'carpaccio', 'wings', 'frikasse'];

export function checkAnimalTitle(title) {
  const t = ` ${normalize(title)} `;
  const vegTitle = /vegetar|vegansk|vegan|veggie|kødfri|plantebaseret/.test(t);
  for (const s of TITLE_STEMS) {
    if (vegTitle && TITLE_SOFT.includes(s)) continue;
    const idx = t.indexOf(s);
    if (idx === -1) continue;
    // "Vegetar-frikadeller", "linsefrikadeller", "vegetarisk kødsovs" m.fl. er ok
    const before = t.slice(Math.max(0, idx - 14), idx);
    const word = t.slice(t.lastIndexOf(' ', idx) + 1, t.indexOf(' ', idx + 1));
    if (hasVegQualifier(before) || hasVegQualifier(word.replace(s, ''))) continue;
    return s.trim();
  }
  return null;
}

/**
 * Hele opskriften: { ok, hits[], ambiguous[] }
 * vegSignal = opskriften er eksplicit kategoriseret vegetarisk/vegansk på kildesiden.
 */
export function checkRecipe({ title, ingredients }, vegSignal) {
  const hits = [];
  const ambiguous = [];
  const th = checkAnimalTitle(title);
  if (th) hits.push(`titel: ${th}`);
  for (const line of ingredients) {
    const r = checkAnimalLine(line);
    if (r.hit) hits.push(r.hit);
    if (r.ambiguous) ambiguous.push(line);
  }
  const ok = hits.length === 0 && (ambiguous.length === 0 || vegSignal);
  return { ok, hits, ambiguous };
}

/* ------------------------------------------------------------------ *
 *  Mejeriprodukter (smør, ghee, æg og honning tæller IKKE med)
 * ------------------------------------------------------------------ */

const PLANT = ['kokos', 'mandel', 'havre', 'soja', 'rismælk', 'risdrik', 'plante', 'cashew', 'ærte',
  'hasselnød', 'nødde', 'vegansk', 'vegan', 'oat', 'mælkebøtte', 'drik'];

const DAIRY_RULES = [
  { test: (w) => w.includes('fløde'), sub: 'plantefløde (havre/soja) eller kokosfløde' },
  { test: (w) => w.includes('mælk'), sub: 'havre- eller sojadrik' },
  { test: (w) => w.includes('yoghurt') || w === 'skyr' || w.includes('kvark') || w === 'ymer' || w.includes('kefir') || w.includes('smetana'),
    sub: 'plantebaseret yoghurt (soja eller havre)' },
  { test: (w) => w.includes('fraiche') || w === 'cremefraiche', sub: 'plantebaseret creme fraiche eller cashewcreme' },
  { test: (w) => /parmesan|parmigiano|pecorino|grana/.test(w), sub: 'gærflager eller vegansk parmesan' },
  { test: (w) => w.includes('feta'), sub: 'vegansk feta eller marineret tofu' },
  { test: (w) => /mozzarella|burrata/.test(w), sub: 'vegansk mozzarella' },
  { test: (w) => /ricotta|hytteost|cottage/.test(w), sub: 'tofu-ricotta (moset tofu med citron og salt)' },
  { test: (w) => /mascarpone|smøreost|flødeost|philadelphia|labneh/.test(w), sub: 'plantebaseret smøreost eller cashewcreme' },
  { test: (w) => /halloumi|paneer/.test(w), sub: 'fast tofu, stegt gylden' },
  { test: (w) => /gorgonzola|roquefort|brie|camembert|cheddar|gruyere|gouda|emmentaler|manchego|taleggio|comte|danbo|havarti|chevre|gedeost|queso/.test(w),
    sub: 'vegansk ost' },
  { test: (w) => (/^ost/.test(w) || /ost(en|e|er|erne|ene)?$/.test(w)) && !/^(most|frost|dybfrost|kompost|toast|rost|post|kost|kyst)/.test(w) && !/(most|frost|post|kost)$/.test(w),
    sub: 'vegansk ost eller gærflager' },
];

/** Returnerer null eller { word, sub } */
export function checkDairyLine(line) {
  const ws = words(line);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const prev = ws[i - 1] || '';
    if (PLANT.some((p) => w.includes(p)) || /vegansk|plantebaseret|vegan/.test(prev)) continue;
    for (const r of DAIRY_RULES) {
      if (r.test(w)) return { word: w, sub: r.sub };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Tid
 * ------------------------------------------------------------------ */

export function isoDurationToMinutes(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?/i);
  if (!m || m[0] === 'P') return null;
  const mins = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60);
  return mins > 0 ? Math.round(mins) : null;
}

export const TIME_BUCKETS = [
  { id: 'hurtig', label: 'Hurtig', hint: 'højst 30 min', max: 30 },
  { id: 'mellem', label: 'Mellem', hint: '31–60 min', max: 60 },
  { id: 'lang', label: 'God tid', hint: 'over 1 time', max: Infinity },
];

export function timeBucket(minutes) {
  if (!minutes) return null;
  return TIME_BUCKETS.find((b) => minutes <= b.max).id;
}

/* ------------------------------------------------------------------ *
 *  Mængder: parsing, skalering og sammenlægning
 * ------------------------------------------------------------------ */

const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅕': 0.2 };
const UNITS = ['g', 'gram', 'kg', 'mg', 'dl', 'l', 'liter', 'ml', 'cl', 'spsk', 'tsk', 'knsp', 'stk', 'fed',
  'dåse', 'dåser', 'ds', 'bundt', 'bdt', 'pose', 'poser', 'ps', 'pakke', 'pakker', 'pk', 'håndfuld',
  'håndfulde', 'nip', 'skive', 'skiver', 'kvist', 'kviste', 'stilk', 'stilke', 'glas', 'bakke', 'bakker',
  'blade', 'blad', 'portion', 'portioner', 'tern', 'drys', 'stænk', 'kop', 'kopper', 'cm'];

function parseNumber(s) {
  s = s.trim();
  let total = 0;
  let found = false;
  const re = /(\d+(?:[.,]\d+)?(?:\/\d+)?)|([¼½¾⅓⅔⅛⅕])/g;
  let m;
  while ((m = re.exec(s))) {
    found = true;
    if (m[2]) total += FRACTIONS[m[2]];
    else if (m[1].includes('/')) {
      const [a, b] = m[1].split('/');
      total += +a / +b;
    } else total += parseFloat(m[1].replace(',', '.'));
  }
  return found ? total : null;
}

/** "1½ dl piskefløde" → { qty: 1.5, qty2: null, unit: 'dl', name: 'piskefløde' } */
export function parseIngredient(raw) {
  const line = String(raw).replace(/ /g, ' ').trim();
  const qtyRe = /^((?:\d+(?:[.,]\d+)?(?:\/\d+)?\s*[¼½¾⅓⅔⅛⅕]?|[¼½¾⅓⅔⅛⅕])(?:\s+\d+\/\d+)?)(?:\s*[-–]\s*((?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅕])))?\s*/;
  const m = line.match(qtyRe);
  let qty = null;
  let qty2 = null;
  let rest = line;
  if (m) {
    qty = parseNumber(m[1]);
    qty2 = m[2] ? parseNumber(m[2]) : null;
    rest = line.slice(m[0].length);
  }
  let unit = '';
  const um = rest.match(/^([a-zæøå]+)\.?\s+/i);
  if (qty !== null && um && UNITS.includes(um[1].toLowerCase())) {
    unit = um[1].toLowerCase();
    rest = rest.slice(um[0].length);
  }
  return { qty, qty2, unit, name: rest.trim(), raw: line };
}

export function formatQty(n) {
  if (n === null || n === undefined) return '';
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const map = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔']];
  for (const [v, ch] of map) {
    if (Math.abs(frac - v) < 0.04) return (whole ? String(whole) : '') + ch;
  }
  if (frac < 0.04) return String(whole);
  if (n >= 10) return String(Math.round(n));
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

export function scaleIngredient(raw, factor) {
  const p = parseIngredient(raw);
  if (p.qty === null || factor === 1) return p.raw;
  let q = p.qty * factor;
  let q2 = p.qty2 !== null ? p.qty2 * factor : null;
  // Gram og ml afrundes pænt
  if (['g', 'gram', 'ml'].includes(p.unit) && q >= 20) {
    q = Math.round(q / 5) * 5;
    if (q2) q2 = Math.round(q2 / 5) * 5;
  }
  const qs = formatQty(q) + (q2 !== null ? `–${formatQty(q2)}` : '');
  return [qs, p.unit, p.name].filter(Boolean).join(' ');
}

/** Nøgle til sammenlægning af ens varer i indkøbslisten. */
export function ingredientKey(raw) {
  return normalize(parseIngredient(raw).name)
    .replace(/\(.*?\)/g, '')
    .split(/,| - | – | til | eller /)[0]
    .replace(/\b(finthakket|hakket|hakkede|groft|fint|revet|revne|skåret|skårne|i tern|i skiver|frisk|friske|tørret|tørrede|store?|små|lille|mellemstore?|økologiske?|ca\.?|evt\.?|gerne|presset|pressede|knust|knuste|kogte?|ristede?|udstenede?|skrællede?|halverede?|grofthakket|grofthakkede|finthakkede|smeltet|blødt|stuetempereret|koldt?|varmt?|tynde?|tykke?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fjerner SEO-haler fra titler: "Linsesuppe - opskrift på lækker suppe" → "Linsesuppe" */
export function cleanTitle(t) {
  return String(t || '')
    .replace(/\s+[-–|]\s+(se |den |en |nem |nemme |lækker|lækre|skøn|bedste|hjemmelavet|hjemmelavede|super|sådan|klassisk|opskrift|sund|let |hurtig|verdens).*$/i, '')
    .replace(/\s*[-–|]\s*(Valdemarsro|Madens Verden|Mummum|Louises Madblog).*$/i, '')
    .trim();
}
