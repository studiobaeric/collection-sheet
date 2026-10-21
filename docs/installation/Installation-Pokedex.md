# Pokédex und Sortierung installieren (Stand 21.10.2026)

Deine Karten, Importe, der Verlauf und der nächtliche Preislauf bleiben, wie sie sind. Neu sind nur zwei Dateien-Inhalte.

## 1. Code einfügen

1. Öffne die Tabelle „Pokemon Sammlung“ in einem Inkognito-Fenster, in dem nur das Konto des Sheet-Besitzers angemeldet ist.
2. Klicke auf **Erweiterungen > Apps Script**.
3. **Code.gs**: Lösche den ganzen Inhalt und füge die neue `Code.gs` ein.
4. **Ui.html**: Lösche den ganzen Inhalt und füge die neue `Ui.html` ein.
5. `Import.gs` und `ImportUi.html` bleiben unverändert.
6. Speichere mit dem Disketten-Symbol.

## 2. Einrichtung

1. Lade die Tabelle neu und klicke auf **Pokémon > Einrichtung**.
2. Danach gibt es zwei neue Blätter: **Pokédex** (gleich hinter Sammlung) und **Seltenheiten**. Dazu kommen zwei versteckte: „Pokédex-Daten“ und „Pokédex-Nummern“.

## 3. Web-App aktualisieren

1. Klicke in Apps Script auf **Bereitstellen > Bereitstellungen verwalten**.
2. Klicke auf den Stift, wähle bei Version **Neue Version** und dann **Bereitstellen**. Der Link bleibt gleich.
3. Lade die Seite am Handy neu. Ist die Seitenleiste noch offen, schließe sie und öffne sie über **Pokémon > Karten erfassen** neu.

## 4. Pokédex-Nummern holen

Klicke einmal auf **Pokémon > Preise jetzt aktualisieren**. Dabei merkt sich das Tool zu jeder Karte die Pokédex-Nummer von tcgdex. Bis dahin erkennt es das Pokémon am Kartennamen (zum Beispiel „Mega-Dragoran-ex“ als Dragoran), das stimmt fast immer. Neue Karten bekommen ihre Nummer gleich beim Hinzufügen.

## 5. Kurz prüfen

1. **Seitenleiste oder Web-App**: Es gibt den neuen Tab **Pokédex**. Oben wählst du Alle, Fehlend oder Vorhanden, darunter Generation und Suche. Tippe auf ein Pokémon, dann klappen deine Karten davon auf. „In Sammlung öffnen“ zeigt sie im Tab Sammlung zum Bearbeiten, das × am Filter hebt ihn wieder auf.
2. **Tab Sammlung**: Unter der Suche gibt es „Sortieren nach“ (Set, Pokédex-Nr., Seltenheit, Name, Preis, Neueste). Der Pfeil daneben dreht die Richtung um. Jedes Gerät merkt sich deine Wahl.
3. **Blatt Pokédex**: In Zeile 4 filterst du nach Status, Generation und Name oder Nummer. In Zelle I4 wählst du ein Pokémon (oder tippst Name oder Nummer), dann stehen rechts deine Karten davon mit Bild.
4. **Blatt Seltenheiten**: Hier steht, wie selten jede Seltenheit zählt (1 = häufig, 9 = Hyperselten). Du kannst die Zahlen ändern. Leere Stufe heißt: kommt beim Sortieren ans Ende. Neue Seltenheiten aus deiner Sammlung trägt das Tool unten ohne Stufe ein.
5. Wenn du magst, starte **Pokémon > API prüfen**. Die neuen Schritte 15 und 16 zeigen die Pokédex-Nummern einiger Karten und alle Seltenheiten, die tcgdex kennt. Sag mir danach Bescheid, dann lese ich das Ergebnis.

## Gut zu wissen

- Tag-Team-Karten wie „Pikachu & Zekrom-GX“ zählen bei jedem Pokémon, das darauf ist. Beim Sortieren nach Pokédex-Nr. zählt das erste.
- Trainer- und Energiekarten haben keine Pokédex-Nummer und stehen beim Sortieren danach am Ende. Karten mit 0 Exemplaren stehen wie bisher immer ganz am Ende.
- Das Blatt Sammlung behält seine eigene Sortierauswahl (Set und Nummer, Name, Wert, Zuletzt hinzugefügt).
- Die Version davor liegt im Ordner `vorher-2026-10-21`, falls du zurückwechseln willst.
