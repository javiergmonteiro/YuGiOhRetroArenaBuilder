#!/usr/bin/env python3
"""Arena GOAT v2 — genera cards.json + images_hd/ a partir de los .ydk de decks/.

Uso:   pip install requests
       python build_pool.py          # pool = cartas que aparecen en algún .ydk
       python build_pool.py --all    # pool aleatorio = TODAS las cartas legales de GOAT (vainillas incluidas)

Cómo se asigna el tier de cada carta (según el NOMBRE del archivo .ydk donde aparece):
    tier s.ydk  -> S        tier a.ydk -> A        tier b.ydk -> B
    cualquier otro .ydk -> R (pool aleatorio)
Si una carta está en varios archivos gana el tier más alto (S > A > B > R).
Se aceptan variantes del nombre: "Tier_S.ydk", "tier-s.ydk", "TIER S.ydk"...
"""
import collections, glob, json, os, re, sys, time, requests

ALL = "--all" in sys.argv
API = "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=goat"
LIM = {"Forbidden": 0, "Limited": 1, "Semi-Limited": 2}   # copias máximas según la banlist GOAT
RANK = {"S": 0, "A": 1, "B": 2, "R": 3}
TIER_FILES = {"tiers": "S", "tiera": "A", "tierb": "B"}
os.makedirs("images_hd", exist_ok=True)
os.makedirs("decks", exist_ok=True)

data = requests.get(API, timeout=60).json()["data"]
cards, alias, urls, names, forbidden = {}, {}, {}, {}, set()
for c in data:
    names[c["id"]] = c["name"]
    for x in c["card_images"]:
        alias[x["id"]] = c["id"]                      # ids de arte alternativo -> id principal
    mx = LIM.get(c.get("banlist_info", {}).get("ban_goat"), 3)
    if mx == 0:                                       # prohibida en GOAT: no entra al juego
        forbidden.add(c["id"])
        continue
    t = c["type"]
    im = c["card_images"][0]
    cards[c["id"]] = dict(
        id=c["id"], n=c["name"], k="m" if "Monster" in t else "s" if "Spell" in t else "t",
        ty=t, lv=c.get("level"), a=c.get("atk"), d=c.get("def"), mx=mx, ex="Fusion" in t,
        img=im["id"], desc=c.get("desc", ""), r=c.get("race"), at=c.get("attribute"), t="")
    urls[c["id"]] = im["image_url"]                   # resolución completa (~421x614)


def file_tier(path):
    key = re.sub(r"[^a-z]", "", os.path.splitext(os.path.basename(path))[0].lower())
    return TIER_FILES.get(key, "R")


files = collections.Counter()
dropped = collections.defaultdict(set)
for f in sorted(glob.glob("decks/*.ydk")):
    tier = file_tier(f)
    files[tier] += 1
    sec = ""
    for l in open(f, encoding="utf-8", errors="ignore"):
        l = l.strip()
        if l.startswith(("#", "!")):
            sec = l
            continue
        if not l.isdigit() or sec == "!side":         # el side deck se ignora
            continue
        i = alias.get(int(l))
        if i in forbidden:
            dropped[tier].add(names[i])
            continue
        if i in cards and (not cards[i]["t"] or RANK[tier] < RANK[cards[i]["t"]]):
            cards[i]["t"] = tier                      # gana el tier más alto

if ALL:                                               # pool aleatorio abierto: todo lo demás es tier R
    for c in cards.values():
        if not c["t"]:
            c["t"] = "R"

pool = {i: c for i, c in cards.items() if c["t"]}
if not pool:
    raise SystemExit("No hay cartas: poné archivos .ydk en decks/ (tier s.ydk, tier a.ydk, tier b.ydk y otros) o usá --all.")

per = collections.Counter((c["t"], c["ex"]) for c in pool.values())
for t in "SABR":
    print(f"Tier {t}: {per[(t, False)]} cartas de main + {per[(t, True)]} del Extra  ({files[t]} archivo/s)")
for t in "SAB":
    if not files[t]:
        print(f"AVISO: no existe 'tier {t.lower()}.ydk': no habrá cartas de tier {t}.")
for t, ns in dropped.items():
    print(f"AVISO: prohibidas en GOAT, ignoradas (tier {t}): {', '.join(sorted(ns))}")

with open("cards.json", "w", encoding="utf-8") as fh:
    json.dump({"cards": list(pool.values())}, fh, ensure_ascii=False)

# Imágenes: YGOPRODeck pide descargarlas y hostearlas (no enlazarlas). Las ya descargadas se saltean.
for i in pool:
    path = f"images_hd/{pool[i]['img']}.jpg"
    if os.path.exists(path):
        continue
    r = requests.get(urls[i], timeout=30)
    if r.ok:
        open(path, "wb").write(r.content)
    time.sleep(0.1)                                   # límite de la API: 20 req/s
print("listo")
