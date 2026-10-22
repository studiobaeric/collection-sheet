# collection-sheet

Ein Google-Sheets-Tool für Pokémon-Kartensammlungen. Karten werden über die [tcgdex-API](https://tcgdex.dev) gesucht und mit Bild, Set und Cardmarket-Trendpreis in einer durchsuchbaren Sammlung gespeichert. Eine Seitenleiste und eine Web-App fürs Handy fügen Karten hinzu, zählen sie hoch und runter und importieren bestehende Listen. Ein Pokédex-Blatt zeigt, welche Pokémon schon in der Sammlung sind.

Nicht verbunden mit Nintendo, Creatures, Game Freak oder The Pokémon Company. Kartenbilder und -daten kommen von tcgdex.

## Stand

Version 1.0.0. Das Tool läuft als Apps-Script-Projekt, das an eine Google-Tabelle gebunden ist. Neue Nutzer starten mit einer Kopie der [Vorlage](https://docs.google.com/spreadsheets/d/18B0oYylWj5QgsYu8RRCrBktAn40TbvTGKPTDci6JTyE/copy).

## Einrichten

1. Öffne die [Vorlage](https://docs.google.com/spreadsheets/d/18B0oYylWj5QgsYu8RRCrBktAn40TbvTGKPTDci6JTyE/copy) und klicke auf **Kopie erstellen**. Die Kopie landet in deiner „Meine Ablage“.
2. Öffne in deiner Kopie **Pokémon > Karten erfassen**. Google fragt einmal nach den Berechtigungen des Skripts. Erscheint „Google hat diese App nicht überprüft“, klicke auf **Erweitert**, dann auf **Weiter zu … (unsicher)** und auf **Zulassen**. Das Skript gehört zu deiner eigenen Kopie und läuft nur in deinem Konto.
3. Beim ersten Öffnen richtet sich die Kopie selbst ein: Blätter, nächtlicher Preislauf und die Liste der Sets. Zeigt Google oben eine gelbe Leiste „Einige Formeln erfordern das Versenden und Empfangen von Daten externer Nutzer“, klicke auf **Zugriff erlauben**. Gemeint sind die Kartenbilder: Die Tabelle lädt sie mit `IMAGE`-Formeln von tcgdex.net. Dabei geht nur die Bildadresse der Karte an tcgdex, deine Sammlung bleibt in der Tabelle. Ohne Freigabe bleiben nur die Bilder leer.

Am Handy nutzt du die Web-App: Erweiterungen > Apps Script > **Bereitstellen > Neue Bereitstellung > Web-App**, dann den Link mit **Pokémon > Web-App-Link anzeigen** speichern.

## Updates

Gibt es eine neue Version, zeigen Seitenleiste und Web-App oben einen Hinweis. Unten in der Seitenleiste führt **Updates** (oder **Pokémon > Updates > Nach Updates suchen**) zum Bereich mit allen Neuerungen. Die alte Version läuft weiter, bis du selbst wechselst.

Google erlaubt einem Skript in einer Tabelle nicht, seinen eigenen Code zu ersetzen. Eine neue Version kommt deshalb als neue Tabelle:

1. **Neue Version holen** (nur in der Seitenleiste am Computer) legt eine Kopie der Vorlage mit der neuen Version im selben Ordner an (geht das nicht, in „Meine Ablage“; die Seitenleiste sagt, wo). Hier ändert sich dabei nichts.
2. Öffne die neue Tabelle und dort **Pokémon > Karten erfassen**. Google fragt bei jeder neuen Tabelle einmal nach den Berechtigungen. Die gelbe Leiste zu „Daten externer Nutzer“ meint die Kartenbilder (siehe „Einrichten“): **Zugriff erlauben**.
3. Die Seitenleiste bietet dir sofort die Übernahme an: **Jetzt übernehmen**. Die neue Tabelle bekommt den Namen der alten, die alte heißt danach „… (alt)“. Wer die alte Tabelle sehen oder bearbeiten durfte, darf das auch in der neuen (ohne E-Mail an diese Personen).
4. Nutzt du die Handy-Seite: In der neuen Tabelle neu bereitstellen und den Link unter **Pokémon > Web-App-Link anzeigen** einfügen. Die alte Handy-Seite verweist dann auf die neue.

Mit **Vorabversionen bekommen** probierst du neue Versionen aus, bevor alle sie bekommen. Sie können noch Fehler haben.

Wer Tabelle und Handy-Link behalten will, kann den Code auch von Hand einfügen (Abschnitt „Von Hand aktualisieren“).

## Aus alter Tabelle übernehmen

In einer neuen, leeren Tabelle (über „Neue Version holen“ oder eine Kopie der Vorlage): **Pokémon > Updates > Aus alter Tabelle übernehmen**, den Link der alten Tabelle einfügen, **Prüfen**, dann **Jetzt übernehmen**. Übernommen werden alle Karten, Importe samt Protokoll, der Verlauf, Seltenheiten, Übersetzungen, Einstellungen der Sammlung, die Freigaben und deine eigenen Blätter. Heißt ein eigenes Blatt so wie ein Blatt des Tools, kommt es als „… (alt)“ mit. Eigene Änderungen am Skript kommen nicht mit. Die Web-App bekommt in der neuen Tabelle einen neuen Link.

Bricht die Übernahme ab (zum Beispiel weil Google eine Ausführung nach sechs Minuten beendet), bleibt die alte Tabelle, wie sie war. Öffne die neue Tabelle dann noch einmal über **Pokémon > Karten erfassen** und klicke wieder auf **Jetzt übernehmen**. Was schon übernommen war, wird dabei ersetzt; trag bis dahin also nichts in der neuen Tabelle ein. Sagt die Seitenleiste, dass die Übernahme gerade läuft, warte zwei Minuten und öffne sie dann noch einmal.

Die alte Tabelle wird danach stillgelegt. Ab Version 1.0 geschieht das von selbst: Sie zeigt nur noch einen Hinweis auf die neue und ruft keine Preise mehr ab. Ihre Daten bleiben zum Nachsehen. Willst du doch dort weitermachen, wähle in ihr **Pokémon > Diese Tabelle wieder benutzen**. Was du inzwischen in der neuen Tabelle geändert hast, fehlt dann dort.

Eine Tabelle mit einer älteren Version bekommt vorne ein Blatt mit dem Hinweis, läuft aber sonst weiter, bis du dort die Trigger löschst und die Web-App archivierst. Die Schritte stehen in diesem Blatt.

## Von Hand aktualisieren

1. Öffne auf GitHub die Version, die du willst (unter **Releases** oder **Tags**), und dort den Ordner `src`.
2. Öffne deine Tabelle und klicke auf **Erweiterungen > Apps Script**.
3. Klicke links auf das Zahnrad (**Projekteinstellungen**) und hake **Manifestdatei „appsscript.json“ im Editor anzeigen** an.
4. Ersetze den Inhalt dieser Dateien jeweils komplett durch den aus `src`: `Code.gs`, `Import.gs`, `Update.gs`, `Ui.html`, `ImportUi.html` und `appsscript.json`. Fehlt eine Datei, lege sie über **+** an (Skript oder HTML) und gib ihr den Namen ohne Endung, zum Beispiel `Update` oder `ImportUi`.
5. Speichere mit dem Disketten-Symbol.
6. Lade die Tabelle neu und öffne **Pokémon > Karten erfassen**. Google fragt nach neuen Berechtigungen, falls die Version welche braucht (bei „Google hat diese App nicht überprüft“: **Erweitert**, **Weiter zu … (unsicher)**, **Zulassen**). Die Blätter bringt das Tool dabei selbst auf den neuen Stand.
7. Nutzt du die Web-App: **Bereitstellen > Bereitstellungen verwalten**, auf den Stift klicken, prüfen, ob „Ausführen als“ und „Zugriff“ noch stimmen, bei Version **Neue Version** wählen und **Bereitstellen**. Der Link bleibt gleich.

`appsscript.json` enthält die Zeitzone Europe/Berlin. Wohnst du woanders, stelle sie danach in den Projekteinstellungen um.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/` | Die Dateien, die ins Apps-Script-Projekt gehören: `Code.gs`, `Ui.html`, `Import.gs`, `ImportUi.html`, `Update.gs`, `appsscript.json` |
| `releases/` | `channel.json`: die Liste der Versionen mit Neuerungen und Vorlage, die die Tabellen lesen |
| `tools/` | `release.js` schreibt einen Release in `releases/channel.json` (siehe `docs/RELEASE.md`) |
| `parts/` | Quelle von `src/Import.gs`; `sh build_import.sh` baut daraus die Datei |
| `test/` | Tests mit Apps-Script-Attrappen in Node (`npm install`, dann `npm test`) |
| `backup/` | Version 1 des Codes, gegen die `test/test_integration.js` und `test/test_update.js` die Umstellung prüfen |
| `docs/` | Plan, Bau-Spezifikation, Release-Ablauf, Installationsanleitungen |

## Lizenz

[PolyForm Noncommercial 1.0.0](LICENSE): Nutzen und Ändern für private, nicht-kommerzielle Zwecke ist erlaubt, Verkaufen oder geschäftliche Nutzung nicht.
