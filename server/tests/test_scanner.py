"""Tests der Kartenerkennung mit gezeichneten Testkarten: Karten finden, Nummer lesen (echte OCR-Modelle),
Treffer ordnen, Zugang, HTTP-Dienst, Index. DINOv2 ersetzt hier ein einfaches Bild-Embedding (verkleinerte Pixel):
Das echte Modell läuft erst auf dem Server (Hugging Face ist aus der Testumgebung gesperrt)."""
import base64
import datetime
import json
import os
import sys
import time

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scanner import build_index, vision  # noqa: E402

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def fake_embed(imgs):
    v = np.stack([cv2.resize(im, (12, 16), interpolation=cv2.INTER_AREA).astype(np.float32).ravel() for im in imgs])
    v -= v.mean(1, keepdims=True)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def card_image(seed, number, w=490, h=684):
    """Testkarte (BGR): gelber Rand, Zufallsmotiv aus seed, Nummer unten links"""
    rng = np.random.default_rng(seed)
    im = Image.new('RGB', (w, h), (235, 200, 40))
    d = ImageDraw.Draw(im)
    d.rectangle([22, 22, w - 22, h - 22], fill=(245, 240, 225))
    d.rectangle([40, 70, w - 40, int(h * 0.52)], fill=tuple(int(x) for x in rng.integers(0, 255, 3)))
    for _ in range(12):
        x, y = int(rng.integers(40, w - 120)), int(rng.integers(70, int(h * 0.52) - 80))
        d.ellipse([x, y, x + int(rng.integers(30, 110)), y + int(rng.integers(30, 80))],
                  fill=tuple(int(c) for c in rng.integers(0, 255, 3)))
    font = ImageFont.truetype(FONT, 26)
    d.text((40, 28), 'Karte %d' % seed, fill=(20, 20, 20), font=font)
    d.text((40, h - 58), number, fill=(20, 20, 20), font=ImageFont.truetype(FONT, 22))
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def binder_page(cards, gap=26, margin=60, tilt=0.04):
    """3×3-Ordnerseite auf dunklem Grund, leicht schräg fotografiert, als JPEG"""
    ch, cw = cards[0].shape[:2]
    H, W = margin * 2 + 3 * ch + 2 * gap, margin * 2 + 3 * cw + 2 * gap
    page = np.full((H, W, 3), 25, np.uint8)
    for i, c in enumerate(cards):
        r, k = divmod(i, 3)
        y, x = margin + r * (ch + gap), margin + k * (cw + gap)
        page[y:y + ch, x:x + cw] = c
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    dst = np.float32([[W * tilt, H * tilt], [W * (1 - tilt / 2), 0], [W, H], [0, H * (1 - tilt)]])
    page = cv2.warpPerspective(page, cv2.getPerspectiveTransform(src, dst), (W, H), borderValue=(25, 25, 25))
    return cv2.imdecode(cv2.imencode('.jpg', page, [cv2.IMWRITE_JPEG_QUALITY, 85])[1], cv2.IMREAD_COLOR)


NUMBERS = ['136/189', '4/102', '25/165', '58/198', '112/086', '7/64', '160/159', '33/202', '91/195']


def make_index(cards, metas):
    resized = [cv2.resize(c, (vision.WARP_W, vision.WARP_H), interpolation=cv2.INTER_AREA) for c in cards]
    return {'vectors': vision.vectors(fake_embed, resized), 'meta': metas}


def meta(i, number, set_id='s%d'):
    num, tot = number.split('/')
    return {'id': (set_id % i) + '-' + num, 'localId': num, 'name': 'Karte %d' % i, 'setId': set_id % i,
            'setName': 'Set', 'official': int(tot), 'image': ''}


@pytest.fixture(scope='module')
def reader():
    return vision.NumberReader()


def test_parse_number():
    p = vision.parse_number
    assert p('PAL DE 136/193 G') == {'num': '136', 'total': 193}
    assert p('TG05/TG30') == {'num': 'TG05', 'total': None}
    assert p('1O5/1I0') == {'num': '105', 'total': 110}
    assert p('Promo SWSH123') == {'num': 'SWSH123', 'total': None}
    assert p('') is None and p('Illus. Ken Sugimori') is None
    assert vision.num_key('025') == vision.num_key('25') == ('', 25)
    assert vision.num_key('TG05') == ('TG', 5)


def test_find_cards_binder_page_in_reading_order():
    cards = [card_image(i, NUMBERS[i]) for i in range(9)]
    page = binder_page(cards)
    quads = vision.find_cards(page)
    assert len(quads) == 9
    centers = [q.mean(0) for q in quads]
    for r in range(3):  # Zeile für Zeile, links nach rechts
        row = centers[r * 3:r * 3 + 3]
        assert row[0][0] < row[1][0] < row[2][0]
        if r:
            assert min(c[1] for c in row) > max(c[1] for c in centers[(r - 1) * 3:r * 3])


def test_scan_page_finds_every_card_and_number_picks_the_reprint(reader):
    cards = [card_image(i, NUMBERS[i]) for i in range(9)]
    metas = [meta(i, NUMBERS[i]) for i in range(9)]
    # Neuauflage von Karte 0 mit gleichem Motiv, andere Nummer; und von Karte 4
    twin0 = card_image(0, '20/30')
    twin4 = card_image(4, '9/99')
    index = make_index(cards + [twin0, twin4], metas + [meta(90, '20/30'), meta(94, '9/99')])
    page = binder_page(cards)
    t0 = time.time()
    res = vision.scan(page, index, fake_embed, reader)
    assert time.time() - t0 < 30
    assert len(res) == 9
    for i, r in enumerate(res):
        assert r['candidates'][0]['id'] == metas[i]['id'], (i, r['number'], r['candidates'][:2])
        assert len(r['candidates']) == 3
        assert base64.b64decode(r['crop'])[:2] == b'\xff\xd8'  # JPEG
    assert res[0]['candidates'][0]['numberMatch']
    assert res[0]['candidates'][1]['id'] == 's90-20'  # die Neuauflage als Alternative


def test_scan_page_reprint_on_the_page_wins_by_number(reader):
    cards = [card_image(i, NUMBERS[i]) for i in range(9)]
    cards[0] = card_image(0, '20/30')  # auf der Seite liegt die Neuauflage
    metas = [meta(i, NUMBERS[i]) for i in range(9)]
    index = make_index([card_image(i, NUMBERS[i]) for i in range(9)] + [cards[0]], metas + [meta(90, '20/30')])
    res = vision.scan(binder_page(cards), index, fake_embed, reader)
    assert res[0]['candidates'][0]['id'] == 's90-20'


def test_single_card_filling_the_photo(reader):
    card = card_image(3, '58/198')
    index = make_index([card_image(i, NUMBERS[i]) for i in range(9)], [meta(i, NUMBERS[i]) for i in range(9)])
    res = vision.scan(card, index, fake_embed, reader)
    assert len(res) == 1 and res[0]['candidates'][0]['id'] == 's3-58'


def test_photo_without_cards_gives_one_guess(reader):
    noise = np.random.default_rng(1).integers(0, 255, (600, 800, 3), dtype=np.uint8)
    index = make_index([card_image(0, '1/2')], [meta(0, '1/2')])
    res = vision.scan(noise, index, fake_embed, reader)
    assert len(res) == 1 and len(res[0]['candidates']) == 1


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

def test_build_index_skips_pocket_and_missing_images_and_only_adds_new(tmp_path, monkeypatch):
    sets = [{'id': 'swsh3', 'name': 'Darkness Ablaze'}, {'id': 'A1', 'name': 'Genetic Apex'}]
    full = {'swsh3': {'name': 'Darkness Ablaze', 'cardCount': {'official': 189},
                      'cards': [{'id': 'swsh3-136', 'localId': '136', 'name': 'Furret', 'image': 'u/136'},
                                {'id': 'swsh3-137', 'localId': '137', 'name': 'X', 'image': None}]},
            'A1': {'name': 'Genetic Apex', 'cards': [{'id': 'A1-1', 'localId': '1', 'name': 'Bulbasaur', 'image': 'p/1'}]}}

    def get(url):
        return sets if url.endswith('/sets') else full[url.rsplit('/', 1)[1]]
    fetched = []

    def fetch(url):
        fetched.append(url)
        return card_image(136, '136/189', 245, 342)
    path = str(tmp_path / 'index.npz')
    assert build_index.update(fake_embed, get, fetch, path) == 1
    assert fetched == ['u/136/low.jpg']
    idx = build_index.load(path)
    assert [m['id'] for m in idx['meta']] == ['swsh3-136'] and idx['meta'][0]['official'] == 189
    assert idx['vectors'].shape[0] == 1
    assert build_index.update(fake_embed, get, fetch, path) == 0 and len(fetched) == 1


# ---------------------------------------------------------------------------
# Zugang und HTTP-Dienst
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def keys():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'test')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256()))
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return {'key': pem, 'cert': cert.public_bytes(serialization.Encoding.PEM).decode()}


@pytest.fixture
def client(tmp_path, monkeypatch, keys):
    from fastapi.testclient import TestClient
    from google.oauth2 import id_token
    from scanner import app as appmod
    monkeypatch.setattr(id_token, '_fetch_certs', lambda req, url: {'k1': keys['cert']})
    (tmp_path / 'konten.txt').write_text('# Freigeschaltet\neric@example.com\n\n', encoding='utf-8')
    monkeypatch.setattr(appmod, 'ALLOWLIST', str(tmp_path / 'konten.txt'))
    monkeypatch.setattr(build_index, 'INDEX', str(tmp_path / 'index.npz'))
    monkeypatch.setattr(appmod, 'counts', {})
    monkeypatch.setattr(appmod, 'index', {'mtime': None, 'data': None})
    monkeypatch.setattr(appmod, 'engine', {'embed': fake_embed, 'number': lambda card: ('', None)})
    return TestClient(appmod.app), appmod, tmp_path


def token(keys, email='eric@example.com', verified=True, exp=None, iss='https://accounts.google.com'):
    from google.auth import crypt, jwt
    now = int(time.time())
    payload = {'iss': iss, 'aud': 'irgendein-projekt.apps.googleusercontent.com', 'sub': '1', 'email': email,
               'email_verified': verified, 'iat': now, 'exp': exp or now + 3600}
    return jwt.encode(crypt.RSASigner.from_string(keys['key'], 'k1'), payload).decode()


def photo_body():
    page = binder_page([card_image(i, NUMBERS[i]) for i in range(9)])
    return json.dumps({'image': base64.b64encode(cv2.imencode('.jpg', page)[1]).decode()})


def test_scan_needs_a_valid_google_token_and_a_listed_account(client, keys):
    c, _, _ = client
    body = photo_body()
    assert c.post('/scan', content=body).status_code == 401
    assert c.post('/scan', content=body, headers={'Authorization': 'Bearer kaputt'}).status_code == 401
    old = token(keys, exp=int(time.time()) - 600)
    assert c.post('/scan', content=body, headers={'Authorization': 'Bearer ' + old}).status_code == 401
    foreign = token(keys, iss='https://evil.example')
    assert c.post('/scan', content=body, headers={'Authorization': 'Bearer ' + foreign}).status_code == 401
    r = c.post('/scan', content=body, headers={'Authorization': 'Bearer ' + token(keys, 'fremd@example.com')})
    assert r.status_code == 403 and 'fremd@example.com' in r.json()['detail']
    r = c.post('/scan', content=body, headers={'Authorization': 'Bearer ' + token(keys, verified=False)})
    assert r.status_code == 403


def test_scan_without_index_then_with_index_and_daily_limit(client, keys, monkeypatch):
    c, appmod, tmp = client
    auth = {'Authorization': 'Bearer ' + token(keys, 'Eric@Example.com')}  # Großschreibung egal
    body = photo_body()
    assert c.post('/scan', content=body, headers=auth).status_code == 503
    cards = [card_image(i, NUMBERS[i]) for i in range(9)]
    build_index.save(make_index(cards, [meta(i, NUMBERS[i]) for i in range(9)]), build_index.INDEX)
    assert c.get('/health').json() == {'ok': True, 'cards': 9}
    r = c.post('/scan', content=body, headers=auth)
    assert r.status_code == 200
    got = r.json()
    assert [x['candidates'][0]['id'] for x in got['cards']] == [meta(i, NUMBERS[i])['id'] for i in range(9)]
    monkeypatch.setattr(appmod, 'DAILY_LIMIT', 2)  # 503 und 200 zählten schon
    assert c.post('/scan', content=body, headers=auth).status_code == 429


def test_scan_rejects_broken_or_huge_photos(client, keys, monkeypatch):
    c, appmod, _ = client
    auth = {'Authorization': 'Bearer ' + token(keys)}
    assert c.post('/scan', content='{"image": "bm9wZQ=="}', headers=auth).status_code == 400
    assert c.post('/scan', content='kein json', headers=auth).status_code == 400
    monkeypatch.setattr(appmod, 'MAX_BYTES', 10)
    assert c.post('/scan', content=photo_body(), headers=auth).status_code == 413


def test_allowlist_is_read_on_every_request(client, keys):
    c, _, tmp = client
    auth = {'Authorization': 'Bearer ' + token(keys, 'neu@example.com')}
    assert c.post('/scan', content=photo_body(), headers=auth).status_code == 403
    with open(tmp / 'konten.txt', 'a', encoding='utf-8') as f:
        f.write('neu@example.com\n')
    assert c.post('/scan', content=photo_body(), headers=auth).status_code == 503  # freigeschaltet, nur noch kein Index
