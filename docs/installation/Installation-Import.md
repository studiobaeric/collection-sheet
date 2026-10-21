# Import-Tool installieren (Stand 16.10.2026)

Dabei wird nichts importiert. Deine Karten, der Verlauf und der nächtliche Preislauf bleiben erhalten. „Einrichtung“ stellt nur die Tabelle „Daten“ auf das neue Format um.

## 1. Code einfügen

1. Öffne die Tabelle „Pokemon Sammlung“ in einem Inkognito-Fenster, in dem nur das Konto des Sheet-Besitzers angemeldet ist (sonst öffnet sich Apps Script nicht).
2. Klicke auf **Erweiterungen > Apps Script**.
3. **Code.gs**: Lösche den ganzen Inhalt und füge die neue `Code.gs` ein.
4. **Ui.html**: Lösche den ganzen Inhalt und füge die neue `Ui.html` ein.
5. Neue Skriptdatei: Klicke links neben „Dateien“ auf **+ > Skript** und nenne sie genau `Import`. Lösche den Beispielinhalt und füge `Import.gs` ein.
6. Neue HTML-Datei: Klicke auf **+ > HTML** und nenne sie genau `ImportUi`. Lösche den Beispielinhalt und füge `ImportUi.html` ein.
7. Klicke links bei **Dienste** auf **+**, wähle **Drive API** und dann **Hinzufügen**. Die Kennung bleibt „Drive“. Diesen Dienst braucht das Tool, um .xlsx-Dateien wie „Pokemon Ordner.xlsx“ zu lesen.
8. Speichere mit dem Disketten-Symbol.

## 2. Einrichtung

1. Lade die Tabelle neu und klicke auf **Pokémon > Einrichtung**. Google fragt nach neuen Berechtigungen, für Drive und einen neuen Auslöser. Bitte erlauben.
2. Danach gibt es neue Blätter: Importe, Import-Begriffe, Import-Sets und einige versteckte.

## 3. Web-App aktualisieren

1. Klicke in Apps Script auf **Bereitstellen > Bereitstellungen verwalten**.
2. Klicke auf den Stift, wähle bei Version **Neue Version** und dann **Bereitstellen**. Der Link bleibt gleich.
3. Lade die Seite am Handy neu. Bis dahin bitte am Handy keine Karten ändern.
4. Falls die Seitenleiste „Pokémon-Karten“ (rechts neben der Tabelle, aus „Pokémon > Karten erfassen“) noch von vorher offen ist: Schließe sie mit dem X und öffne sie über das Menü neu. Sonst läuft darin noch der alte Code. Ist keine offen, überspringst du diesen Schritt.

## 4. Kurz prüfen

1. Öffne **Pokémon > Karten erfassen**. Es gibt jetzt die Tabs Hinzufügen, Sammlung und Import.
2. Sieh in **Sammlung** nach: Deine Karten sollten wie vorher da sein, jetzt mit Herkunft „von Hand“.
3. Wenn du magst, starte **Pokémon > API prüfen**. Die neuen Schritte 10 bis 14 prüfen bei tcgdex Snowflake-Karten, Set-Kürzel und Promo-Nummern sowie den Drive-Dienst. Sag mir danach Bescheid, dann lese ich das Ergebnis.

## Gut zu wissen

- Die Spalte „Einträge ohne Preis“ im Verlauf zählt ab jetzt Karten-Zeilen der Sammlung statt Daten-Zeilen. Deshalb sinkt sie am ersten Tag einmal.
- Jeder Tab einer Datei gilt beim Import als eigene Liste. Benenne einen Tab zwischen zwei Importen nicht um.
- Der Import erkennt Karten über tcgdex-ID, Cardmarket-Link, Set und Nummer (auch „DS 62“) oder den Namen. Passt der Name nicht zur gefundenen Karte, landet die Zeile in der Prüfliste und wird nicht still übernommen.
- Die alte Version liegt im Ordner `vorher-2026-10-15`, falls du zurückwechseln willst.
