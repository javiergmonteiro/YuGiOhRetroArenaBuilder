# Arena GOAT v2 — draft por tiers

Esta versión reemplaza la lógica de sinergia y popularidad por **tiers que definís vos** con archivos `.ydk`.
No hay ninguna recomendación automática: lo que llega a las ofertas lo decide un calendario de "premios" y
un pool aleatorio. El armado (el *crafting*) queda 100% en manos del jugador.

Está pensada para vivir en **otra rama** del repositorio: los archivos tienen los mismos nombres que en la v1
(`index.html`, `style.css`, `app.js`, `build_pool.py`), pero la configuración pasa de `rules.json` a `config.json`.

## 1. Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `style.css` | Página y estilos (selector EN \| ES, inglés por defecto). Los tiers tienen colores propios |
| `app.js` | Lógica del draft (calendario de tiers, ofertas, Extra Deck, exportación) |
| `build_pool.py` | Lee `decks/`, arma `cards.json` y descarga las imágenes a `images_hd/` |
| `config.json` | Cuántas cartas de cada tier aparecen por draft (y opciones extra). Se lee al abrir la página |
| `decks/` | Tus `.ydk` (ver sección 2) |
| `cards.json`, `images_hd/` | **Generados** por `build_pool.py` |

## 2. Cómo se cargan los tiers: por nombre de archivo

Poné en `decks/` estos archivos (se aceptan variantes: `Tier_S.ydk`, `tier-s.ydk`, `TIER S.ydk`):

| Archivo | Tier | Idea | Frecuencia por defecto |
|---|---|---|---|
| `tier s.ydk` | **S** | Como una legendaria de Hearthstone, aunque sea limitada o semi-limitada | 1 o 2 por draft, 3 con mucha suerte |
| `tier a.ydk` | **A** | Como las épicas | 4 a 6 por draft |
| `tier b.ydk` | **B** | Cartas poderosas, pero que no querés ver tanto | 6 a 10 por draft |
| **cualquier otro `.ydk`** | **R** | Pool aleatorio, sin sinergia | Resto de las cartas de cada oferta |

- Si una carta está en varios archivos, **gana el tier más alto** (S > A > B > R). Una carta de un tier **no** aparece
  también como aleatoria.
- Cuentan el **main y el extra** de cada archivo (las fusiones de un archivo de tier siguen también la lógica de tiers
  en el Extra Deck, sección 3). El **side deck se ignora**.
- Las **prohibidas de GOAT se descartan** (el script te avisa cuáles). Las limitadas y semi-limitadas respetan su
  máximo de copias (1 o 2) también en los tiers.
- Los archivos tier no necesitan ser mazos reales: son **listas de cartas** (podés armar un `.ydk` con solo las cartas
  que quieras).
- Si falta un archivo de tier, no habrá cartas de ese tier (el script lo avisa).

### Abrir el pool aleatorio (vainillas y cartas "inútiles")
`python build_pool.py --all` agrega al pool aleatorio **todas las cartas legales de GOAT** que no estén en un tier,
vainillas incluidas. Sin `--all`, el pool aleatorio son solo las cartas de tus otros `.ydk`. Con `--all` se
descargan muchas más imágenes (cientos de MB); mirá la sección 6.

## 3. Cómo funciona el draft

1. Al empezar (y al reiniciar) se sortea un **calendario**: cuántos picks traerán una carta de S, de A y de B (según
   `config.json`, limitado a cuántas cartas distintas tiene cada tier) y en **qué picks**, repartidos al azar. Un pick
   tiene como mucho un evento de tier.
2. **Pick con evento:** 1 carta del tier (se prefieren cartas del tier que aún no se ofrecieron en este draft) +
   3 del pool aleatorio. **Pick normal:** 4 del pool aleatorio. Las cartas de tier se muestran con borde de color
   (S dorado con brillo, A violeta, B azul) y la etiqueta "Tier S/A/B".
3. El pool aleatorio es **uniforme** (sin popularidad ni sinergia) con una salvedad: **anti-repetición**. Una carta que se
   ofreció hace poco *descansa* (`cooldown` picks sin volver a salir) y cada vez que se te ofrece y elegís otra pesa menos
   (`penalty`). Siempre se respeta la banlist (copias máximas).
4. Tras 40 picks empieza el **Extra Deck**: hasta 15 picks de 3 fusiones, con **su propio calendario de tiers**
   (`extraTiers` en `config.json`). Por defecto es más exigente: S 0 o 1 vez (50%/50%), A 1 o 2, B 2 a 4. Un pick con evento trae
   1 fusión del tier + 2 del pool aleatorio de fusiones (las de tier R); el resto, 3 aleatorias. Las fusiones ya elegidas
   pesan `1 + extraRepeatBoost × copias` para que las duplicadas salgan más, y las de tier ya ofrecidas pesan ×0,3.
   Botón "Finish Extra" para cortar antes.
5. La **lista lateral** colorea cada carta como su marco real (normal amarillo, efecto naranja, ritual azul, fusión violeta,
   magia verde, trampa magenta), con insignia de atributo (kanji), nivel (★4) y ATK / DEF en los monstruos (`LEVEL_STYLE` en `app.js` cambia ★4 por una estrella por nivel), y el tipo (rápida, continua,
   equipo, campo…) en magias y trampas. Todo sale de los datos de `cards.json`; no hay íconos que descargar.
6. **Gráfico de niveles:** sobre la lista hay un gráfico de barras verticales con los monstruos del main por nivel (1 a 7 y 8+),
   como la curva de maná de Hearthstone. Se actualiza en cada pick.
7. **Vista previa:** al pasar el mouse por una carta de la lista lateral aparece la carta completa junto al cursor. El nombre
   es además un **enlace estático** a su imagen (`images_hd/<id>.jpg`), que se abre en otra pestaña (es lo que se usa en pantallas
   táctiles, donde no existe el hover).
8. Al final se muestra el mazo en formato `.ydk` y cuántas cartas de tier conseguiste.

## 4. `config.json`

```json
{
  "tiers": {
    "S": { "weights": { "1": 0.5, "2": 0.4, "3": 0.1 } },
    "A": { "min": 4, "max": 6 },
    "B": { "min": 6, "max": 10 }
  },
  "extraTiers": {
    "S": { "weights": { "0": 0.5, "1": 0.5 } },
    "A": { "min": 1, "max": 2 },
    "B": { "min": 2, "max": 4 }
  },
  "repeat": { "cooldown": 4, "cooldownExtra": 2, "penalty": 0.6 },
  "balance": { "enabled": false, "monsters": 20, "spells": 10, "traps": 10, "strength": 0.4 },
  "extraRepeatBoost": 0.8
}
```

| Campo | Significado |
|---|---|
| `tiers.X.weights` | Probabilidad de cada **cantidad** de eventos del tier por draft. Ej.: `{"1":0.5,"2":0.4,"3":0.1}` = 50% un evento, 40% dos, 10% tres. Las probabilidades se normalizan |
| `extraTiers.X` | Lo mismo que `tiers.X` pero para los 15 picks del **Extra Deck**. Acepta `weights` o `min`/`max`; el `0` es válido ("a veces no aparece") |
| `tiers.X.min` / `max` | Alternativa: cantidad uniforme entre `min` y `max` |
| `balance.enabled` | `false` = puro azar. `true` = las ofertas aleatorias favorecen levemente el tipo (monstruo/magia/trampa) que te falta |
| `balance.monsters/spells/traps` | Objetivo de composición sobre 40 cartas |
| `balance.strength` | Qué tan fuerte empuja (0,4 ≈ el de la v1). Más bajo = más suave |
| `repeat.cooldown` / `cooldownExtra` | Picks durante los que una carta recién ofrecida no vuelve a salir en el main / en el Extra. Si el pool es chico y no alcanzan cartas descansadas, se usa todo el pool. `0` lo desactiva |
| `repeat.penalty` | Multiplicador de peso por cada vez que la carta se ofreció y no la elegiste (1 = sin penalización; 0,6 = cada rechazo la baja 40%) |
| `extraRepeatBoost` | Boost por copia ya elegida en el Extra Deck |

Si `config.json` falta o tiene un error de sintaxis, se usan los valores por defecto **sin avisar**.
Si una cantidad es mayor que las cartas distintas del tier (en el main o en el Extra), se recorta a esa cantidad. Si no cargaste fusiones
en ningún archivo de tier, el Extra Deck es 100% aleatorio.

## 5. Puesta en marcha

1. `pip install requests`
2. Poné los `.ydk` en `decks/`.
3. `python build_pool.py` (o con `--all`).
4. `python -m http.server` y abrí `http://localhost:8000` (no funciona con doble clic en el HTML).

Publicar: subí `index.html`, `style.css`, `app.js`, `config.json`, `cards.json` e `images_hd/`.

## 6. Imágenes: ¿descargadas o directo desde YGOPRODeck?

Mantenelas **descargadas** y servidas desde tu repositorio o hosting:
- La guía de la API de YGOPRODeck pide descargar las imágenes y hostearlas uno mismo, no enlazarlas. Aunque hoy cargaran
  desde su servidor, pueden bloquearlas o limitarlas, y el juego se rompería sin cambiar nada de tu lado.
- Dependés de su servidor y de su velocidad en cada partida; descargadas, cargan desde tu propio sitio.

Si el tamaño te preocupa (con `--all` pueden ser unos cientos de MB, y GitHub recomienda repos de menos de 1 GB):
- Pasá las imágenes a **WebP**, que suelen pesar bastante menos que el JPG (habría que ajustar la extensión en `app.js` y el script).
- O hospedá las imágenes aparte (por ejemplo en Cloudflare R2 o Pages) y cambiá la ruta `images_hd/` en la función `img` de `app.js`.
- O no uses `--all` y limitá el pool aleatorio a las cartas que realmente querés.

## 7. Qué se quitó respecto a la v1

Sinergia por co-ocurrencia, perfiles de composición, popularidad (`p`), reglas condicionales (`rules.json`), staples
garantizadas, rareza por banlist, garantía de piezas (Exodia), penalización por rechazos y slots "opuestos".
Si querés recuperar alguno, está en la rama de la v1.

## 8. Ideas pendientes

- Draftear 55–60 cartas y **recortar a 40** al final (devuelve el crafting).
- Elegir un **ancla** (carta central) al principio.
- **Modificadores** por partida ("sin tier S", "solo limitadas", "un solo atributo").
- Vetos antes de empezar y semilla compartida entre amigos.
- Simulador de drafts para medir variedad.

Datos e imágenes de [YGOPRODeck](https://ygoprodeck.com). Yu-Gi-Oh! es propiedad de Konami; proyecto de fans sin fines de lucro.
