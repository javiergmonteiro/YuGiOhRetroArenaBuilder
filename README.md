# Arena GOAT

Un draft estilo **Arena de Hearthstone** para Yu-Gi-Oh! con el pool del formato **GOAT** (hasta abril de 2005).
El jugador elige carta por carta hasta armar un main de 40 y un Extra Deck de hasta 15. Las ofertas no son
totalmente aleatorias: se inclinan hacia lo que ya elegiste (sinergia), respetan el equilibrio
monstruos/magias/trampas y hacen que las cartas más fuertes de la banlist sean "raras".

Es una página **estática** (HTML + CSS + JS, sin servidor propio). Los datos los genera un script de Python
una sola vez a partir de mazos `.ydk`.

---

## 1. Estructura de archivos

| Archivo / carpeta | Qué es | ¿Lo editás? |
|---|---|---|
| `index.html` | Estructura de la página (títulos, contenedores, botones, selector de idioma EN \| ES). Siempre arranca en inglés | Raramente |
| `style.css` | Estilos, colores y diseño responsive | Para cambiar el aspecto |
| `app.js` | Toda la lógica del draft y los textos de la interfaz en español/inglés (diccionario `TT`, sección 0; el selector EN/ES cambia el idioma sin recargar y conserva el draft) | Para cambiar el algoritmo o los textos |
| `rules.json` | Reglas manuales y parámetros de balance (ver sección 6) | **Sí, seguido** |
| `build_pool.py` | Script que arma `cards.json` e `images_hd/` | Raramente |
| `decks/` | Tus mazos `.ydk` (la fuente de popularidad y sinergia) | **Sí, seguido** |
| `cards.json` | Pool de cartas con popularidad, sinergias y perfiles. **Generado** | No (se regenera) |
| `images_hd/` | Imágenes de las cartas. **Generado** | No |

`cards.json` e `images_hd/` se generan con `build_pool.py`. `rules.json` se lee en el navegador cada vez que
abrís la página, así que **cambiar `rules.json` no requiere volver a correr el script**; cambiar `decks/` sí.

---

## 2. Puesta en marcha

### Requisitos
Python 3 y la librería `requests` (`pip install requests`). Un navegador moderno.

### Pasos
1. Poné tus mazos `.ydk` en la carpeta `decks/` (ver sección 5 para qué conviene cargar).
2. Corré `python build_pool.py` desde la carpeta del proyecto. Esto:
   - descarga de YGOPRODeck la lista de cartas legales en GOAT (`format=goat`) con su estado en la banlist;
   - lee los `.ydk`, calcula popularidad, sinergias y perfiles;
   - se queda **solo con las cartas que aparecen en algún `.ydk`** (ese es el pool del juego);
   - escribe `cards.json` y descarga las imágenes a `images_hd/` (las que ya existen se saltean).
3. Abrí la página con un servidor local: `python -m http.server` y entrá a `http://localhost:8000`.
   (Abrir `index.html` directo con doble clic **no funciona**: el navegador bloquea la lectura de los JSON desde `file://`).

### Publicarla (GitHub Pages u otro)
Subí `index.html`, `style.css`, `app.js`, `cards.json`, `rules.json` e `images_hd/`. Las rutas son relativas, así que
funciona en `usuario.github.io/repo/`. Si `images_hd/` tiene más de 100 archivos, subila con `git` o GitHub Desktop
(la subida por la web tiene ese límite). `build_pool.py` y `decks/` no hacen falta online.
Para actualizar: corré el script en tu máquina y volvé a subir `cards.json` y las imágenes nuevas.

---

## 3. Resumen de una partida

1. **Main (40 picks):** en cada pick se ofrecen **4 cartas**, de las que elegís 1.
2. **Extra Deck (hasta 15 picks):** al completar el main, se ofrecen **3 fusiones** por pick. El botón
   "Terminar Extra" corta antes de las 15.
3. **Final:** se muestra el mazo en formato `.ydk` para copiarlo e importarlo en un simulador.

Etiquetas que aparecen bajo cada carta:

| Etiqueta | Significa |
|---|---|
| Staple | Aparece en al menos el 30% de tus mazos de `decks/` |
| Limitada / Semi-limitada | Estado en la banlist GOAT (máximo 1 o 2 copias) |
| ★ sinergia | Va bien con cartas que ya elegiste **según los `.ydk`** (no según `rules.json`) |
| ✦ fuera de lo común | Salió por uno de los dos slots "opuestos" (poco usada, sin sinergia) |

---

## 4. Cómo arma las ofertas el algoritmo (`app.js`)

Todo ocurre en la función `newOffer()`. Cada carta recibe un **peso** y se sortea con probabilidad proporcional
a ese peso. Las 4 cartas del main salen de 4 sorteos distintos:

| Slot | Candidatas | Peso base | Para qué sirve |
|---|---|---|---|
| 1 · Staple | Cartas con popularidad ≥ 0,30 | `p^γ` dentro de una clase de banlist sorteada antes | Que siempre haya algo útil, con rareza por banlist |
| 2 · Sinergia | Todo el pool | `(0,03 + 6·p^γ) · (1 + 0,7·sinergia)` | Empujar lo que combina con tu mazo |
| 3 y 4 · Opuestas | Todo el pool | `(1 − p)^6 / (1 + sinergia)` | Cartas raras que dan sensación de armar algo distinto |

`p` es la popularidad (fracción de mazos que la usan) y `γ` es `_pop.gamma` (ver sección 6.7).
Después del sorteo, la oferta se baraja para que el orden no delate de qué slot salió cada carta.

### Multiplicadores que se aplican al peso (slots 1 y 2)

El peso final es `peso base × W`, donde `W` es el producto de:

1. **Equilibrio** (`bal`): el mazo apunta a un objetivo de composición (base **20 monstruos / 10 magias / 10 trampas**
   sobre 40). Si te faltan cartas de un tipo respecto al objetivo proporcional al pick actual, ese tipo pesa más
   (hasta ×6); si te sobran, pesa menos (hasta ×0,1). Fórmula: `exp(0,4 · (objetivo·pick/40 − actuales))`.
   Además hay un **tope duro**: no se ofrecen más cartas de un tipo si ya tenés `objetivo + 10` (mientras queden
   al menos 3 opciones de otros tipos).
2. **Repetidas no-monstruo:** cada copia que ya tenés de una magia/trampa la multiplica por **0,45**. Los monstruos
   no se penalizan (se juegan de a 3).
3. **Reglas de `rules.json`** (`ruleMult`): multiplicadores condicionales (sección 6).
4. **Perfil de composición** (`profMult`): entre ×0,4 y ×1,6 según si tu mazo se parece, en proporción de
   monstruos/magias/trampas, a los mazos donde aparece la carta (sección 5.4).
5. **Rareza** (`rm`): las staples limitadas/semi-limitadas pesan menos (`mulL`, `mulS`).
6. **Frescura** (`fr`): cada vez que una carta se te ofreció y elegiste otra, pesa `_fresh` veces menos
   por el resto del draft (0,7 por defecto). Evita ver diez veces la misma carta que rechazás.

Los **slots 3 y 4 (opuestas)** solo usan equilibrio, repetidas y frescura: ignoran reglas, perfil y rareza a propósito.

### Rareza por banlist (slot 1)
Antes de elegir la staple se sortea su clase: limitada con probabilidad `lim`, semi-limitada con `semi`, y libre
el resto (por defecto 15% / 40% / 45%; en tu `rules.json` pueden ser otros). Si esa clase no tiene cartas
disponibles se prueba la siguiente. Solo cuenta para **staples**: una limitada poco usada no se penaliza, porque
ya sale poco por su baja popularidad.

### Garantías (`_ensure`)
Si elegís una carta de un grupo garantizado (por ejemplo una pieza de Exodia), las demás **se ofrecen al menos una
vez** antes de terminar el main. Es un "pity timer": cada pick hay una probabilidad (`1,5 × pendientes / picks restantes`,
con tope 50%) de forzar una pendiente en lugar de la última carta de la oferta; cuando quedan tantos picks como
pendientes, la probabilidad es 100%. Ofrecer no es obligar a tomar: si la rechazás no se vuelve a forzar. Solo
funciona con cartas que estén en el pool (en algún `.ydk`).

### Fase Extra Deck
Ofrece 3 cartas (staple, sinergia y relleno). Las ya elegidas pesan **×(1 + 0,8 × copias)**, para que se repitan
más que en el main (las duplicadas suelen servir). No se aplican reglas, equilibrio ni rareza.

### Constantes del código
Los valores de ajuste fino están en el código y comentados en `app.js`. Los más útiles:

| Qué | Dónde | Valor |
|---|---|---|
| Tamaños del mazo | `SIZE`, `XSIZE` | 40 y 15 |
| Umbral de staple | `STAPLE` | 0,3 |
| Objetivo base de composición | `target()` | 20 / 10 / 10 |
| Fuerza del equilibrio | `bal` | coeficiente 0,4, rango 0,1–6 |
| Tope duro por tipo | `newOffer()` | objetivo + 10 |
| Penalización de repetidas | `W` / `W2` | 0,45 por copia |
| Fuerza de la sinergia | slot 2 | `1 + 0,7·sinergia` |
| Exponente de las opuestas | slots 3 y 4 | 6 |
| Boost de repetidas en el Extra | `W` | 0,8 por copia |

---

## 5. Cómo se usan los archivos `.ydk` (popularidad y sinergia)

Esta es la parte más importante: **la calidad de las recomendaciones depende de los mazos que pongas en `decks/`**.
El script `build_pool.py` extrae de ellos cuatro cosas.

### 5.1 El pool
El pool del juego son **únicamente las cartas que aparecen en algún `.ydk`** (en el main o en el extra) y que además
son legales en GOAT. Las cartas prohibidas se descartan (aunque estén en un mazo) y las limitadas/semi-limitadas
quedan con máximo 1 o 2 copias. Una carta que no está en ningún `.ydk` **no puede aparecer**, por muy buena que sea.
Si querés sumar cartas, armá un `.ydk` manual que las incluya.

El **side deck se ignora**.

### 5.2 Popularidad (`p`)
`p` = fracción de mazos que incluyen la carta (si está en 80 de 100 mazos, `p = 0,8`). Se cuenta **presencia, no
copias**: una carta que va de a 1 pesa igual que una que va de a 3. Se usa para:
- decidir qué es una **staple** (`p ≥ 0,3`),
- el peso de aparición (comprimido con `_pop.gamma`),
- decidir qué opuestas son "raras" (cuanto menor `p`, más probable).

Si un mismo mazo aparece 30 veces en tu carpeta (varias listas casi idénticas), su arquetipo infla la popularidad.
Conviene variar los arquetipos y evitar copias.

### 5.3 Sinergia (`co`) — cómo "sabe" qué combina con qué
Para cada par de cartas del **main** que aparecen juntas en un mazo, el script cuenta las coincidencias. Con eso calcula
el **lift**:

```
lift(A, B) = (mazos con A y B) × (total de mazos) / ((mazos con A) × (mazos con B))
```

- Lift 1 = aparecen juntas lo mismo que por azar; 3 = el triple de seguido; menos de 1 = se evitan.
- Solo se guardan las parejas que coinciden en **al menos 2 mazos**.
- Por carta se guardan las **40 parejas con más coincidencias** (se ordenan por cantidad de mazos en común, no por lift).
- Las fusiones (Extra Deck) se relacionan con las cartas del main de los mazos donde aparecen, para que el Extra
  Deck se ofrezca según lo que armaste.

Durante el draft, la sinergia de una candidata es la suma, sobre cada carta **distinta** que ya elegiste, de
`min(lift, 5) − 1` (solo cuando el lift es mayor a 1), con un **tope total de 8**. Ese valor:
- multiplica el peso del slot 2 por `1 + 0,7 × sinergia` (hasta ×6,6),
- reduce el peso en los slots opuestos (`1 / (1 + sinergia)`),
- activa la etiqueta **★ sinergia** cuando es mayor que 0.

Por qué funciona: si elegís Gravekeeper's Spy y en tus mazos los Gravekeeper's aparecen juntos, esas cartas tendrán
lift alto con ella y empezarán a aparecer más. No hay etiquetas de arquetipo escritas a mano: todo sale de los datos.

**Límites a tener en cuenta:**
- Con pocos mazos (menos de ~50) los números son ruidosos: una pareja vista en 2 mazos puede tener un lift enorme por casualidad.
- Un arquetipo que aparece en muy pocos mazos casi no genera sinergia aprendida. Para esos casos están las reglas manuales (sección 6).
- La sinergia aprendida mira **parejas**, no combos de 3 o más cartas.
- Cambiar `decks/` exige volver a correr `build_pool.py`.

### 5.4 Perfil de composición (`prof`)
Para cada carta que aparece en al menos 3 mazos, el script guarda la fracción media de monstruos/magias/trampas
del main de esos mazos. Durante el draft, si tu mazo actual se parece a ese perfil, la carta pesa más (hasta ×1,6);
si no, menos (hasta ×0,4). La influencia crece hasta el pick 20. Sirve, por ejemplo, para que Royal Decree aparezca
más cuando llevás pocas trampas, sin escribir una regla.

### 5.5 Campo `extra` de `cards.json`
`cards.json` incluye una lista `extra` (las 15 fusiones más usadas). Es un resto de una versión anterior con Extra Deck
fijo; la página actual **no la usa** (el Extra Deck ahora se elige).

### 5.6 Qué mazos conviene cargar
- Muchos (100 o más) y de arquetipos distintos (Goat Control, Chaos, Warriors, Gravekeepers, Zombies, Exodia…).
- Mazos reales y completos, con main y extra.
- Algún `.ydk` manual con cartas poco usadas que te interesen: cuentan como un mazo más (su `p` será baja), lo que
  alcanza para que aparezcan de vez en cuando.

---

## 6. `rules.json` en detalle

`rules.json` es un objeto JSON con tres clases de claves: **claves reservadas** (empiezan con `_`), **reglas por carta o
grupo** y **reglas por selector**. Se lee al abrir la página; no hace falta correr el script.

> **Importante:** si el JSON tiene un error de sintaxis (una coma de más, comilla faltante), la página lo ignora
> **en silencio** y todas las reglas quedan desactivadas. Validalo en cualquier validador de JSON o mirá la consola
> del navegador (F12) si algo "dejó de funcionar".

### 6.1 Claves reservadas

| Clave | Para qué | Ejemplo |
|---|---|---|
| `_groups` | Define grupos de cartas con nombre | `"zombies": ["Ryu Kokki", "Pyramid Turtle"]` |
| `_rarity` | Rareza por banlist | `{ "lim": 0.1, "semi": 0.3, "mulL": 0.2, "mulS": 0.5 }` |
| `_pop` | Compresión de popularidad | `{ "gamma": 0.5 }` |
| `_fresh` | Penalización por oferta rechazada | `0.7` |
| `_ensure` | Grupos que deben aparecer completos | `[ { "group": "exodia" } ]` |

### 6.2 Grupos (`_groups`)
Un grupo es **solo una lista con nombre** (un atajo). Por sí solo **no cambia ninguna probabilidad**: tiene que usarse
en una regla de alguna de estas formas:
- como **clave** de una regla (`"@zombies": { ... }`): la regla se aplica a cada carta del grupo;
- dentro de un **`has`** (`"has": ["@zombies"]`): condición "ya tengo alguna carta del grupo";
- en **`_ensure`**: garantiza que aparezcan todas.

Se referencia siempre con `@` + el nombre exacto del grupo. **Un nombre de grupo mal escrito** (por ejemplo `@zombie`
cuando el grupo se llama `zombies`) no da error: se expande a una lista vacía y la regla no hace nada.

### 6.3 Reglas por carta o grupo
La clave puede ser:
- el **nombre exacto de la carta en inglés**, tal como lo devuelve YGOPRODeck: `"Royal Decree"`;
- un **grupo**: `"@gravekeepers"` (equivale a repetir la regla para cada miembro).

Si una carta recibe varias reglas (por nombre, por grupo y por selector), **se aplican todas**. Una regla tiene dos
campos opcionales:

```json
"Royal Decree": {
  "shift": { "trap": -4, "monster": 2, "spell": 2 },
  "when":  [ { "trap": "<=5", "x": 4 }, { "trap": ">=9", "x": 0.1 } ]
}
```

#### `shift` — cambia el objetivo de composición
Suma (o resta) cartas al objetivo base de 20 monstruos / 10 magias / 10 trampas. Claves: `monster`, `spell`, `trap`.
- Se aplica **una vez por carta distinta que ya elegiste** (no por copia).
- **En grupos grandes puede acumularse mucho:** `"@agro": {"shift": {"monster": 4}}` con 10 cartas elegidas suma +40.
  En grupos usá valores de 1, o ponelo solo en una carta clave.
- Mínimos aplicados: 6 monstruos, 0 magias, 0 trampas. El objetivo no se renormaliza a 40.
- Efecto: cambia qué tipo "falta" y por lo tanto el multiplicador de equilibrio (sección 4).

#### `when` — multiplicadores condicionales
Lista de condiciones; cada una tiene sus requisitos y un **`x`** (el multiplicador del peso de esa carta).
- Dentro de **una misma entrada**, todas las condiciones deben cumplirse (**Y**).
- Entre **entradas distintas** de `when`, cada una que se cumple multiplica por su `x` (se **acumulan**).
- **`x` es obligatorio.** Si falta, el peso queda en `NaN` y las ofertas se rompen.
- `x` mayor que 1 favorece; menor que 1 desfavorece (0,1 la vuelve casi imposible). Es un multiplicador del peso,
  **no de la probabilidad**: su efecto real depende de cuántas cartas compiten.

Condiciones disponibles:

| Condición | Se cumple cuando… | Notas |
|---|---|---|
| `"monster"`, `"spell"`, `"trap"` con una expresión (`"<=5"`) | La cantidad **proyectada a 40** de ese tipo cumple la expresión | Proyección = `actuales / picks × 40`. **Solo se evalúa desde el pick 12**; antes la condición es falsa |
| `"has": ["Carta", "@grupo"]` | Tenés en el main **al menos una** de esas cartas (o de los grupos) | Se cumple con una sola; no cuenta cantidad. Mira solo el main |
| `"copies": ">=1"` | Ya elegiste esa cantidad de copias **de la propia carta** | Sirve para reclutadores: segunda y tercera copia |

Expresiones: operadores `<=`, `>=`, `==`, `<`, `>` seguidos de un **entero** (sin decimales). Ejemplos: `"<=5"`, `">=9"`, `"==2"`.

Ejemplos:

```json
"Jinzo": { "when": [ { "trap": "<=6", "x": 2 }, { "trap": ">=12", "x": 0.3 } ] }
```
Jinzo pesa ×2 si proyectás 6 trampas o menos y ×0,3 si proyectás 12 o más.

```json
"@recruiters": { "when": [ { "copies": ">=1", "x": 3 }, { "copies": ">=2", "x": 1.5 } ] }
```
Con 1 copia, la siguiente pesa ×3; con 2 copias, ×4,5 (se multiplican las dos entradas).

```json
"@tribute_monsters": { "when": [ { "has": ["@control"], "x": 3 } ] }
```
Los monstruos que tributan pesan ×3 si ya tenés alguna carta de control (Brain Control, etc.).

### 6.4 Reglas por selector (`#...`)
Una clave que empieza con `#` se aplica a **todas las cartas del pool que cumplan el selector**, sin nombrarlas.
Se pueden combinar varias pruebas separadas por coma (todas deben cumplirse):

| Prueba | Coincide con… | Ejemplo |
|---|---|---|
| `race:Texto` | Raza/tipo exacto de la API | `race:Beast`, `race:Zombie`, `race:Beast-Warrior` |
| `attr:Texto` | Atributo exacto | `attr:DARK` |
| `type:Texto` | Tipo que **contiene** el texto | `type:Fusion` |
| `lv<=N`, `lv>=N`, `lv==N` | Nivel (solo monstruos) | `lv<=3` |

```json
"#race:Beast":       { "when": [ { "has": ["Rescue Cat"], "x": 2 } ] },
"#race:Beast,lv<=3": { "when": [ { "has": ["Rescue Cat"], "x": 3 } ] }
```
Con Rescue Cat elegida: las bestias pesan ×2 y las bestias de nivel 3 o menos ×6 (coinciden con ambas).
Un selector necesita que `cards.json` tenga `r` (raza) y `at` (atributo): salen de `build_pool.py`.

### 6.5 Rareza por banlist (`_rarity`)

| Campo | Significado | Por defecto |
|---|---|---|
| `lim` | Probabilidad de que la staple del slot 1 sea **limitada** | 0,15 |
| `semi` | Probabilidad de que sea **semi-limitada** | 0,40 |
| `mulL` | Multiplicador de peso para staples limitadas en el slot 2 | 0,3 |
| `mulS` | Multiplicador para staples semi-limitadas en el slot 2 | 0,6 |

El resto (`1 − lim − semi`) es la probabilidad de staple libre. Los porcentajes miden **la staple del slot 1**, no
el mazo final. Para hacer las limitadas más raras, bajá `lim` y `mulL`.

### 6.6 Garantías (`_ensure`)
Lista de objetos `{ "group": "nombre" }`. Cuando elegís una carta de ese grupo, las demás del grupo se ofrecen al menos
una vez (ver sección 4). Cada grupo debe existir en `_groups`.

### 6.7 Control de repetición: `_pop` y `_fresh`
- **`_pop.gamma`** comprime la popularidad: el peso usa `p^gamma`. Con `1` las cartas muy usadas pesan mucho más que
  las demás; con `0,5` bastante menos; con `0` todas pesan igual. Bajalo si ves siempre las mismas staples.
- **`_fresh`** multiplica el peso de una carta por ese valor cada vez que se te ofreció y la rechazaste. `1` lo
  desactiva; `0,5` es más fuerte.

### 6.8 Dónde se aplican las reglas

| | Slot 1 (staple) | Slot 2 (sinergia) | Slots 3-4 (opuestas) | Extra Deck |
|---|---|---|---|---|
| Reglas `when` / `shift` | Sí | Sí | **No** | No |
| Rareza (`_rarity`) | Sí (reparto de clases) | Sí (`mulL`/`mulS`) | No | No |
| `_pop`, `_fresh` | Sí | Sí | Solo `_fresh` | No |

Las reglas actúan sobre el **peso**: no pueden hacer aparecer una carta que no esté en el pool (no hay `.ydk` que la contenga).
La etiqueta **★ sinergia** sale solo de los `.ydk`; una carta empujada por una regla puede aparecer sin ella.

### 6.9 Errores frecuentes

| Síntoma | Causa probable |
|---|---|
| Ninguna regla funciona | JSON inválido (coma, comilla). Se ignora todo sin avisar |
| Una regla de grupo no hace nada | Nombre del grupo mal escrito en la clave o en `has` (`@zombie` vs `zombies`) |
| Una regla de carta no hace nada | Nombre distinto al de YGOPRODeck, o la carta no está en ningún `.ydk` |
| Ofertas raras o rotas | Falta `x` en una condición |
| Dos reglas se pisan | Clave repetida en el JSON: la segunda reemplaza a la primera. Ponelas juntas dentro del mismo `when` |
| El mazo sale muy desbalanceado | `shift` acumulándose en un grupo grande |
| Una carta pesa demasiado | Reglas apiladas (por nombre, por grupo y por selector se multiplican entre sí) |

---

## 7. Problemas comunes

- **"No se pudo cargar cards.json":** falta correr `build_pool.py`, o abriste el HTML con doble clic. Usá `python -m http.server`.
- **`UnicodeEncodeError` en Windows:** el script ya escribe en UTF-8; si pasa de nuevo, actualizá `build_pool.py`.
- **"No hay mazos .ydk en decks/":** el script se detiene a propósito si la carpeta está vacía.
- **Imágenes que no cargan:** se ocultan en vez de mostrar un ícono roto. Revisá que `images_hd/` esté junto a `index.html`.
- **Pocas opciones o draft repetitivo:** el pool es chico; cargá más mazos o `.ydk` manuales.

---

## 8. Ideas pendientes

- Simulador de drafts (miles de partidas automáticas) para medir variedad y coherencia en vez de ajustar a ojo.
- Slot "dormida": carta poco popular pero con sinergia alta con tu mazo.
- Arco del draft: más caos al inicio, más sinergia en el medio, relleno de huecos al final.
- Elección de arquetipo al comienzo, como el héroe de Hearthstone.
- Popularidad relativa al arquetipo, ponderada por resultados y por cantidad de copias.
- Efectos visuales para limitadas/semi-limitadas y un resumen final del mazo.

---

## 9. Créditos y aviso

Datos e imágenes de cartas: [YGOPRODeck](https://ygoprodeck.com) (API y buenas prácticas: descargar y hostear las imágenes,
no enlazarlas). Yu-Gi-Oh! y sus cartas son propiedad de Konami. Este es un proyecto de fans, sin fines de lucro.
