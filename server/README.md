# Kartenerkennung: eigener Server

Der Server erkennt Pokémon-Karten auf einem Foto einer Ordnerseite (bis zu 9 Karten, #19). Das Tool in der Tabelle schickt das Foto hierher und zeigt die erkannten Karten zum Bestätigen im Tab **Hinzufügen**.

So erkennt er die Karten:

1. **Karten finden:** OpenCV sucht die Kartenränder im Foto und zieht jede Karte gerade.
2. **Bild vergleichen:** DINOv2 (Meta, Apache 2.0) rechnet die ganze Karte und das Motiv in Zahlenvektoren um. Diese werden mit den Vektoren aller englischen Karten von tcgdex verglichen. Das Motiv ist auf deutschen und englischen Karten gleich, und die tcgdex-IDs gelten für alle Sprachen.
3. **Nummer prüfen:** Die Texterkennung liest die Nummer unten auf der Karte (z. B. „136/189“). Bei Neuauflagen mit gleichem Motiv entscheidet die Nummer. Dafür laufen die PP-OCR-Modelle von PaddleOCR (Apache 2.0) über RapidOCR: Die Modelle stecken im Paket, es wird nichts nachgeladen.

Holo und Reverse Holo erkennt der Server nicht. Die Variante wählst du in der Liste.

## Was du brauchst

- Einen Linux-Server mit Docker und Docker Compose. Geplant ist er für Ubuntu mit 8 GB RAM. Der Dienst selbst braucht etwa 2 GB RAM, beim Aufbau des Index kurz mehr, und etwa 5 GB auf der Platte.
- Eine (Sub-)Domain mit gültigem HTTPS-Zertifikat, z. B. `karten.example.de`. Apps Script erreicht nur öffentliche HTTPS-Adressen.
- Einen Webserver davor (nginx, Apache, Caddy …), der die Domain an den Container weiterleitet.

## Einrichten

```sh
git clone https://github.com/studiobaeric/collection-sheet.git
cd collection-sheet/server
mkdir -p data
echo "deine.adresse@gmail.com" > data/konten.txt
docker compose up -d --build
```

Das startet zwei Dienste:

- **scan** beantwortet die Fotos. Er hört nur lokal auf Port 8765.
- **index** baut beim ersten Start die Vergleichsdatenbank: Er lädt alle englischen Kartenbilder von tcgdex (rund 20.000) und rechnet sie um. Das dauert je nach Prozessor 1 bis 3 Stunden. Danach schaut er einmal pro Woche nach neuen Sets. Die Kartenbilder werden nicht gespeichert, nur die Vektoren (`data/index.npz`, etwa 60 MB).

Den Fortschritt siehst du mit `docker compose logs -f index`. Bis der Index fertig ist, antwortet der Server auf Fotos mit „Die Vergleichsdatenbank wird noch gebaut“. `curl http://127.0.0.1:8765/health` zeigt, wie viele Karten im Index stehen.

### Webserver

Beispiel für nginx (Zertifikat wie bei deinen anderen Diensten):

```nginx
server {
    listen 443 ssl;
    server_name karten.example.de;
    # ssl_certificate … / ssl_certificate_key …

    client_max_body_size 20m;      # ein Foto ist 2 bis 4 MB groß
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_read_timeout 90s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Bei Apache: `ProxyPass / http://127.0.0.1:8765/`, `ProxyPassReverse / http://127.0.0.1:8765/` und `LimitRequestBody 20971520`. Bei Caddy reicht `reverse_proxy 127.0.0.1:8765`.

### In der Tabelle

Am Computer **Pokémon > Kartenerkennung einrichten** öffnen und die Adresse eingeben, z. B. `https://karten.example.de`. Google fragt dabei einmal, ob das Tool dein Konto als Ausweis nutzen darf. Danach testet das Tool gleich, ob der Server erreichbar ist und ob dein Konto freigeschaltet ist.

Für das Handy: im Apps-Script-Editor **Bereitstellen > Bereitstellungen verwalten > Bearbeiten > Version „Neue Version“ > Bereitstellen**. Erst dann zeigt die Web-App den Knopf **Ordnerseite fotografieren**.

Bei **Neue Version holen** geht die Adresse in die neue Tabelle mit.

## Konten freischalten

In `data/konten.txt` steht eine E-Mail-Adresse pro Zeile. Zeilen mit `#` am Anfang zählen nicht. Der Server liest die Datei bei jedem Foto neu. Eine Änderung gilt also sofort, ohne Neustart.

```text
# Eric
eric@example.com
# zweites Konto
eric.zwei@example.com
```

Wer die Tabelle mit einem anderen Google-Konto benutzt, braucht dieses Konto auf der Liste. Das Tool sagt beim Einrichten, welches Konto es schickt.

## Wie der Zugang funktioniert

Im Sheet steht kein Schlüssel. Apps Script holt bei jedem Foto einen kurzlebigen Ausweis des angemeldeten Kontos, den Google unterschrieben hat (`ScriptApp.getIdentityToken`, gültig 1 Stunde). Der Server prüft Googles Unterschrift, den Aussteller, die Gültigkeit und ob die E-Mail-Adresse bestätigt und auf der Liste ist.

Die Zielgruppe des Ausweises (`aud`) prüft der Server nicht: Jede Kopie der Tabelle hat ihr eigenes Google-Cloud-Projekt und damit eine eigene. Deshalb gilt auch ein Ausweis, den eine andere App für dein Konto bekommen hat, eine Stunde lang. Wer ihn hätte und deine Server-Adresse kennt, könnte Fotos schicken. Mehr als Fotos erkennen lassen kann er nicht: Der Server sieht deine Sammlung nicht.

## Grenzen und Protokoll

- Höchstens 200 Fotos pro Konto und Tag (`DAILY_LIMIT` in `docker-compose.yml`). Der Zähler steht im Speicher, ein Neustart setzt ihn zurück.
- Ein Foto nach dem anderen, damit der Dienst neben deinen anderen Diensten nicht zu viel RAM und CPU braucht.
- Fotos werden nicht gespeichert. Das Protokoll (`docker compose logs scan`) nennt nur Konto, Zeit, Dauer und Zahl der Karten.
- Karten, für die tcgdex kein Bild hat (z. B. manche Trainer Galleries und Promos), fehlen im Index.

## Aktualisieren

```sh
cd collection-sheet && git pull
cd server && docker compose up -d --build
```

Den Index von vorn bauen (z. B. nach einem neuen Modell): `data/index.npz` löschen und `docker compose restart index`.

## Entwickeln

Die Tests laufen ohne Modell und ohne Netz (statt DINOv2 ein einfaches Bild-Embedding, die Texterkennung echt):

```sh
pip install -r requirements.txt torch pytest httpx cryptography pillow
python -m pytest tests
```
