"""HTTP-Dienst der Kartenerkennung: POST /scan mit einem Foto, Antwort: erkannte Karten mit Treffern.

Zugang: Apps Script schickt den Ausweis des angemeldeten Google-Kontos (ScriptApp.getIdentityToken) als
„Authorization: Bearer …“. Der Dienst prüft Googles Unterschrift, die bestätigte E-Mail-Adresse und die Kontenliste
(eine Adresse pro Zeile, bei jeder Anfrage neu gelesen). Fotos werden nicht gespeichert, nur protokolliert:
Konto, Zeit, Dauer, Zahl der Karten.
"""
import base64
import binascii
import datetime
import json
import logging
import os
import threading
import time

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from google.auth import exceptions as gexc
from google.auth.transport import requests as greq
from google.oauth2 import id_token
from starlette.concurrency import run_in_threadpool

from . import build_index, vision

ALLOWLIST = os.environ.get('ALLOWLIST', os.path.join(build_index.DATA, 'konten.txt'))
DAILY_LIMIT = int(os.environ.get('DAILY_LIMIT', '200'))
MAX_BYTES = 20 * 1024 * 1024  # ein Foto mit 3.000 px als Base64 hat etwa 2–4 MB
ISSUERS = ('accounts.google.com', 'https://accounts.google.com')

log = logging.getLogger('scan')
app = FastAPI(title='Kartenerkennung')
engine = {}             # Modelle, beim ersten Foto geladen
index = {'mtime': None, 'data': None}
counts = {}             # (Konto, Tag) -> Fotos; shortcut: im Speicher, ein Neustart setzt das Tageslimit zurück
lock = threading.Lock()  # ein Foto nach dem anderen: begrenzt RAM und CPU auf einem geteilten Server
count_lock = threading.Lock()
_greq = greq.Request()


def allowed_accounts():
    try:
        with open(ALLOWLIST, encoding='utf-8') as f:
            return {l.strip().lower() for l in f if l.strip() and not l.lstrip().startswith('#')}
    except FileNotFoundError:
        return set()


def account(auth_header):
    """Bearer-Ausweis -> E-Mail-Adresse oder HTTPException 401/403"""
    token = auth_header[7:].strip() if auth_header.lower().startswith('bearer ') else ''
    if not token:
        raise HTTPException(401, 'Kein Ausweis')
    try:
        # Zielgruppe (aud) nicht geprüft: jede Tabellenkopie hat ihr eigenes Google-Cloud-Projekt und damit eine eigene
        info = id_token.verify_token(token, _greq, audience=None, clock_skew_in_seconds=10)
    except (ValueError, gexc.GoogleAuthError) as e:
        raise HTTPException(401, 'Ausweis ungültig: %s' % e)
    if info.get('iss') not in ISSUERS:
        raise HTTPException(401, 'Ausweis nicht von Google')
    email = str(info.get('email', '')).lower()
    if not email or not info.get('email_verified'):
        raise HTTPException(403, 'Ausweis ohne bestätigte E-Mail-Adresse')
    if email not in allowed_accounts():
        raise HTTPException(403, 'Konto %s ist nicht freigeschaltet' % email)
    return email


def count_photo(email):
    day = datetime.date.today().isoformat()
    with count_lock:
        for k in [k for k in counts if k[1] != day]:
            del counts[k]
        n = counts.get((email, day), 0)
        if n >= DAILY_LIMIT:
            raise HTTPException(429, 'Tageslimit von %d Fotos erreicht' % DAILY_LIMIT)
        counts[(email, day)] = n + 1


def current_index():
    """Index laden und neu laden, sobald der Dienst „index“ eine neue Datei geschrieben hat"""
    try:
        mtime = os.path.getmtime(build_index.INDEX)
    except OSError:
        return None
    if mtime != index['mtime']:
        index['data'], index['mtime'] = build_index.load(build_index.INDEX), mtime
    return index['data']


def decode(body):
    try:
        data = json.loads(body)
        b64 = str(data['image'])
        b64 = b64.split(',', 1)[1] if b64.startswith('data:') else b64
        img = cv2.imdecode(np.frombuffer(base64.b64decode(b64, validate=True), np.uint8), cv2.IMREAD_COLOR)
    except (ValueError, KeyError, TypeError, binascii.Error):
        img = None
    if img is None:
        raise HTTPException(400, 'Kein lesbares Foto')
    return img


@app.get('/health')
def health():
    data = current_index()
    return {'ok': True, 'cards': len(data['meta']) if data else 0}


@app.post('/scan')
async def scan(request: Request):
    body = await request.body()
    if len(body) > MAX_BYTES:
        raise HTTPException(413, 'Foto zu groß')
    email = account(request.headers.get('authorization', ''))
    img = decode(body)
    count_photo(email)
    return await run_in_threadpool(scan_photo, img, email)


def load_engine():
    with lock:
        if not engine:
            engine['embed'] = vision.Dino(os.environ.get('MODEL', 'facebook/dinov2-base'))
            engine['number'] = vision.NumberReader()


@app.on_event('startup')
def preload():
    # Modelle gleich beim Start laden (das erste Mal mit Download): sonst wartet das erste Foto länger als die 60 s von Apps Script
    threading.Thread(target=load_engine, daemon=True).start()


def scan_photo(img, email):
    load_engine()  # wartet, falls der Start noch lädt
    with lock:
        data = current_index()
        if not data or not data['meta']:
            raise HTTPException(503, 'Die Vergleichsdatenbank wird noch gebaut')
        t0 = time.time()
        cards = vision.scan(img, data, engine['embed'], engine['number'])
        secs = round(time.time() - t0, 1)
    log.info('Foto von %s: %d Karten in %.1f s', email, len(cards), secs)
    return {'cards': cards, 'seconds': secs}


logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(message)s')
