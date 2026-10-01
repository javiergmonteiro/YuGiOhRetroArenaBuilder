#!/usr/bin/env python3
"""Genera cards.json + images/ para Arena GOAT.

Uso:  pip install requests && python build_pool.py
Opcional: poné mazos .ydk del formato en la carpeta decks/ para calcular
popularidad (p) y sinergias reales (co). Sin mazos, todo queda con peso parejo.
"""
import collections, glob, itertools, json, os, time, requests

API = "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=goat"
LIM = {"Forbidden": 0, "Limited": 1, "Semi-Limited": 2}
os.makedirs("images_hd", exist_ok=True)
os.makedirs("decks", exist_ok=True)

data = requests.get(API, timeout=60).json()["data"]
cards, alias, urls = {}, {}, {}
for c in data:
    mx = LIM.get(c.get("banlist_info", {}).get("ban_goat"), 3)
    if mx == 0:  # prohibida en GOAT
        continue
    t = c["type"]
    im = c["card_images"][0]
    cards[c["id"]] = dict(
        id=c["id"], n=c["name"], k="m" if "Monster" in t else "s" if "Spell" in t else "t",
        ty=t, lv=c.get("level"), a=c.get("atk"), d=c.get("def"), mx=mx,
        ex="Fusion" in t, img=im["id"], desc=c.get("desc", ""), r=c.get("race"), at=c.get("attribute"), p=0, co={})
    urls[c["id"]] = im["image_url"]  # resolución completa (~421x614)
    for x in c["card_images"]:
        alias[x["id"]] = c["id"]

# --- popularidad y co-ocurrencia a partir de los .ydk ---
N, n, co = 0, collections.Counter(), collections.defaultdict(collections.Counter)
prof = collections.defaultdict(lambda: [0.0, 0.0, 0.0])  # suma de composición (m, s, t) de los mazos donde aparece
for f in glob.glob("decks/*.ydk"):
    ids, sec, mainl = set(), "", []
    for l in open(f, encoding="utf-8", errors="ignore"):
        l = l.strip()
        if l.startswith(("#", "!")):
            sec = l
            continue
        if l.isdigit() and sec != "!side" and alias.get(int(l)) in cards:
            ids.add(alias[int(l)])
            if sec == "#main":
                mainl.append(alias[int(l)])
    if not ids:
        continue
    N += 1
    n.update(ids)
    if mainl:
        v = [sum(cards[i]["k"] == k for i in mainl) / len(mainl) for k in "mst"]
        for i in ids:
            prof[i] = [a + b for a, b in zip(prof[i], v)]
    main = [i for i in ids if not cards[i]["ex"]]
    for a, b in itertools.permutations(main, 2):
        co[a][b] += 1
    for a in ids:  # fusión -> cartas del main con las que suele jugarse
        if cards[a]["ex"]:
            for b in main:
                co[a][b] += 1

if not N:
    raise SystemExit("No hay mazos .ydk en decks/. Ponelos ahí y volvé a correr el script.")

# El pool = solo las cartas que aparecen en algún .ydk (main o extra)
cards = {i: c for i, c in cards.items() if n[i] > 0}

for i, c in cards.items():
    if N:
        c["p"] = round(n[i] / N, 3)
    c["pn"] = n[i]
    if n[i] >= 3:  # perfil: fracción media de monstruos/magias/trampas de los mazos que la juegan
        c["prof"] = [round(x / n[i], 3) for x in prof[i]]
    # lift = cuánto más seguido aparecen juntas que por azar
    c["co"] = {b: round(k * N / (n[i] * n[b]), 2) for b, k in co[i].most_common(40) if k >= 2}

# Extra Deck fijo: fusiones más usadas (o las de mayor nivel si no hay mazos)
fx = sorted((c for c in cards.values() if c["ex"]), key=lambda c: (-c["p"], -(c["lv"] or 0)))
extra = [c["id"] for c in fx[:15]]

with open("cards.json", "w", encoding="utf-8") as fh:
    json.dump({"cards": list(cards.values()), "extra": extra, "decks": N}, fh, ensure_ascii=False)
print(f"{len(cards)} cartas en el pool, {N} mazos analizados")

# --- imágenes (YGOPRODeck pide descargarlas y hostearlas, no hotlinkear) ---
for i, c in cards.items():
    path = f"images_hd/{c['img']}.jpg"
    if os.path.exists(path):
        continue
    r = requests.get(urls[i], timeout=30)
    if r.ok:
        open(path, "wb").write(r.content)
    time.sleep(0.1)  # el límite es 20 req/s
print("listo")
