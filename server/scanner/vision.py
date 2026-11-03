"""Karten im Foto finden, mit dem Index vergleichen und die Nummer prüfen (Kartenerkennung, #19).

Ablauf pro Foto: Karten ausschneiden und gerade ziehen (OpenCV), ganze Karte und Motiv mit DINOv2 in Vektoren
umrechnen, mit allen Kartenbildern im Index vergleichen (Kosinus), dann die gelesene Nummer (PaddleOCR-Modelle über
RapidOCR) als Prüfung: Neuauflagen mit gleichem Motiv unterscheiden sich nur in Nummer und Set.
"""
import base64
import re

import cv2
import numpy as np

CARD_RATIO = 88 / 63            # Höhe / Breite einer Pokémon-Karte
WARP_W, WARP_H = 500, 698       # gerade gezogene Karte (genug Auflösung für die Nummer)
FULL_SIZE = (224, 308)          # (Breite, Höhe) fürs Modell, Vielfache der Patchgröße 14
ART_SIZE = (308, 224)
ART_BOX = (0.08, 0.10, 0.92, 0.54)   # Motiv: links, oben, rechts, unten (Anteil der Karte)
NUMBER_BOX = (0.0, 0.88, 1.0, 1.0)   # unterer Rand mit der Nummer
TOP_K = 30                      # so viele ähnlichste Karten prüft die Nummer
NUM_BONUS = 0.08                # passende Nummer: Neuauflage mit gleichem Motiv richtig einordnen
TOTAL_BONUS = 0.03              # passende Gesamtzahl des Sets („/189“)
MAX_CARDS = 12


# ---------------------------------------------------------------------------
# Karten finden
# ---------------------------------------------------------------------------

def _order(pts):
    """4 Punkte -> oben links, oben rechts, unten rechts, unten links"""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], dtype=np.float32)


def _inside(pt, quad):
    return cv2.pointPolygonTest(quad.reshape(-1, 1, 2), (float(pt[0]), float(pt[1])), False) >= 0


def find_cards(img):
    """Ecken aller Karten im Foto (in Lesereihenfolge) -> [np.array 4x2 float32]; leer, wenn keine gefunden"""
    h, w = img.shape[:2]
    scale = 1000.0 / max(h, w)
    small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 30, 100), np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    area_img = small.shape[0] * small.shape[1]
    found = []
    for c in contours:
        hull = cv2.convexHull(c)
        area = cv2.contourArea(hull)
        if area < 0.02 * area_img:  # eine Karte auf einer Ordnerseite mit 9 Karten hat etwa 8 %
            continue
        (cx, cy), (rw, rh), _ = cv2.minAreaRect(hull)
        if min(rw, rh) == 0:
            continue
        ratio = max(rw, rh) / min(rw, rh)
        if not 1.2 <= ratio <= 1.6 or area / (rw * rh) < 0.85:
            continue
        approx = cv2.approxPolyDP(hull, 0.03 * cv2.arcLength(hull, True), True)
        quad = approx if len(approx) == 4 else cv2.boxPoints(cv2.minAreaRect(hull))
        found.append({'area': area, 'center': (cx, cy), 'quad': _order(quad)})
    # Behälter weg (z. B. die ganze Ordnerseite): enthält 2 oder mehr andere, die nicht ineinander liegen.
    # Rand, Motivrahmen und Hülle einer Karte liegen ineinander und zählen als einer.
    def inner(f):
        return [g for g in found if g is not f and g['area'] < f['area'] and _inside(g['center'], f['quad'])]

    def tops(f):
        kids = inner(f)
        return sum(1 for g in kids if not any(d['area'] > g['area'] and _inside(g['center'], d['quad']) for d in kids))
    found = [f for f in found if tops(f) < 2]
    # Verschachtelte (Motivrahmen in der Karte, doppelte Kanten): die größte bleibt
    keep = []
    for f in sorted(found, key=lambda f: -f['area']):
        if not any(_inside(f['center'], k['quad']) for k in keep):
            keep.append(f)
    keep = keep[:MAX_CARDS]
    if not keep:
        return []
    # Lesereihenfolge: Zeilen von oben nach unten, darin von links nach rechts
    row_h = 0.5 * np.median([np.sqrt(k['area'] * CARD_RATIO) for k in keep])
    keep.sort(key=lambda k: k['center'][1])
    rows, last_y = [], None
    for k in keep:
        if last_y is None or k['center'][1] - last_y > row_h:
            rows.append([])
        rows[-1].append(k)
        last_y = k['center'][1]
    out = []
    for r in rows:
        out += [k['quad'] / scale for k in sorted(r, key=lambda k: k['center'][0])]
    return out


def warp(img, quad):
    """Karte gerade ziehen, immer hochkant"""
    q = _order(quad)
    if np.linalg.norm(q[1] - q[0]) > np.linalg.norm(q[3] - q[0]):  # liegt quer: um 90° drehen
        q = np.roll(q, -1, axis=0)
    dst = np.array([[0, 0], [WARP_W - 1, 0], [WARP_W - 1, WARP_H - 1], [0, WARP_H - 1]], dtype=np.float32)
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(q, dst), (WARP_W, WARP_H))


def crop_box(card, box):
    h, w = card.shape[:2]
    return card[round(box[1] * h):round(box[3] * h), round(box[0] * w):round(box[2] * w)]


# ---------------------------------------------------------------------------
# Nummer lesen
# ---------------------------------------------------------------------------

_DIGITS = str.maketrans({'O': '0', 'o': '0', 'D': '0', 'I': '1', 'l': '1', '|': '1'})
_SLASH = re.compile(r'([A-Z]{0,4})([0-9OoDIl|]{1,4})\s*/\s*([A-Z]{0,4})([0-9OoDIl|]{1,4})')
_PROMO = re.compile(r'\b(SWSH|SVP|SM|XY|BW|DP|HGSS|SV|TG|GG)\s?(\d{1,4})\b')


def parse_number(text):
    """OCR-Text vom Kartenrand -> {'num': '136', 'total': 189 oder None} oder None"""
    t = str(text or '')
    m = _SLASH.search(t)
    if m:
        num = m.group(1) + m.group(2).translate(_DIGITS)
        tot = m.group(4).translate(_DIGITS)
        return {'num': num, 'total': int(tot) if tot.isdigit() and not m.group(3) else None}
    m = _PROMO.search(t.upper())
    return {'num': m.group(1) + m.group(2), 'total': None} if m else None


def num_key(s):
    """'TG05' -> ('TG', 5), '025' -> ('', 25), sonst der Text in Großbuchstaben"""
    m = re.match(r'^([A-Z]*)\s*0*(\d+)$', str(s).strip().upper())
    return (m.group(1), int(m.group(2))) if m else str(s).strip().upper()


class NumberReader:
    """Liest die Nummer unten auf der Karte (PP-OCR-Modelle von PaddleOCR über RapidOCR, ohne Download)."""

    def __init__(self):
        from rapidocr_onnxruntime import RapidOCR
        self.ocr = RapidOCR()

    def __call__(self, card):
        strip = crop_box(card, NUMBER_BOX)
        strip = cv2.resize(strip, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        res, _ = self.ocr(strip)
        text = ' '.join(r[1] for r in res or [])
        return text, parse_number(text)


# ---------------------------------------------------------------------------
# Vergleichen
# ---------------------------------------------------------------------------

class Dino:
    """DINOv2 (Apache 2.0): Bilder (RGB, gleiche Größe) -> normierte Vektoren. Lädt das Modell einmal von Hugging Face."""
    MEAN = np.array([0.485, 0.456, 0.406], np.float32)
    STD = np.array([0.229, 0.224, 0.225], np.float32)

    def __init__(self, name='facebook/dinov2-base'):
        import torch
        from transformers import AutoModel
        self.torch = torch
        self.model = AutoModel.from_pretrained(name).eval()

    def __call__(self, imgs):
        x = ((np.stack(imgs).astype(np.float32) / 255 - self.MEAN) / self.STD).transpose(0, 3, 1, 2)
        with self.torch.inference_mode():
            v = self.model(pixel_values=self.torch.from_numpy(np.ascontiguousarray(x))).pooler_output.numpy()
        return v / np.linalg.norm(v, axis=1, keepdims=True)


def card_views(card):
    """gerade gezogene Karte (BGR) -> (ganze Karte, Motiv) in Modellgröße, RGB"""
    rgb = cv2.cvtColor(card, cv2.COLOR_BGR2RGB)
    full = cv2.resize(rgb, FULL_SIZE, interpolation=cv2.INTER_AREA)
    art = cv2.resize(crop_box(rgb, ART_BOX), ART_SIZE, interpolation=cv2.INTER_AREA)
    return full, art


def vectors(embed, cards):
    """Ein Vektor pro Karte aus ganzer Karte und Motiv (beide normiert, zusammen Länge 1)"""
    views = [card_views(c) for c in cards]
    full = embed([v[0] for v in views])
    art = embed([v[1] for v in views])
    return np.hstack([full, art]).astype(np.float32) / np.sqrt(2)


def rank(sims, meta, number, top=3):
    """Ähnlichkeiten einer Karte zu allen im Index -> die besten `top` nach Bild und Nummer"""
    k = min(TOP_K, len(sims))
    idx = np.argpartition(-sims, k - 1)[:k]
    want = num_key(number['num']) if number else None
    out = []
    for i in idx:
        m = meta[i]
        hit = want is not None and num_key(m['localId']) == want
        bonus = NUM_BONUS if hit else 0.0
        if hit and number.get('total') and m.get('official') == number['total']:
            bonus += TOTAL_BONUS
        out.append(dict(m, score=round(float(sims[i]), 4), numberMatch=hit, _rank=float(sims[i]) + bonus))
    out.sort(key=lambda c: -c['_rank'])
    for c in out:
        del c['_rank']
    return out[:top]


def thumb(card, width=160):
    small = cv2.resize(card, (width, round(width * CARD_RATIO)), interpolation=cv2.INTER_AREA)
    return base64.b64encode(cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 70])[1]).decode('ascii')


def scan(img, index, embed, read_number, top=3):
    """Foto (BGR) -> [{crop, number, candidates}] in Lesereihenfolge. index: {'vectors': (N, D), 'meta': [..]}"""
    quads = find_cards(img)
    if quads:
        cards = [warp(img, q) for q in quads]
    else:  # nichts gefunden: das ganze Foto als eine Karte (Foto einer einzelnen Karte bis zum Rand)
        cards = [cv2.resize(img, (WARP_W, WARP_H), interpolation=cv2.INTER_AREA)]
    sims = vectors(embed, cards) @ index['vectors'].T
    out = []
    for card, s in zip(cards, sims):
        text, number = read_number(card)
        out.append({'crop': thumb(card), 'number': text.strip(), 'candidates': rank(s, index['meta'], number, top)})
    return out
