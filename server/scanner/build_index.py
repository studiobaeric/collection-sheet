"""Vergleichsdatenbank (Index) aus allen englischen Karten von tcgdex bauen oder um neue Karten ergänzen.

    python -m scanner.build_index          einmal (fehlende Karten nachtragen)
    python -m scanner.build_index --loop   sofort, danach einmal pro Woche (Dienst „index“ in docker-compose.yml)

Das Motiv ist auf deutschen und englischen Karten gleich und die tcgdex-IDs gelten für alle Sprachen, deshalb reicht
der englische Katalog. Die Kartenbilder werden nur zum Rechnen geladen, gespeichert werden nur die Vektoren.
"""
import json
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
import requests

from . import vision

API = 'https://api.tcgdex.net/v2/en/'
DATA = os.environ.get('DATA_DIR', '/data')
INDEX = os.path.join(DATA, 'index.npz')
POCKET_SET = re.compile(r'^(?:[AB]\d+[a-z]?|P-[A-Z])$')  # TCG Pocket (digital), wie POCKET_SET_RE in Code.gs
WEEK = 7 * 24 * 3600
log = logging.getLogger('index')


def get_json(url):
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def get_image(url):
    try:
        r = requests.get(url, timeout=60)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    return cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)


def load(path=INDEX):
    """-> {'vectors': (N, D) float32, 'meta': [..]} oder None"""
    if not os.path.exists(path):
        return None
    with np.load(path, allow_pickle=False) as z:
        return {'vectors': z['vectors'].astype(np.float32), 'meta': json.loads(str(z['meta']))}


def save(index, path=INDEX):
    tmp = path + '.tmp.npz'
    np.savez(tmp, vectors=index['vectors'].astype(np.float16), meta=np.array(json.dumps(index['meta'])))
    os.replace(tmp, path)  # der Server sieht nie eine halbe Datei


def catalog(get=get_json):
    """Alle Karten mit Bild -> [{id, localId, name, setId, setName, official, image}]"""
    out = []
    for s in get(API + 'sets'):
        if POCKET_SET.match(s['id']):
            continue
        full = get(API + 'sets/' + s['id'])
        official = (full.get('cardCount') or {}).get('official')
        for c in full.get('cards') or []:
            if c.get('image'):  # shortcut: Karten ohne Bild bei tcgdex fehlen (Lücken aus pokemontcg.io füllen: Issue)
                out.append({'id': c['id'], 'localId': str(c.get('localId', '')), 'name': c.get('name', ''),
                            'setId': s['id'], 'setName': full.get('name', s.get('name', '')),
                            'official': official, 'image': c['image']})
    return out


def update(embed, get=get_json, fetch=get_image, path=INDEX, batch=32):
    """Fehlende Karten nachtragen -> Zahl der neuen Karten"""
    old = load(path) or {'vectors': np.zeros((0, 0), np.float32), 'meta': []}
    have = {m['id'] for m in old['meta']}
    todo = [c for c in catalog(get) if c['id'] not in have]
    log.info('%d Karten im Index, %d neu', len(have), len(todo))
    vecs, meta, added = [old['vectors']], list(old['meta']), 0
    with ThreadPoolExecutor(8) as pool:
        for n, i in enumerate(range(0, len(todo), batch)):
            part = todo[i:i + batch]
            imgs = list(pool.map(lambda c: fetch(c['image'] + '/low.jpg'), part))
            ok = [(c, im) for c, im in zip(part, imgs) if im is not None]
            if ok:
                cards = [cv2.resize(im, (vision.WARP_W, vision.WARP_H), interpolation=cv2.INTER_AREA) for _, im in ok]
                vecs.append(vision.vectors(embed, cards))
                meta += [c for c, _ in ok]
                added += len(ok)
            if n % 20 == 19 or i + batch >= len(todo):  # Zwischenstand: ein Abbruch verliert höchstens 20 Runden
                save({'vectors': np.vstack([v for v in vecs if v.size]), 'meta': meta}, path)
                log.info('%d von %d neuen Karten', min(i + batch, len(todo)), len(todo))
    return added


def main(argv):
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(message)s')
    os.makedirs(DATA, exist_ok=True)
    while True:
        try:
            update(vision.Dino(os.environ.get('MODEL', 'facebook/dinov2-base')))
            ok = True
        except Exception:  # z. B. tcgdex nicht erreichbar: in einer Stunde wieder
            log.exception('Index nicht aktualisiert')
            ok = False
        if '--loop' not in argv:
            return 0 if ok else 1
        time.sleep(WEEK if ok else 3600)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
