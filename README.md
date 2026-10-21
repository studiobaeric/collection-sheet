# collection-sheet

Ein Google-Sheets-Tool für Pokémon-Kartensammlungen. Karten werden über die [tcgdex-API](https://tcgdex.dev) gesucht und mit Bild, Set und Cardmarket-Trendpreis in einer durchsuchbaren Sammlung gespeichert. Eine Seitenleiste und eine Web-App fürs Handy fügen Karten hinzu, zählen sie hoch und runter und importieren bestehende Listen. Ein Pokédex-Blatt zeigt, welche Pokémon schon in der Sammlung sind.

Nicht verbunden mit Nintendo, Creatures, Game Freak oder The Pokémon Company. Kartenbilder und -daten kommen von tcgdex.

## Stand

Das Tool läuft als Apps-Script-Projekt, das an eine Google-Tabelle gebunden ist. Eine Vorlage zum Kopieren und der Update-Knopf sind in Arbeit (siehe `docs/plan.md`, Abschnitt „Release und Updates“).

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/` | Die Dateien, die ins Apps-Script-Projekt gehören: `Code.gs`, `Ui.html`, `Import.gs`, `ImportUi.html` |
| `parts/` | Quelle von `src/Import.gs`; `sh build_import.sh` baut daraus die Datei |
| `test/` | Tests mit Apps-Script-Attrappen in Node (`npm install`, dann `npm test`) |
| `backup/` | Version 1 des Codes, gegen die `test/test_integration.js` die Umstellung prüft |
| `docs/` | Plan, Bau-Spezifikation, Installationsanleitungen |
| `tools/update-test/` | Einmaliger Test, ob ein gebundenes Skript sich über die Apps-Script-API selbst aktualisieren kann |

## Lizenz

[PolyForm Noncommercial 1.0.0](LICENSE): Nutzen und Ändern für private, nicht-kommerzielle Zwecke ist erlaubt, Verkaufen oder geschäftliche Nutzung nicht.
