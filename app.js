/* =====================================================================
 * Arena GOAT — lógica del draft
 *
 * Datos de entrada:
 *   cards.json  (lo genera build_pool.py a partir de los .ydk de decks/)
 *   rules.json  (reglas manuales; opcional, se edita a mano)
 *
 * Índice:
 *   1. Constantes y estado
 *   2. Utilidades (DOM, imágenes, sorteo ponderado, comparaciones)
 *   3. Sinergia aprendida de los .ydk (syn) y perfiles de composición
 *   4. Reglas de rules.json (carga, grupos, selectores, multiplicadores)
 *   5. Equilibrio, rareza, garantías (ensure)
 *   6. Generación de ofertas (newOffer)  <-- el corazón del algoritmo
 *   7. Elegir carta, exportar .ydk y dibujar la pantalla
 *   8. Arranque (carga de cards.json y rules.json)
 *
 * Convención de datos de carta (campos de cards.json):
 *   id, n (nombre), k ('m' monstruo | 's' magia | 't' trampa), ty (tipo completo),
 *   lv, a (ATK), d (DEF), mx (copias máx: 1 limitada, 2 semi, 3 libre), ex (¿Extra Deck?),
 *   img (id de imagen), desc (texto), r (raza), at (atributo),
 *   p (popularidad 0-1), pn (nº de mazos donde aparece), prof (perfil de composición),
 *   co (sinergias: {idCarta: lift})
 * ===================================================================== */


/* ---------- 0. IDIOMA ----------
 * La página arranca SIEMPRE en inglés. Los botones EN | ES de la esquina cambian el idioma sin recargar
 * (el draft en curso se conserva). Los textos fijos del HTML llevan data-t="clave" y se rellenan con
 * applyStatic(); los textos dinámicos usan T.<clave> directamente.
 * Para agregar otro idioma: copiá un bloque de TT, y agregá su botón (data-lang="xx") en index.html. */
const TT = {
  es: {
    title: 'Arena GOAT',
    subtitle: 'Elegí 1 de 4 cartas para el main (40) y 1 de 3 para el Extra Deck (hasta 15).',
    finishExtra: 'Terminar Extra', restart: 'Reiniciar',
    monsters: 'Monstruos', spells: 'Magias', traps: 'Trampas',
    done: '¡Mazo completo!',
    pick: (n, t) => 'Pick ' + n + ' de ' + t,
    extraPick: (n, t) => 'Extra Deck: pick ' + n + ' de ' + t,
    limited: 'Limitada', semi: 'Semi-limitada', synergy: '★ sinergia', wild: '✦ fuera de lo común',
    endTitle: 'Tu mazo (.ydk)', endHelp: 'Copialo a un archivo .ydk para importarlo en simuladores.',
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
    limited: 'Limited', semi: 'Semi-limited', synergy: '★ synergy', wild: '✦ wild card',
    endTitle: 'Your deck (.ydk)', endHelp: 'Copy it into a .ydk file to import it into a simulator.',
    loadError: 'Could not load cards.json. Run build_pool.py and open the page through a local server (python -m http.server).'
  }
};
let LANG = 'en';        // idioma por defecto (no se recuerda entre visitas)
let T = TT[LANG];       // textos del idioma actual


/* ---------- 1. CONSTANTES Y ESTADO ---------- */

const SIZE  = 40;    // cartas del main
const XSIZE = 15;    // máximo de cartas del Extra Deck
const STAPLE = .3;   // una carta es "staple" si aparece en >= 30% de los mazos de decks/
const kn = k => ({ m: T.monsters, s: T.spells, t: T.traps })[k];   // nombre del tipo en el idioma actual

let C = [];             // pool del main (cartas que no son del Extra Deck)
let X = [];             // pool del Extra Deck (fusiones)
let deck = [];          // cartas elegidas para el main (con repetidas)
let ext = [];           // cartas elegidas para el Extra Deck
let offer = [];         // oferta actual: [{c: carta, s: sinergia, a: ¿slot "opuesto"?}]
let phase = 'main';     // 'main' -> 'extra' -> 'done'

// Parámetros ajustables desde rules.json (estos son los valores por defecto):
let POP = { gamma: .5 };                         // _pop: compresión de popularidad (1 = sin comprimir)
let FRESH = .7;                                  // _fresh: penalización por cada oferta rechazada
let RAR = { lim: .15, semi: .4, mulL: .3, mulS: .6 };  // _rarity: reparto y penalización por banlist

// Datos cargados de rules.json (se rellenan en la sección 8):
let RULES = {};     // reglas por nombre de carta: {nombre: [regla, ...]}
let SEL = [];       // reglas por selector (#race:Beast...): [{test, rule}]
let GR = {};        // grupos (_groups)
let ENSURE = [];    // grupos con garantía (_ensure)

// Estado del draft actual (se reinicia en start()):
let SEENA = {};     // para _ensure: ids de cartas ya ofrecidas DESPUÉS de activarse la garantía
let DECL = {};      // id -> veces que la carta se ofreció y NO fue elegida (para _fresh)


/* ---------- 2. UTILIDADES ---------- */

const $ = id => document.getElementById(id);

// HTML de la imagen de una carta (images_hd/<img>.jpg). Si falta, se oculta en vez de mostrar ícono roto.
const img = c => '<img loading="lazy" src="images_hd/' + c.img + '.jpg" alt="' + c.n.replace(/"/g, '') +
  '" onerror="this.style.visibility=\'hidden\'">';

// Copias de la carta ya elegidas (en el main o en el extra, según corresponda)
const cnt = c => (c.ex ? ext : deck).filter(x => x === c).length;

// Compara un número con una expresión tipo "<=5", ">=9", "==2", "<3", ">4" (solo enteros)
const cmp = (v, s) => {
  const m = /^(<=|>=|==|<|>)\s*(-?\d+)/.exec(s);
  if (!m) return false;
  const n = +m[2];
  return m[1] === '==' ? v === n : m[1] === '<=' ? v <= n : m[1] === '>=' ? v >= n : m[1] === '<' ? v < n : v > n;
};

// Sorteo ponderado: elige 1 elemento de `pool`; la probabilidad es proporcional a wf(elemento)
function wpick(pool, wf) {
  const ws = pool.map(wf), tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

// Compresión de popularidad: p^gamma. Con gamma .5 las muy usadas pesan bastante menos que antes
// (p=.8 pesa 8x una p=.1 sin comprimir; comprimido pesa ~2.8x)
const pw = p => Math.pow(p, POP.gamma);

// Frescura: cada vez que una carta se ofreció y no la elegiste, pesa FRESH veces menos
const fr = c => Math.pow(FRESH, DECL[c.id] || 0);

// Recuento actual del main por tipo: {m, s, t}
const kc = () => { const o = { m: 0, s: 0, t: 0 }; deck.forEach(c => o[c.k]++); return o; };


/* ---------- 3. SINERGIA APRENDIDA DE LOS .YDK ----------
 * c.co (generado por build_pool.py) guarda, por carta, el "lift" con otras cartas:
 * cuántas veces más seguido aparecen juntas en los mazos que por azar (1 = azar, 3 = triple).
 * syn(c) suma esa afinidad de `c` con cada carta DISTINTA que ya elegiste. */
function syn(c) {
  let s = 0;
  for (const p of new Set(deck)) {
    // la lista co puede estar guardada en cualquiera de las dos cartas (top 40 por carta): se toma el mayor
    const l = Math.max((c.co && c.co[p.id]) || 0, (p.co && p.co[c.id]) || 0);
    if (l > 1) s += Math.min(l, 5) - 1;   // cada pareja aporta como máximo 4 (lift 5)
  }
  return Math.min(s, 8);                  // tope total 8; en newOffer pesa como (1 + 0.7*syn)
}

// Perfil aprendido: favorece cartas que se juegan en mazos con una composición (monstruos/magias/trampas)
// parecida a la que llevás. c.prof = fracción media [m, s, t] de los mazos donde aparece la carta.
// Multiplicador entre 0.4 y 1.6; crece su influencia hasta el pick 20. Requiere >= 3 mazos (c.pn).
function profMult(c, cur) {
  const d = deck.length;
  if (!c.prof || c.pn < 3 || !d) return 1;
  const dist = ['m', 's', 't'].reduce((s, k, i) => s + (cur[k] / d - c.prof[i]) ** 2, 0);
  return 1 + Math.min(1, d / 20) * .6 * (2 * Math.exp(-dist / .03) - 1);
}


/* ---------- 4. REGLAS DE rules.json ----------
 * Estructura interna tras loadRules():
 *   RULES[nombreCarta] = [ {shift:{...}, when:[{...}]}, ... ]   (reglas por nombre o por @grupo)
 *   SEL = [ {test: carta => bool, rule} ]                        (reglas por selector #...)
 * Ver README.md para la documentación completa del formato. */

// Convierte un selector ("race:Beast,lv<=3") en una función carta => bool (todas las condiciones deben cumplirse)
function parseSel(s) {
  const ts = s.split(',').map(t => {
    let m;
    if (m = /^race:(.+)$/.exec(t)) return c => c.r === m[1];                      // raza exacta
    if (m = /^attr:(.+)$/.exec(t)) return c => c.at === m[1];                     // atributo exacto
    if (m = /^type:(.+)$/.exec(t)) return c => (c.ty || '').includes(m[1]);       // el tipo contiene el texto
    if (m = /^lv(.+)$/.exec(t)) return c => c.k === 'm' && cmp(+c.lv, m[1]);      // nivel: lv<=3, lv>=7...
    return () => false;                                                           // selector desconocido: no coincide
  });
  return c => ts.every(f => f(c));
}

// Lee el objeto de rules.json y arma RULES y SEL
function loadRules(raw) {
  const G = raw._groups || {}, out = {};
  SEL = [];
  // Expande "@grupo" a la lista de nombres del grupo; un nombre normal queda igual
  const ex = l => (l || []).flatMap(n => n[0] === '@' ? (G[n.slice(1)] || []) : [n]);
  for (const [k, r] of Object.entries(raw)) {
    if (k[0] === '_') continue;   // claves reservadas (_groups, _rarity, _pop, _fresh, _ensure): no son reglas de carta
    const rule = { shift: r.shift || {}, when: (r.when || []).map(w => ({ ...w, has: w.has && ex(w.has) })) };
    if (k[0] === '#') { SEL.push({ test: parseSel(k.slice(1)), rule }); continue; }   // selector
    for (const nm of ex([k])) (out[nm] = out[nm] || []).push(rule);                   // nombre o @grupo
  }
  return out;
}

// Todas las reglas que aplican a una carta: por nombre/grupo + por selector
const ruleList = c => (RULES[c.n] || []).concat(SEL.filter(s => s.test(c)).map(s => s.rule));

// Multiplicador total de reglas `when` para una carta. Cada entrada de `when` cuyas condiciones se
// cumplen TODAS multiplica por su `x`. Condiciones: monster/spell/trap (composición proyectada a 40,
// solo desde el pick 12), has (alguna de esas cartas en tu main), copies (copias de ESTA carta que ya tenés).
function ruleMult(c, cur) {
  const d = deck.length, names = new Set(deck.map(p => p.n));
  let x = 1;
  for (const r of ruleList(c)) for (const w of r.when) {
    let ok = true;
    for (const k of ['monster', 'spell', 'trap'])
      if (w[k]) ok = ok && d >= 12 && cmp(cur[KM[k]] / d * 40, w[k]);
    if (w.has) ok = ok && w.has.some(n => names.has(n));
    if (w.copies) ok = ok && cmp(cnt(c), w.copies);
    if (ok) x *= w.x;   // OJO: si falta `x` en la regla, el resultado es NaN y la oferta se rompe
  }
  return x;
}

const KM = { monster: 'm', spell: 's', trap: 't' };   // nombres de rules.json -> clave interna de tipo


/* ---------- 5. EQUILIBRIO, RAREZA, GARANTÍAS ---------- */

// Objetivo de composición del main (sobre 40 cartas): base 20 monstruos / 10 magias / 10 trampas,
// más los "shift" de las reglas de cada carta DISTINTA elegida. Mínimos: 6 monstruos, 0 magias, 0 trampas.
function target() {
  const T = { m: 20, s: 10, t: 10 };
  for (const c of new Set(deck)) for (const r of ruleList(c)) for (const [k, v] of Object.entries(r.shift)) T[KM[k]] += v;
  T.m = Math.max(T.m, 6); T.s = Math.max(T.s, 0); T.t = Math.max(T.t, 0);
  return T;
}

// Rareza por banlist: solo para staples (p >= STAPLE). Multiplica el peso de limitadas (mx=1) y semi (mx=2)
const rm = c => c.p >= STAPLE ? (c.mx === 1 ? RAR.mulL : c.mx === 2 ? RAR.mulS : 1) : 1;

// Garantía (_ensure): si ya elegiste una carta de un grupo (p. ej. una pieza de Exodia), las demás deben
// OFRECERSE al menos una vez antes de que termine el main. Funciona como "pity timer": la probabilidad
// de forzar una carta pendiente sube a medida que quedan menos picks, y es 100% cuando quedan tantos
// picks como cartas pendientes. La carta forzada reemplaza a la última de la oferta (`out`).
// Ofrecer no es lo mismo que tomar: si la rechazás, no se vuelve a forzar.
function ensure(out, d) {
  const r = SIZE - d, act = [];   // r = picks que quedan
  for (const e of ENSURE) {
    const mem = C.filter(c => (GR[e.group] || []).includes(c.n));       // cartas del grupo presentes en el pool
    if (mem.some(c => deck.includes(c)))                                // ¿ya elegiste alguna? -> se activa
      act.push({ mem, seen: SEENA[e.group] = SEENA[e.group] || new Set() });
  }
  const pend = act.flatMap(a => a.mem.filter(c => !deck.includes(c) && !a.seen.has(c.id) && cnt(c) < c.mx));
  if (pend.length && Math.random() < (pend.length >= r ? 1 : Math.min(.5, 1.5 * pend.length / r))) {
    const f = pend[Math.floor(Math.random() * pend.length)];
    if (!out.includes(f)) { if (out.length >= 4) out[out.length - 1] = f; else out.push(f); }
  }
  act.forEach(a => out.forEach(c => a.seen.add(c.id)));   // todo lo que se ofrece desde la activación cuenta como "visto"
}


/* ---------- 6. GENERACIÓN DE OFERTAS ----------
 * MAIN (4 cartas):
 *   slot 1  STAPLE: se sortea primero la clase de banlist (limitada/semi/libre según RAR.lim y RAR.semi)
 *           y luego una staple de esa clase con peso pw(p) * W.
 *   slot 2  SINERGIA: cualquier carta con peso (0.03 + 6*pw(p)) * (1 + 0.7*syn) * W.
 *   slots 3-4  "OPUESTAS": peso (1-p)^6 / (1+syn) * W2 -> las poco usadas y sin sinergia.
 *   relleno (si faltó alguna): peso 0.05 + 3*sqrt(p).
 *   ensure(): puede reemplazar la última por una pieza garantizada.
 * EXTRA (3 cartas): staple, sinergia y una de relleno; las ya elegidas pesan más (x1.8 por copia).
 * Al final la oferta se baraja para que el orden no delate el slot. */
function newOffer() {
  const x = phase === 'extra', d = deck.length, cur = kc(), T = target(), out = [];

  // Cartas disponibles: aún no llegaste al máximo de copias (banlist)
  let av = (x ? X : C).filter(c => cnt(c) < c.mx);
  // Tope duro por tipo: no pasar de (objetivo + 10) de monstruos/magias/trampas, si quedan >= 3 opciones
  if (!x) { const f = av.filter(c => cur[c.k] < T[c.k] + 10); if (f.length >= 3) av = f; }

  // Equilibrio: factor 0.1-6 según cuánto te falta (o te sobra) de ese tipo respecto al objetivo
  // proporcional al pick actual (T[k]*d/40). Si te faltan monstruos, los monstruos pesan más.
  const bal = k => Math.min(6, Math.max(.1, Math.exp(.4 * (T[k] * d / 40 - cur[k]))));

  // W: peso general. Main = equilibrio * penalización de repetidas no-monstruo (x0.45 por copia)
  //    * reglas * perfil * rareza * frescura.  Extra = 1 + 0.8 por copia ya elegida.
  const W = c => x ? 1 + .8 * cnt(c)
    : bal(c.k) * (c.k === 'm' ? 1 : Math.pow(.45, cnt(c))) * ruleMult(c, cur) * profMult(c, cur) * rm(c) * fr(c);
  // W2: para los slots "opuestos": solo equilibrio, repetidas y frescura (ignoran reglas, perfil y rareza)
  const W2 = c => bal(c.k) * (c.k === 'm' ? 1 : Math.pow(.45, cnt(c))) * fr(c);

  const anti = new Set();   // cartas que salieron por los slots "opuestos" (para la etiqueta ✦)
  // take: saca 1 carta de `pool` (sin repetir las ya elegidas en esta oferta) con peso wf(c)*Wf(c)
  const take = (pool, wf, Wf = W, mark) => {
    pool = pool.filter(c => !out.includes(c));
    if (pool.length) { const c = wpick(pool, k => wf(k) * Wf(k)); out.push(c); if (mark) anti.add(c); }
  };

  // Slot 1: staple. Primero la clase de banlist; si esa clase no tiene cartas disponibles se prueba la siguiente.
  const st = av.filter(c => c.p >= STAPLE), rr = Math.random();
  const order = rr < RAR.lim ? [1, 2, 3] : rr < RAR.lim + RAR.semi ? [2, 3, 1] : [3, 2, 1];
  const cl = order.map(m => st.filter(c => c.mx === m)).find(a => a.length);
  if (cl) take(cl, c => pw(c.p));

  // Slot 2: sinergia (+ popularidad comprimida)
  take(av, c => (.03 + 6 * pw(c.p)) * (1 + syn(c) * .7));

  // Slots 3 y 4 (solo main): lo más opuesto a lo popular y a tu sinergia
  if (!x) for (let i = 0; i < 2; i++) take(av, c => Math.pow(1 - c.p, 6) / (1 + syn(c)), W2, true);

  // Relleno si el pool es chico y no se llegó al tamaño de la oferta (4 en main, 3 en extra)
  while (out.length < (x ? 3 : 4) && out.length < av.length) take(av, c => .05 + 3 * Math.sqrt(c.p));

  if (!x) ensure(out, d);   // garantías de grupo (Exodia, etc.)

  offer = out.sort(() => Math.random() - .5).map(c => ({ c, s: syn(c), a: anti.has(c) }));
}


/* ---------- 7. ELEGIR, EXPORTAR, DIBUJAR ---------- */

// El jugador eligió la carta c
function choose(c) {
  // Las otras cartas ofrecidas cuentan como "rechazadas" (alimenta _fresh)
  offer.forEach(o => { if (o.c !== c) DECL[o.c.id] = (DECL[o.c.id] || 0) + 1; });
  if (phase === 'main') { deck.push(c); if (deck.length >= SIZE) phase = 'extra'; }
  else { ext.push(c); if (ext.length >= XSIZE) phase = 'done'; }
  if (phase !== 'done') { newOffer(); if (!offer.length) phase = 'done'; }   // sin cartas disponibles: termina
  render();
}

// Mazo en formato .ydk (se importa en simuladores como EDOPro/YGOPro)
function ydk() {
  const id = a => a.map(c => c.id).sort((p, q) => p - q).join('\n');
  return '#created by Arena GOAT\n#main\n' + id(deck) + '\n#extra\n' + id(ext) + '\n!side\n';
}

// HTML de una sección de la lista lateral: título + "nombre ×copias"
function list(arr, title) {
  let h = '<div class="h">' + title + '</div>';
  [...new Set(arr)].sort((a, b) => a.n.localeCompare(b.n))
    .forEach(c => h += '<div><span>' + c.n + '</span><span>×' + arr.filter(x => x === c).length + '</span></div>');
  return h;
}

// Redibuja toda la pantalla según el estado actual
function render() {
  const d = deck.length, e = ext.length, done = phase === 'done', m = deck.filter(c => c.k === 'm').length;

  // Barra, contadores y qué elementos se muestran
  $('bar').style.width = ((d + e) / (SIZE + XSIZE) * 100) + '%';
  $('n').textContent = d; $('ne').textContent = e;
  $('off').style.display = done ? 'none' : '';
  $('end').style.display = done ? '' : 'none';
  $('sk').style.display = phase === 'extra' ? '' : 'none';   // botón "Terminar Extra"

  // Encabezado
  $('hd').textContent = done ? T.done
    : phase === 'main' ? T.pick(d + 1, SIZE) + ' · ' + T.monsters + ' ' + m + ' · ' + T.spells + ' ' + deck.filter(c => c.k === 's').length + ' · ' + T.traps + ' ' + deck.filter(c => c.k === 't').length
    : T.extraPick(e + 1, XSIZE);

  // Ofertas: un botón por carta (imagen + nombre + etiquetas + texto)
  $('off').innerHTML = '';
  if (!done) offer.forEach(o => {
    const c = o.c, b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = img(c) + '<b>' + c.n + '</b><span class="tag">' +
      (c.p >= STAPLE ? 'Staple ' : '') +                                   // popular en los .ydk
      (c.mx === 1 ? T.limited + ' ' : c.mx === 2 ? T.semi + ' ' : '') +   // banlist GOAT
      (o.s > 0 ? T.synergy + ' ' : '') +                                     // sinergia aprendida de los .ydk
      (o.a ? T.wild : '') +                                 // salió por un slot "opuesto"
      '&nbsp;</span><small class="d">' + (c.desc || '').replace(/</g, '&lt;') + '</small>';
    b.onclick = () => choose(c);
    $('off').appendChild(b);
  });

  // Lista lateral del mazo, agrupada por tipo, más el Extra Deck
  let h = '';
  ['m', 's', 't'].forEach(k => { const a = deck.filter(c => c.k === k); if (a.length) h += list(a, kn(k) + ' (' + a.length + ')'); });
  if (e) h += list(ext, 'Extra Deck (' + e + ')');
  $('dl').innerHTML = h;

  // Pantalla final: el mazo en formato .ydk
  if (done) $('end').innerHTML = '<h2>' + T.endTitle + '</h2><p class="sub">' + T.endHelp + '</p><textarea readonly>' + ydk() + '</textarea>';
}

// Reinicia el draft (también se usa al cargar la página)
function start() { SEENA = {}; DECL = {}; deck = []; ext = []; phase = 'main'; newOffer(); render(); }
// Idioma: aplica los textos fijos del HTML (data-t) y, si ya hay datos, vuelve a dibujar sin tocar el draft
let status = 'loading';   // 'loading' | 'ok' | 'error' (evita pisar el mensaje de error al cambiar de idioma)
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
setLang('en');   // siempre arranca en inglés

$('rs').onclick = start;
$('sk').onclick = () => { phase = 'done'; render(); };   // "Terminar Extra": corta el Extra Deck antes de 15


/* ---------- 8. ARRANQUE ----------
 * Carga cards.json (obligatorio) y rules.json (opcional: si falta o tiene JSON inválido se usan
 * los valores por defecto y NO se aplica ninguna regla, sin mostrar error). */
Promise.all([
  fetch('cards.json').then(r => r.json()),
  fetch('rules.json').then(r => r.json()).catch(() => ({}))
]).then(([j, rl]) => {
  GR = rl._groups || {};
  ENSURE = rl._ensure || [];
  Object.assign(RAR, rl._rarity || {});
  Object.assign(POP, rl._pop || {});
  if (rl._fresh != null) FRESH = +rl._fresh;
  RULES = loadRules(rl);
  C = j.cards.filter(c => !c.ex);   // main
  X = j.cards.filter(c => c.ex);    // extra (fusiones)
  start();
  status = 'ok';
}).catch(() => {
  status = 'error';
  $('hd').textContent = T.loadError;
});
