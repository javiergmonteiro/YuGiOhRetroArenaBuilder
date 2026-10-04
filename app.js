/* =====================================================================
 * Arena GOAT v2 — draft por tiers
 *
 * Datos: cards.json (lo genera build_pool.py) y config.json (opcional).
 * Cada carta trae `t`: 'S' | 'A' | 'B' | 'R' según el .ydk donde se cargó
 * (tier s.ydk, tier a.ydk, tier b.ydk, o cualquier otro = R, pool aleatorio).
 *
 * Idea central: NO hay sinergia ni popularidad. Al empezar el draft se sortean
 * DOS CALENDARIOS (main y Extra Deck): cuántas veces aparecerá una carta de cada tier y en qué picks.
 *   - Pick con evento de tier: 1 carta de ese tier + el resto del pool aleatorio.
 *   - Resto de los picks: cartas del pool aleatorio.
 * Main: 40 picks de 4 cartas. Extra Deck: hasta 15 picks de 3 fusiones, con su propio calendario
 * (config.json -> extraTiers), normalmente más exigente que el del main.
 *
 * Índice: 0 idioma · 1 constantes/estado · 2 utilidades · 3 calendario de tiers
 *         4 generación de ofertas · 5 elegir/exportar/dibujar · 6 arranque
 * ===================================================================== */

/* ---------- 0. IDIOMA (EN por defecto; botones EN | ES sin recargar) ---------- */
const TT = {
  es: {
    title: 'Arena GOAT',
    subtitle: 'Elegí 1 de 4 cartas para el main (40) y 1 de 3 para el Extra Deck (hasta 15).',
    finishExtra: 'Terminar Extra', restart: 'Reiniciar',
    monsters: 'Monstruos', spells: 'Magias', traps: 'Trampas',
    done: '¡Mazo completo!',
    pick: (n, t) => 'Pick ' + n + ' de ' + t,
    extraPick: (n, t) => 'Extra Deck: pick ' + n + ' de ' + t,
    limited: 'Limitada', semi: 'Semi-limitada', tier: 'Tier',
    endTitle: 'Tu mazo (.ydk)', endHelp: 'Copialo a un archivo .ydk para importarlo en simuladores.',
    tiersGot: 'Cartas de tier en tu mazo',
    loadError: 'No se pudo cargar cards.json. Corré build_pool.py y abrí la página con un servidor local (python -m http.server).'
  },
  en: {
    title: 'GOAT Arena',
    subtitle: 'Pick 1 of 4 cards for the main deck (40) and 1 of 3 for the Extra Deck (up to 15).',
    finishExtra: 'Finish Extra', restart: 'Restart',
    monsters: 'Monsters', spells: 'Spells', traps: 'Traps',
    done: 'Deck complete!',
    pick: (n, t) => 'Pick ' + n + ' of ' + t,
    extraPick: (n, t) => 'Extra Deck: pick ' + n + ' of ' + t,
    limited: 'Limited', semi: 'Semi-limited', tier: 'Tier',
    endTitle: 'Your deck (.ydk)', endHelp: 'Copy it into a .ydk file to import it into a simulator.',
    tiersGot: 'Tier cards in your deck',
    loadError: 'Could not load cards.json. Run build_pool.py and open the page through a local server (python -m http.server).'
  }
};
let LANG = 'en', T = TT[LANG];


/* ---------- 1. CONSTANTES Y ESTADO ---------- */
const SIZE = 40, XSIZE = 15;    // main y Extra Deck
const OFFER = 4, XOFFER = 3;    // cartas por oferta (main / extra)
const kn = k => ({ m: T.monsters, s: T.spells, t: T.traps })[k];

// Configuración por defecto; config.json la sobrescribe.
//  tiers.X: cuántos picks del draft tendrán una carta de ese tier. Dos formas:
//     { "weights": {"1":.5,"2":.4,"3":.1} }  (probabilidad de cada cantidad)
//     { "min": 4, "max": 6 }                 (entero uniforme entre min y max)
//  balance: ayuda opcional para no terminar con un mazo desparejo (apagada por defecto = puro azar)
let CFG = {
  tiers: { S: { weights: { 1: .5, 2: .4, 3: .1 } }, A: { min: 4, max: 6 }, B: { min: 6, max: 10 } },
  // Igual que `tiers` pero para los 15 picks del Extra Deck (fusiones de tier S/A/B cargadas en los .ydk de tier)
  extraTiers: { S: { weights: { 0: .5, 1: .5 } }, A: { min: 1, max: 2 }, B: { min: 2, max: 4 } },
  balance: { enabled: false, monsters: 20, spells: 10, traps: 10, strength: .4 },
  extraRepeatBoost: .8      // Extra Deck: cada copia ya elegida multiplica el peso por (1 + este valor)
};

let R = [];                          // pool aleatorio del main (tier R)
let TP = { S: [], A: [], B: [] };    // cartas de main de cada tier
let RX = [];                         // pool aleatorio del Extra Deck (fusiones de tier R)
let TPX = { S: [], A: [], B: [] };   // fusiones de cada tier
let deck = [], ext = [], offer = [], phase = 'main';   // 'main' -> 'extra' -> 'done'
let SCHED = {};                      // calendario del main: índice de pick (0-39) -> 'S' | 'A' | 'B'
let XSCHED = {};                     // calendario del Extra Deck: índice de pick (0-14) -> 'S' | 'A' | 'B'
let SHOWN = new Set();               // ids de cartas de tier ya ofrecidas en este draft (para no repetirlas)
let status = 'loading';              // 'loading' | 'ok' | 'error'


/* ---------- 2. UTILIDADES ---------- */
const $ = id => document.getElementById(id);
const img = c => '<img loading="lazy" src="images_hd/' + c.img + '.jpg" alt="' + c.n.replace(/"/g, '') +
  '" onerror="this.style.visibility=\'hidden\'">';
const cnt = c => (c.ex ? ext : deck).filter(x => x === c).length;   // copias ya elegidas
const kc = () => { const o = { m: 0, s: 0, t: 0 }; deck.forEach(c => o[c.k]++); return o; };

function shuffle(a) {   // Fisher-Yates
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function wpick(pool, wf) {   // sorteo ponderado
  const ws = pool.map(wf), tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}


/* ---------- 3. CALENDARIO DE TIERS ----------
 * Al empezar (o reiniciar) se decide, para S, A y B, CUÁNTOS picks traerán una carta de ese tier
 * (según config.json) y se reparten en picks distintos al azar. Un pick tiene como mucho un evento.
 * La cantidad se limita a cuántas cartas distintas tiene el tier (no se fuerza repetir). */
function sampleCount(cfg, cap) {
  let n;
  if (cfg.weights) n = +wpick(Object.keys(cfg.weights), k => cfg.weights[k]);
  else { const lo = cfg.min ?? 0, hi = cfg.max ?? lo; n = lo + Math.floor(Math.random() * (hi - lo + 1)); }
  return Math.min(n, cap);
}
// Arma un calendario para `size` picks: reparte al azar, en picks distintos, los eventos de S, A y B
// (`pools` = cartas de cada tier, `cfgs` = configuración de cantidades de cada tier)
function buildSchedule(size, pools, cfgs) {
  const picks = shuffle([...Array(size).keys()]), sched = {};
  let i = 0;
  for (const t of ['S', 'A', 'B']) {
    const n = pools[t].length ? sampleCount(cfgs[t] || {}, pools[t].length) : 0;
    for (let k = 0; k < n && i < picks.length; k++) sched[picks[i++]] = t;
  }
  return sched;
}
function makeSchedule() {
  SCHED = buildSchedule(SIZE, TP, CFG.tiers);
  XSCHED = buildSchedule(XSIZE, TPX, CFG.extraTiers);
}


/* ---------- 4. GENERACIÓN DE OFERTAS ----------
 * MAIN: si el pick tiene evento de tier, 1 carta de ese tier (que no se haya ofrecido antes si es posible)
 *       + el resto del pool aleatorio. Pool aleatorio = uniforme (con balance opcional, ver CFG.balance).
 * EXTRA: misma idea con su propio calendario (XSCHED): 1 fusión del tier + el resto del pool aleatorio de
 *        fusiones. Las ya elegidas pesan (1 + extraRepeatBoost × copias); las de tier ya ofrecidas pesan ×0.3. */
function balW(k, cur, d) {   // peso de equilibrio (1 si está apagado)
  const b = CFG.balance;
  if (!b.enabled) return 1;
  const T3 = { m: b.monsters, s: b.spells, t: b.traps };
  return Math.min(6, Math.max(.1, Math.exp(b.strength * (T3[k] * d / SIZE - cur[k]))));
}
function newOffer() {
  const out = [];
  if (phase === 'extra') {
    const tier = XSCHED[ext.length], av = c => cnt(c) < c.mx;
    const w = c => (1 + CFG.extraRepeatBoost * cnt(c)) * (SHOWN.has(c.id) ? .3 : 1);   // repetidas suben, ya ofrecidas de tier bajan
    if (tier) {                                          // evento de tier en este pick del Extra
      const pool = TPX[tier].filter(av);
      if (pool.length) { const c = wpick(pool, w); out.push(c); SHOWN.add(c.id); }
    }
    const fillX = (src, wf) => {
      while (out.length < XOFFER) {
        const pool = src.filter(c => av(c) && !out.includes(c));
        if (!pool.length) break;
        out.push(wpick(pool, wf));
      }
    };
    fillX(RX, c => 1 + CFG.extraRepeatBoost * cnt(c));
    if (out.length < XOFFER) fillX([...TPX.B, ...TPX.A, ...TPX.S], w);   // pool aleatorio demasiado chico
  } else {
    const d = deck.length, cur = kc(), tier = SCHED[d];
    const av = c => cnt(c) < c.mx;                       // respeta la banlist (copias máximas)
    if (tier) {                                          // evento de tier en este pick
      let pool = TP[tier].filter(av);
      const fresh = pool.filter(c => !SHOWN.has(c.id));  // preferir cartas del tier no ofrecidas todavía
      if (fresh.length) pool = fresh;
      if (pool.length) { const c = pool[Math.floor(Math.random() * pool.length)]; out.push(c); SHOWN.add(c.id); }
    }
    const fill = src => {                                // completa hasta OFFER con cartas al azar
      while (out.length < OFFER) {
        const pool = src.filter(c => av(c) && !out.includes(c));
        if (!pool.length) break;
        out.push(wpick(pool, c => balW(c.k, cur, d)));
      }
    };
    fill(R);
    if (out.length < OFFER) fill([...TP.B, ...TP.A, ...TP.S]);   // pool aleatorio demasiado chico
  }
  offer = shuffle(out).map(c => ({ c }));
}


/* ---------- 5. ELEGIR, EXPORTAR, DIBUJAR ---------- */
function choose(c) {
  if (phase === 'main') { deck.push(c); if (deck.length >= SIZE) phase = 'extra'; }
  else { ext.push(c); if (ext.length >= XSIZE) phase = 'done'; }
  if (phase !== 'done') { newOffer(); if (!offer.length) phase = 'done'; }
  render();
}
function ydk() {
  const id = a => a.map(c => c.id).sort((p, q) => p - q).join('\n');
  return '#created by Arena GOAT\n#main\n' + id(deck) + '\n#extra\n' + id(ext) + '\n!side\n';
}
const tl = c => 'ABS'.includes(c.t) && c.t ? '<span class="tl t' + c.t + '">' + c.t + '</span>' : '';   // mini-etiqueta de tier
function list(arr, title) {
  let h = '<div class="h">' + title + '</div>';
  [...new Set(arr)].sort((a, b) => a.n.localeCompare(b.n))
    .forEach(c => h += '<div><span>' + tl(c) + c.n + '</span><span>×' + arr.filter(x => x === c).length + '</span></div>');
  return h;
}
function render() {
  const d = deck.length, e = ext.length, done = phase === 'done', cur = kc();
  $('bar').style.width = ((d + e) / (SIZE + XSIZE) * 100) + '%';
  $('n').textContent = d; $('ne').textContent = e;
  $('off').style.display = done ? 'none' : '';
  $('end').style.display = done ? '' : 'none';
  $('sk').style.display = phase === 'extra' ? '' : 'none';
  $('hd').textContent = done ? T.done
    : phase === 'main' ? T.pick(d + 1, SIZE) + ' · ' + T.monsters + ' ' + cur.m + ' · ' + T.spells + ' ' + cur.s + ' · ' + T.traps + ' ' + cur.t
    : T.extraPick(e + 1, XSIZE);

  $('off').innerHTML = '';
  if (!done) offer.forEach(o => {
    const c = o.c, b = document.createElement('button'), isT = 'SAB'.includes(c.t) && c.t;
    b.className = 'card' + (isT ? ' t' + c.t : '');
    b.innerHTML = img(c) + '<b>' + c.n + '</b><span class="tag">' +
      (isT ? '<span class="tier">' + T.tier + ' ' + c.t + '</span> ' : '') +
      (c.mx === 1 ? T.limited + ' ' : c.mx === 2 ? T.semi + ' ' : '') +
      '&nbsp;</span><small class="d">' + (c.desc || '').replace(/</g, '&lt;') + '</small>';
    b.onclick = () => choose(c);
    $('off').appendChild(b);
  });

  let h = '';
  ['m', 's', 't'].forEach(k => { const a = deck.filter(c => c.k === k); if (a.length) h += list(a, kn(k) + ' (' + a.length + ')'); });
  if (e) h += list(ext, 'Extra Deck (' + e + ')');
  $('dl').innerHTML = h;

  if (done) {
    const g = { S: 0, A: 0, B: 0 };
    deck.concat(ext).forEach(c => { if (g[c.t] !== undefined) g[c.t]++; });
    $('end').innerHTML = '<h2>' + T.endTitle + '</h2><p class="sub">' + T.endHelp + '</p>' +
      '<p class="sub">' + T.tiersGot + ': S ' + g.S + ' · A ' + g.A + ' · B ' + g.B + '</p><textarea readonly>' + ydk() + '</textarea>';
  }
}
function start() { SHOWN = new Set(); deck = []; ext = []; phase = 'main'; makeSchedule(); newOffer(); render(); }

// Idioma
function applyStatic() {
  document.querySelectorAll('[data-t]').forEach(e => e.textContent = T[e.dataset.t]);
  document.title = T.title;
}
function setLang(l) {
  LANG = l; T = TT[l];
  document.documentElement.lang = l;
  applyStatic();
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === l));
  if (status === 'ok') render(); else if (status === 'error') $('hd').textContent = T.loadError;
}
document.querySelectorAll('.lang button').forEach(b => b.onclick = () => setLang(b.dataset.lang));
setLang('en');
$('rs').onclick = start;
$('sk').onclick = () => { phase = 'done'; render(); };


/* ---------- 6. ARRANQUE ----------
 * cards.json es obligatorio. config.json es opcional (si falta o es inválido se usan los valores por defecto). */
Promise.all([
  fetch('cards.json').then(r => r.json()),
  fetch('config.json').then(r => r.json()).catch(() => ({}))
]).then(([j, cfg]) => {
  for (const t of ['S', 'A', 'B']) if (cfg.tiers && cfg.tiers[t]) CFG.tiers[t] = cfg.tiers[t];
  for (const t of ['S', 'A', 'B']) if (cfg.extraTiers && cfg.extraTiers[t]) CFG.extraTiers[t] = cfg.extraTiers[t];
  Object.assign(CFG.balance, cfg.balance || {});
  if (cfg.extraRepeatBoost != null) CFG.extraRepeatBoost = +cfg.extraRepeatBoost;
  const all = j.cards;
  R = all.filter(c => !c.ex && c.t === 'R');
  for (const t of ['S', 'A', 'B']) TP[t] = all.filter(c => !c.ex && c.t === t);
  RX = all.filter(c => c.ex && c.t === 'R');
  for (const t of ['S', 'A', 'B']) TPX[t] = all.filter(c => c.ex && c.t === t);
  start();
  status = 'ok';
}).catch(() => { status = 'error'; $('hd').textContent = T.loadError; });
