# Eine neue Version veröffentlichen

Die Tabellen lesen `releases/channel.json` vom Branch `main` über `raw.githubusercontent.com`. Deshalb muss das Repo **öffentlich** sein, sonst bekommen die Tabellen nur „404“. Code laden die Tabellen nicht: Google erlaubt einem Skript in einer Tabelle nicht, sich selbst zu ersetzen (die Apps-Script-API ist im versteckten Standard-Projekt jedes Skripts gesperrt, getestet am 21.10.2026). Eine neue Version kommt als Kopie der **Vorlage**. Deshalb muss die Vorlage auf der neuen Version sein, bevor der Kanal sie ankündigt.

## Ablauf

1. In `src/Code.gs` die Konstante `TOOL_VERSION` erhöhen:
   - Fehlerbehebung: `1.0.0` → `1.0.1`
   - Neue Funktion: `1.0.1` → `1.1.0`
   - Vorabversion für Freiwillige: `1.1.0-beta.1`, `1.1.0-beta.2` …, danach `1.1.0`

   Die Version steht außerdem oben in jeder Script- und HTML-Datei (Kopfkommentar „Pokémon-Sammlung · Version …“). Den schreibt Schritt 3 selbst; nur die Köpfe nachziehen: `node tools/release.js --stamp`.
2. `SCHEMA_VERSION` nur erhöhen, wenn sich das Format des Blatts „Daten“ ändert (mit Umstellung in `migrateSchema_`). Die Übernahme stellt alte Daten dann selbst um. Eine ältere Version kann eine Tabelle mit neuerem Datenformat nicht übernehmen.
3. In [`CHANGELOG.md`](../CHANGELOG.md) oben einen Abschnitt `## [1.1.0]` anlegen (ohne Datum) und darunter je Neuerung einen Punkt `- …`: ein kurzer Stichpunkt (höchstens 70 Zeichen, kein ganzer Satz), aus Sicht der Nutzer, einfacher Text ohne Markdown, ohne Punkt am Ende. Längere Punkte meldet das Werkzeug als Hinweis. Das sind die Release-Notizen. Dann den Kanal schreiben:

   ```sh
   node tools/release.js
   ```

   Das Werkzeug trägt das Datum in `CHANGELOG.md` ein (heute, mit `--date 2026-10-21` ein anderes), schreibt die Punkte nach `releases/channel.json`, gleicht dort Notizen und Datum der älteren Versionen mit `CHANGELOG.md` ab und setzt die Version oben in die Script- und HTML-Dateien. Eine Version mit Bindestrich (`1.1.0-beta.1`) wird automatisch als Vorabversion eingetragen, `--prerelease` und `--final` legen es ausdrücklich fest. Eine Vorabversion braucht ihre eigene Vorlage: `--template https://docs.google.com/spreadsheets/d/<ID>/copy`. Für die erste Vorabversion gibt es die noch nicht: zuerst anlegen (Abschnitt „Die Vorlage“, Schritte 1 bis 3) oder den Befehl danach mit `--template` wiederholen. Ruft man das Werkzeug für dieselbe Version noch einmal auf, bleiben Datum, Vorabversion und Vorlage; die Notizen kommen immer aus `CHANGELOG.md`. Eine Notiz ändern: in `CHANGELOG.md` ändern und das Werkzeug noch einmal laufen lassen. `npm test` und `node tools/release.js --check` melden, wenn der Kanal, `CHANGELOG.md` oder ein Kopfkommentar nicht zur Version im Code passt (Exit 1). Fehlt für die Version eine Vorlage, gibt `--check` nur einen Hinweis aus: Dann zeigen die Tabellen „Neue Version holen“ nicht.
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

   Den GitHub-Release legt dann der Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) an, mit den Punkten aus `CHANGELOG.md` und einem Hinweis, wie man aktualisiert. Er heißt wie der Tag, einen eigenen Namen kannst du danach auf GitHub setzen. Legst du den Release lieber selbst auf GitHub an (mit neuem Tag oder zu einem vorhandenen), setzt der Workflow beim Veröffentlichen die Notizen aus `CHANGELOG.md` ein, der Name bleibt. Die Notizen zum Ansehen: `node tools/release.js --print-notes v1.1.0`.
8. In einer Testtabelle **Pokémon > Updates > Nach Updates suchen** öffnen: Das fragt sofort bei GitHub nach. **Neue Version holen** ausprobieren und die Übernahme einmal durchspielen. Von selbst merkt eine Tabelle eine neue Version spätestens nach 6 Stunden oder beim nächtlichen Preislauf.

## Regeln

- Die Release-Notizen stehen nur in `CHANGELOG.md`. `releases/channel.json` schreibt `tools/release.js`, nie von Hand.
- Einen veröffentlichten Tag nie verschieben. Fehler werden mit einer neuen Version behoben.
- Eine Version nicht aus `channel.json` löschen, solange Tabellen sie installiert haben.
- Die Namen der Blätter, die die Übernahme kopiert (`updTakeoverSheets_` in `src/Update.gs`), bleiben gleich, oder die neue Version stellt alte Namen in `takeoverRun` selbst um. Die Übernahme läuft immer mit dem Code der neuen Tabelle.
- Ein neues Blatt des Tools gehört in `SHEETS` oder `toolSheetNames_` (`src/Code.gs`). Jede Tabelle speichert diese Liste als `TOOL_SHEETS`. Daran erkennt eine spätere Version bei der Übernahme, dass ein gleichnamiges Blatt in einer älteren Tabelle dem Nutzer gehört, und kopiert es als „… (alt)“.
- Die Namen der Auslöser-Funktionen (`naechtlicherPreislauf`, `continuePriceRun`, `beiStrukturAenderung`) bleiben gleich, sonst laufen bestehende Auslöser nach einem Update von Hand ins Leere.
- Die Funktionen der Dashboard-Knöpfe (`fn` in `DASH_BUTTONS`, `src/Code.gs`) bleiben öffentlich und behalten ihren Namen. Jede Tabelle hat den Namen am Bild gespeichert; bis sie nach einem Update ihre Blätter neu aufbaut, ruft der Knopf noch den alten.
- Neue Bilder für die Dashboard-Knöpfe: `NODE_PATH="$(npm root -g)" node tools/dashboard-knoepfe.js` (braucht Playwright mit Chromium; zeichnet den aktiven Look aus `docs/dashboard/looks.json`, ein anderer Look: `docs/dashboard/README.md`), die PNGs in `assets/dashboard/` committen und pushen, `DASH_ASSETS` auf genau diesen Commit stellen und `DASH_ASSET_VERSION` erhöhen. Prüfen, dass `DASH_ASSETS` + `erfassen.png` im Browser ein Bild zeigt. Den Pull Request mit einem Merge-Commit mergen (nicht „Squash“ oder „Rebase“), dann bleibt der Commit für immer in `main`.
- Eine neue Script- oder HTML-Datei in `src` kommt in `HEADER_FILES` (`tools/release.js`) und bekommt mit `--stamp` den Kopf mit der Version. Ein Test meldet Dateien ohne Kopf. Den Kopf von `Import.gs` schreibt das Werkzeug auch in `parts/00_shared.gs`, sonst wäre er nach `sh build_import.sh` weg.
- Neue Rechte (`oauthScopes` in `src/appsscript.json`) nur, wenn nötig: Google fragt jeden Nutzer bei jeder neuen Tabelle danach.
- Alles, was zur Tabelle gehört, steht im Blatt „Tool-Einstellungen“ (`settingGet_`/`settingSet_`), nicht in den Skript-Eigenschaften. Die sind nur für laufende Vorgänge da.

## Die Vorlage

Neue Nutzer kopieren die Vorlage-Tabelle (`templateUrl` in `releases/channel.json`, Form `https://docs.google.com/spreadsheets/d/<ID>/copy`), und **Neue Version holen** kopiert sie für bestehende Nutzer. Für Vorabversionen gibt es eine zweite Vorlage (`--template` beim Release). So entsteht und bleibt eine Vorlage aktuell:

1. Neue, leere Tabelle anlegen, den Code wie unter „Von Hand aktualisieren“ im README einfügen (vor dem Mergen den Code aus `src` des Pull-Request-Branchs, den Tag gibt es dann noch nicht), **Pokémon > Karten erfassen** öffnen. Das richtet die Tabelle ein.
2. Danach in Apps Script unter **Trigger** alle Auslöser löschen (die Vorlage soll nachts keine Preise holen) und unter **Projekteinstellungen > Skripteigenschaften** die Eigenschaft `SPREADSHEET_ID` löschen. Kopien bekommen sie beim ersten Öffnen selbst.
3. Keine Karten eintragen. Freigeben: „Jeder mit dem Link“ als Betrachter. In den Freigabe-Einstellungen (Zahnrad) muss „Betrachter und Kommentatoren können die Optionen zum Herunterladen, Drucken und Kopieren sehen“ an sein, sonst kann **Neue Version holen** sie nicht kopieren.
4. Den Link der Vorlage im Kanal eintragen, einmal für die Hauptvorlage: `node tools/release.js --main-template https://docs.google.com/spreadsheets/d/<ID>/copy`. Eine Vorlage für Vorabversionen kommt dagegen beim Release mit `--template` an die Version.
5. Bei jeder neuen Version den Code der Vorlage von Hand ersetzen (README „Von Hand aktualisieren“, den Code aus `src` des Pull-Request-Branchs), **Pokémon > Karten erfassen** einmal öffnen und danach Schritt 2 wiederholen (Karten erfassen speichert dabei `SPREADSHEET_ID` wieder). Die Hauptvorlage bekommt nur fertige Versionen, eine Vorabversion kommt in ihre eigene Vorlage.

Eine Kopie erkennt sich am Eintrag `Tabellen-ID` im versteckten Blatt „Tool-Einstellungen“: Steht dort eine andere ID, richtet sie sich beim ersten Öffnen der Seitenleiste ein. Eine Kopie von **Neue Version holen** trägt dazu `TAKE_FROM` (Link der alten Tabelle) und bietet die Übernahme sofort an.
