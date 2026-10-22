# Dashboard installieren (Version 1.1.0, Stand 22.10.2026)

Version 1.1.0 bringt das Blatt **Dashboard**. Sie enthält auch alles aus 1.0.3. Deine Karten, Importe, der Verlauf und der nächtliche Preislauf bleiben, wie sie sind.

## Weg 1: Neue Version holen (nach dem Release)

Sobald 1.1.0 auf `main` ist und die Vorlage auf 1.1.0 steht (docs/RELEASE.md), zeigt deine Tabelle oben den Hinweis auf die neue Version. Dann wie im README unter „Updates“: **Neue Version holen**, die neue Tabelle öffnen, **Pokémon > Karten erfassen**, **Jetzt übernehmen**. Das Dashboard ist in der neuen Tabelle schon da.

## Weg 2: Von Hand (auch zum Ausprobieren vor dem Release)

Zum Ausprobieren am besten in einer Kopie deiner Tabelle (**Datei > Kopie erstellen**), dann bleibt deine echte Tabelle auf der alten Version.

1. Öffne die Tabelle in einem Inkognito-Fenster, in dem nur das Konto des Besitzers angemeldet ist.
2. Klicke auf **Erweiterungen > Apps Script**.
3. Ersetze den Inhalt dieser sechs Dateien jeweils komplett durch die aus dem Ordner [`src` von version/1.1.0](https://github.com/studiobaeric/collection-sheet/tree/version/1.1.0/src) (nach dem Release: aus dem Tag `v1.1.0`): `Code.gs`, `Import.gs`, `Update.gs`, `Ui.html`, `ImportUi.html` und `appsscript.json`. Alle sechs, weil 1.0.3 in jeder etwas geändert hat.
4. Speichere mit dem Disketten-Symbol.
5. Lade die Tabelle neu und öffne **Pokémon > Karten erfassen**. Dabei baut das Tool die Blätter auf den neuen Stand um und legt das Dashboard an. Das dauert ein paar Sekunden länger als sonst, weil es die Bilder der Knöpfe von GitHub lädt.
6. Nutzt du die Web-App: **Bereitstellen > Bereitstellungen verwalten**, auf den Stift klicken, bei Version **Neue Version** wählen und **Bereitstellen**. Der Link bleibt gleich.

## Kurz prüfen

1. **Dashboard** ist das erste Blatt. Oben steht „Pokémon-Sammlung“ mit Version 1.1.0, darunter wann es zuletzt neu gerechnet hat und von wann die Preise sind.
2. Die vier Kacheln: **Gesamtwert** (darunter die Veränderung seit 7 Tagen, grün oder rot), **Karten** (Exemplare, darunter wie viele verschiedene), **Pokédex** (wie viele der 1025 Pokémon, mit Balken), **Wertverlauf** (Linie der letzten 90 Tage, erst ab zwei Tagen im Verlauf).
3. Klicke auf **Karten erfassen**: Die Seitenleiste geht auf. **Importieren** öffnet sie gleich im Tab Import.
4. Klicke auf **Pokédex**: Das Blatt Pokédex ist offen. **Pokémon > Dashboard** bringt dich zurück.
5. Füge eine Karte hinzu und schau aufs Dashboard: Karten und Gesamtwert sind schon mitgezählt.

## Gut zu wissen

- Die Knöpfe sind Bilder, denen das Tool eine Funktion zugewiesen hat. Am Computer reicht ein Klick. In der Sheets-App am Handy reagieren Bilder nicht; dort zeigt das Dashboard nur die Zahlen, Karten erfasst du über die Web-App.
- Steht unten rot „Einige Knöpfe ließen sich nicht laden“, war GitHub gerade nicht erreichbar. Wähle später **Pokémon > Ansicht neu aufbauen**, dann holt das Tool die fehlenden Knöpfe.
- Das Dashboard baut das Tool selbst auf. Verschobene Knöpfe springen beim nächsten Neuaufbau zurück, eigene Einträge auf dem Blatt gehen verloren. Eigene Bilder darfst du draufsetzen, die bleiben.
- Hattest du schon ein eigenes Blatt namens „Dashboard“, bleibt es mit Inhalt erhalten und heißt danach „Dashboard (alt)“, bei beiden Wegen. Das Tool legt sein Dashboard daneben neu an.
- Den Knopf „Einrichtung“ aus der ersten Vorschau gibt es nicht: Den Menüpunkt hat 1.0.3 entfernt, **Karten erfassen** richtet jetzt alles selbst ein.
