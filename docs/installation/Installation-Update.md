# Version 1.0.0 installieren (Stand 21.10.2026)

Ab dieser Version zeigt das Tool selbst an, wenn es eine neue Version gibt, und legt sie dir mit **Neue Version holen** als neue Tabelle an. Dorthin übernimmt es mit einem Klick alle Daten. Einmal musst du den Code noch von Hand einfügen. Deine Karten, Importe, der Verlauf und der nächtliche Preislauf bleiben, wie sie sind.

## 1. Code einfügen

1. Öffne die Tabelle „Pokemon Sammlung“ in einem Inkognito-Fenster, in dem nur das Konto des Sheet-Besitzers angemeldet ist.
2. Klicke auf **Erweiterungen > Apps Script**.
3. Klicke links auf das Zahnrad (**Projekteinstellungen**) und hake **Manifestdatei „appsscript.json“ im Editor anzeigen** an. Klicke dann links wieder auf **Editor** (`<>`).
4. **Code.gs**: Lösche den ganzen Inhalt und füge die neue `Code.gs` ein.
5. **Ui.html**: Lösche den ganzen Inhalt und füge die neue `Ui.html` ein.
6. **Update** ist neu: Klicke neben „Dateien“ auf **+ > Skript**, nenne die Datei `Update` (ohne Endung) und füge den Inhalt von `Update.gs` ein.
7. **appsscript.json**: Lösche den ganzen Inhalt und füge die neue `appsscript.json` ein.
8. `Import.gs` und `ImportUi.html` bleiben unverändert.
9. Speichere mit dem Disketten-Symbol.

## 2. Seitenleiste öffnen

1. Lade die Tabelle neu und klicke auf **Pokémon > Karten erfassen**.
2. Fragt Google nach Berechtigungen: Erscheint „Google hat diese App nicht überprüft“, klicke auf **Erweitert**, dann auf **Weiter zu … (unsicher)** und auf **Zulassen**. Bietet Google Häkchen für einzelne Rechte an, setze alle.
3. Beim Öffnen bringt das Tool die Tabelle selbst auf den neuen Stand. Es legt das versteckte Blatt **Tool-Einstellungen** an. Dort stehen jetzt Datenformat, Web-App-Link und die Zusatzspalten der Sammlung, die bisher in den Skript-Eigenschaften standen. Bitte dieses Blatt nicht von Hand ändern.
4. Eine Einrichtung ist nicht nötig.

## 3. Web-App aktualisieren

1. Klicke in Apps Script auf **Bereitstellen > Bereitstellungen verwalten**.
2. Klicke auf den Stift. Prüfe, ob „Ausführen als“ und „Zugriff“ noch so eingestellt sind wie vorher (bei dir: „Nutzer, der auf die Web-App zugreift“ und „Jeder mit Google-Konto“), und stelle sie sonst zurück. Wähle bei Version **Neue Version** und dann **Bereitstellen**. Der Link bleibt gleich.
3. Lade die Seite am Handy neu.

## 4. Kurz prüfen

1. Unten in der Seitenleiste steht jetzt **Version 1.0.0 · Updates**.
2. Ein Klick auf **Updates** öffnet den neuen Bereich. Solange das Repo auf GitHub privat ist, steht dort „Prüfen ging nicht: GitHub antwortet nicht wie erwartet (404)“. Das ist richtig so.
3. Im Menü gibt es **Pokémon > Updates** mit „Nach Updates suchen“ und „Aus alter Tabelle übernehmen“.
4. Sammlung, Pokédex, Import und der Preislauf funktionieren wie vorher.

## Was noch fehlt, bis „Neue Version holen“ etwas tut

- Das Repo muss öffentlich sein.
- Es braucht eine Vorlage-Tabelle (Schritte in `docs/RELEASE.md`, Abschnitt „Die Vorlage“), deren Link mit `node tools/release.js --main-template …` in `releases/channel.json` steht.
- Erst eine spätere Version (zum Beispiel 1.0.1) kann dann geholt werden.

## Gut zu wissen

- **Neue Version holen** legt die neue Tabelle im selben Ordner an (geht das nicht, in „Meine Ablage“; die Seitenleiste sagt, wo). Bis du dort auf **Jetzt übernehmen** klickst, ändert sich an deiner Tabelle nichts.
- Nach der Übernahme heißt deine alte Tabelle „… (alt)“ und ist stillgelegt. Über **Pokémon > Diese Tabelle wieder benutzen** kannst du jederzeit zu ihr zurück.
- Die Übernahme gibt die neue Tabelle auch für alle frei, mit denen die alte geteilt war, zum Beispiel für dein zweites Google-Konto. Google schickt dabei keine E-Mail.
- Die Version davor liegt im Ordner `vorher-1.0.0`, falls du zurückwechseln willst. Dann bitte auch die Datei `Update` löschen, `appsscript.json` kann so bleiben.
