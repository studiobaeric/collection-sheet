# Dashboard installieren (Version 1.1.0, Stand 22.10.2026)

Version 1.1.0 bringt das Blatt **Dashboard**, die Suche nach dem Künstler und den Preisverlauf pro Karte. Sie enthält auch alles aus 1.0.3. Deine Karten, Importe, der Verlauf und der nächtliche Preislauf bleiben, wie sie sind.

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

1. In Apps Script steht ganz oben in `Code.gs`, `Import.gs`, `Update.gs`, `Ui.html` und `ImportUi.html` „Pokémon-Sammlung · Version 1.1.0“. Zeigt eine Datei nichts oder eine ältere Version, hast du sie noch nicht ersetzt.
2. **Dashboard** ist das erste Blatt, und beim Öffnen der Tabelle springt sie dorthin. Oben steht „Pokémon-Sammlung“ mit Version 1.1.0, darunter wann es zuletzt neu gerechnet hat und von wann die Preise sind.
3. Die vier Kacheln: **Gesamtwert** (darunter die Veränderung seit 7 Tagen, grün oder rot), **Karten** (Exemplare, darunter wie viele verschiedene), **Pokédex** (wie viele der 1025 Pokémon, mit Balken), **Wertverlauf** (Linie der letzten 90 Tage, erst ab zwei Tagen im Verlauf).
4. Klicke auf **Karten erfassen**: Die Seitenleiste geht auf. **Importieren** öffnet sie gleich im Tab Import.
5. Klicke auf **Pokédex**: Das Blatt Pokédex ist offen. **Pokémon > Dashboard** bringt dich zurück.
6. Füge eine Karte hinzu und schau aufs Dashboard: Karten und Gesamtwert sind schon mitgezählt.
7. Tippe in der Seitenleiste im Tab Sammlung den Nachnamen eines Künstlers ins Suchfeld, z. B. „Arita“: Es kommen seine Karten, unter jeder steht „Illus. …“. Im Blatt Sammlung geht das genauso im gelben Suchfeld.
8. Im Blatt Sammlung stehen nach „Wert (EUR)“ die Spalten **± 30 Tage (EUR)**, **± 30 Tage (%)** und **Verlauf seit**. Am ersten Tag nach dem Update sind sie leer: Der Preisverlauf jeder Karte beginnt mit dem ersten Preislauf danach (in der Nacht oder mit **Preise jetzt aktualisieren**). Ab dem zweiten Tag mit Preislauf steht dort die Veränderung (auch ±0, wenn der Preis gleich blieb), mit „Verlauf seit“, bis es den Verlauf 30 Tage gibt.
9. In der Seitenleiste wählst du unter „Preisveränderung über“ 7, 30 oder 90 Tage. Klappst du eine Karte auf, steht oben ihre Preiskurve, nach dem ersten Preislauf mit einem Punkt, danach als Linie.

## Gut zu wissen

- Die Knöpfe sind Bilder, denen das Tool eine Funktion zugewiesen hat. Am Computer reicht ein Klick. In der Sheets-App am Handy reagieren Bilder nicht; dort zeigt das Dashboard nur die Zahlen, Karten erfasst du über die Web-App.
- Steht unten rot „Einige Knöpfe ließen sich nicht laden“, war GitHub gerade nicht erreichbar. Wähle später **Pokémon > Ansicht neu aufbauen**, dann holt das Tool die fehlenden Knöpfe.
- Das Dashboard baut das Tool selbst auf. Verschobene Knöpfe springen beim nächsten Neuaufbau zurück, eigene Einträge auf dem Blatt gehen verloren. Eigene Bilder darfst du draufsetzen, die bleiben.
- Hattest du schon ein eigenes Blatt namens „Dashboard“, bleibt es mit Inhalt erhalten und heißt danach „Dashboard (alt)“, bei beiden Wegen. Das Tool legt sein Dashboard daneben neu an.
- Der Preisverlauf liegt im versteckten Blatt „Kartenverlauf“, eine Zeile pro Karte und Variante. Er kommt bei „Neue Version holen“ mit. Hattest du schon ein eigenes Blatt mit dem Namen, heißt es danach „Kartenverlauf (alt)“.
- Den Knopf „Einrichtung“ aus der ersten Vorschau gibt es nicht: Den Menüpunkt hat 1.0.3 entfernt, **Karten erfassen** richtet jetzt alles selbst ein.
