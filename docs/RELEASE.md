# Eine neue Version veröffentlichen

Die Tabellen lesen `releases/channel.json` vom Branch `main` über `raw.githubusercontent.com`. Deshalb muss das Repo **öffentlich** sein, sonst bekommen die Tabellen nur „404“. Code laden die Tabellen nicht: Google erlaubt einem Skript in einer Tabelle nicht, sich selbst zu ersetzen (die Apps-Script-API ist im versteckten Standard-Projekt jedes Skripts gesperrt, getestet am 21.10.2026). Eine neue Version kommt als Kopie der **Vorlage**. Deshalb muss die Vorlage auf der neuen Version sein, bevor der Kanal sie ankündigt.

## Ablauf

1. In `src/Code.gs` die Konstante `TOOL_VERSION` erhöhen:
   - Fehlerbehebung: `1.0.0` → `1.0.1`
   - Neue Funktion: `1.0.1` → `1.1.0`
   - Vorabversion für Freiwillige: `1.1.0-beta.1`, `1.1.0-beta.2` …, danach `1.1.0`
2. `SCHEMA_VERSION` nur erhöhen, wenn sich das Format des Blatts „Daten“ ändert (mit Umstellung in `migrateSchema_`). Die Übernahme stellt alte Daten dann selbst um. Eine ältere Version kann eine Tabelle mit neuerem Datenformat nicht übernehmen.
3. Den Kanal schreiben:

   ```sh
   node tools/release.js --notes "Was ist neu, Punkt 1" --notes "Punkt 2"
   ```

   Eine Version mit Bindestrich (`1.1.0-beta.1`) wird automatisch als Vorabversion eingetragen, `--prerelease` und `--final` legen es ausdrücklich fest. Eine Vorabversion braucht ihre eigene Vorlage: `--template https://docs.google.com/spreadsheets/d/<ID>/copy`. Für die erste Vorabversion gibt es die noch nicht: zuerst anlegen (Abschnitt „Die Vorlage“, Schritte 1 bis 3) oder den Befehl danach mit `--template` wiederholen. Ruft man das Werkzeug für dieselbe Version noch einmal auf, bleiben Notizen, Datum, Vorabversion und Vorlage. `npm test` und `node tools/release.js --check` melden, wenn der Kanal nicht zur Version im Code passt (Exit 1). Fehlt für die Version eine Vorlage, gibt `--check` nur einen Hinweis aus: Dann zeigen die Tabellen „Neue Version holen“ nicht.
4. `npm test` muss grün sein (erst nach Schritt 3: Ein Test prüft, dass der Kanal zur Version passt).
5. Committen, pushen, Pull Request, Tests grün, Review.
6. **Vor dem Mergen** die Vorlage auf die neue Version bringen (Abschnitt „Die Vorlage“), mit dem Code aus dem Ordner `src` des Pull-Request-Branchs: Der Tag entsteht erst nach dem Mergen. Bei einer Vorabversion nur ihre eigene Vorlage (die bei `--template`), die Hauptvorlage bekommt nur fertige Versionen. Sobald `channel.json` auf `main` steht, sehen alle Tabellen die Version und kopieren die Vorlage.
7. Mergen, dann den Merge-Commit taggen. Die Anleitung „Von Hand aktualisieren“ verweist auf die Tags:

   ```sh
   git checkout main && git pull
   node tools/release.js --check
   git tag v1.1.0
   git push origin v1.1.0
   ```

   Auf GitHub kann man aus dem Tag zusätzlich einen Release mit den Notizen machen.
8. In einer Testtabelle **Pokémon > Updates > Nach Updates suchen** öffnen: Das fragt sofort bei GitHub nach. **Neue Version holen** ausprobieren und die Übernahme einmal durchspielen. Von selbst merkt eine Tabelle eine neue Version spätestens nach 6 Stunden oder beim nächtlichen Preislauf.

## Regeln

- Einen veröffentlichten Tag nie verschieben. Fehler werden mit einer neuen Version behoben.
- Eine Version nicht aus `channel.json` löschen, solange Tabellen sie installiert haben.
- Die Namen der Blätter, die die Übernahme kopiert (`updTakeoverSheets_` in `src/Update.gs`), bleiben gleich, oder die neue Version stellt alte Namen in `takeoverRun` selbst um. Die Übernahme läuft immer mit dem Code der neuen Tabelle.
- Ein neues Blatt des Tools gehört in `SHEETS` oder `toolSheetNames_` (`src/Code.gs`). Jede Tabelle speichert diese Liste als `TOOL_SHEETS`. Daran erkennt eine spätere Version bei der Übernahme, dass ein gleichnamiges Blatt in einer älteren Tabelle dem Nutzer gehört, und kopiert es als „… (alt)“.
- Die Namen der Auslöser-Funktionen (`naechtlicherPreislauf`, `continuePriceRun`, `beiStrukturAenderung`) bleiben gleich, sonst laufen bestehende Auslöser nach einem Update von Hand ins Leere.
- Neue Rechte (`oauthScopes` in `src/appsscript.json`) nur, wenn nötig: Google fragt jeden Nutzer bei jeder neuen Tabelle danach.
- Alles, was zur Tabelle gehört, steht im Blatt „Tool-Einstellungen“ (`settingGet_`/`settingSet_`), nicht in den Skript-Eigenschaften. Die sind nur für laufende Vorgänge da.

## Die Vorlage

Neue Nutzer kopieren die Vorlage-Tabelle (`templateUrl` in `releases/channel.json`, Form `https://docs.google.com/spreadsheets/d/<ID>/copy`), und **Neue Version holen** kopiert sie für bestehende Nutzer. Für Vorabversionen gibt es eine zweite Vorlage (`--template` beim Release). So entsteht und bleibt eine Vorlage aktuell:

1. Neue, leere Tabelle anlegen, den Code wie unter „Von Hand aktualisieren“ im README einfügen (vor dem Mergen den Code aus `src` des Pull-Request-Branchs, den Tag gibt es dann noch nicht), **Pokémon > Karten erfassen** öffnen. Das richtet die Tabelle ein.
2. Danach in Apps Script unter **Trigger** alle Auslöser löschen (die Vorlage soll nachts keine Preise holen) und unter **Projekteinstellungen > Skripteigenschaften** die Eigenschaft `SPREADSHEET_ID` löschen. Kopien bekommen sie beim ersten Öffnen selbst.
3. Keine Karten eintragen. Freigeben: „Jeder mit dem Link“ als Betrachter. In den Freigabe-Einstellungen (Zahnrad) muss „Betrachter und Kommentatoren können die Optionen zum Herunterladen, Drucken und Kopieren sehen“ an sein, sonst kann **Neue Version holen** sie nicht kopieren.
4. Den Link der Vorlage im Kanal eintragen, einmal für die Hauptvorlage: `node tools/release.js --main-template https://docs.google.com/spreadsheets/d/<ID>/copy`. Eine Vorlage für Vorabversionen kommt dagegen beim Release mit `--template` an die Version.
5. Bei jeder neuen Version den Code der Vorlage von Hand ersetzen (README „Von Hand aktualisieren“, den Code aus `src` des Pull-Request-Branchs), **Pokémon > Karten erfassen** einmal öffnen und danach Schritt 2 wiederholen (Karten erfassen legt einen fehlenden nächtlichen Preislauf wieder an, auch in der Vorlage). Die Hauptvorlage bekommt nur fertige Versionen, eine Vorabversion kommt in ihre eigene Vorlage.

Eine Kopie erkennt sich am Eintrag `Tabellen-ID` im versteckten Blatt „Tool-Einstellungen“: Steht dort eine andere ID, richtet sie sich beim ersten Öffnen der Seitenleiste ein. Eine Kopie von **Neue Version holen** trägt dazu `TAKE_FROM` (Link der alten Tabelle) und bietet die Übernahme sofort an.
