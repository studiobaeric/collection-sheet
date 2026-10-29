# Changelog

Was sich in jeder Version des Tools geändert hat, neueste zuerst. Daraus entstehen die Release-Notizen: `node tools/release.js` schreibt die Punkte nach `releases/channel.json`, die Tabellen zeigen sie unter **Updates**. Beim Push eines Tags `v…` legt GitHub den Release mit denselben Punkten an.

Eine neue Version eintragen (Ablauf in [docs/RELEASE.md](docs/RELEASE.md)):

- Oben einen Abschnitt `## [1.2.0]` anlegen, ohne Datum. Das Datum trägt `tools/release.js` beim Release ein.
- Je Neuerung ein kurzer Stichpunkt (höchstens 70 Zeichen, kein ganzer Satz), aus Sicht der Nutzer, als einfacher Text ohne Markdown (die Tabellen zeigen ihn so, wie er hier steht) und ohne Punkt am Ende. Details gehören in die Anleitung, nicht hierher.

## [1.2.1] – 2026-10-29

- Set-Symbol statt Set-Name in Treffern, Sammlung und Bestätigung
- Promo-Sets zeigen einen einheitlichen Stern
- Setfeld mit Auswahlliste aus Symbol und Name
- Nummer geht auch im Namensfeld, z. B. „Pikachu 12“
- Nach dem Hinzufügen bleiben Treffer und Name, Nummer und Set leer
- Feld Anzahl entfernt, jedes Hinzufügen ist ein Exemplar
- Englische Ersatzdaten als graue Zeile zum Aufklappen
- Sammlung: schlanke Zeile mit Symbol, Nummer und Anzahl
- Aufgeklappt: Karteninfo als Tabelle, Preis mit Veränderung
- „+ Exemplar“ statt +1, mit eigener Sprache und eigenem Zustand
- −1 nur noch am einzelnen Exemplar
- Eigener Preis hinter einem Link in der Karteninfo
- Bilder in der Sammlung klein, mittel oder groß
- Größerer Pfeil, die ganze Zeile klappt auf

## [1.2.0] – 2026-10-29

- Sammlung, Pokédex und Dashboard rechnen selbst, ohne Einsortieren
- Änderungen stehen sofort überall, die roten Hinweise sind weg
- Hinzufügen, +1 und Ändern speichern deutlich schneller
- Kartensuche fragt tcgdex direkt aus dem Browser und ist schneller
- Antippen eines Treffers öffnet die Karte sofort, mit Preis
- Suche nach „Glurak ex“ oder englischen Karten braucht weniger Abrufe
- Unter Apps Script > Ausführungen steht, wie lange jeder Schritt dauert

## [1.1.3] – 2026-10-28

- Nächste Suche wartet nicht mehr auf das Speichern der vorigen Karte
- Hinzufügen und Ändern speichern erst nur ins Blatt Daten
- Knopf „Einsortieren“ aktualisiert Sammlung, Pokédex und Dashboard
- Roter Hinweis, solange Änderungen noch nicht einsortiert sind
- Einsortieren auch im Menü, im Dashboard und nachts von selbst
- Suche merkt sich Sets und Trefferlisten, Wiederholen geht schneller
- Suche im Blatt Sammlung rechnet schneller, auch bei großen Sammlungen
- Suchen im Blatt startet kein Skript mehr, die Zeilen springen nicht
- Mit Bildern sind alle Zeilen der Sammlung gleich hoch
- Hinzufügen mit Bildern wartet nicht mehr auf die Zeilenhöhen
- Tab Sammlung lädt schon beim Öffnen, danach ohne Warten
- Import-Tab öffnen lädt die Sammlung nicht mehr neu
- Knopf „Nochmal +1“ nach dem Hinzufügen entfernt

## [1.1.2] – 2026-10-27

- Hinzufügen: leeres Formular sofort, Karte speichert im Hintergrund
- Zuletzt hinzugefügte Karte steht unter dem Formular
- Antippen zeigt die neue Karte oben in der Sammlung
- Fehler beim Speichern: zwei neue Versuche, dann „Nochmal versuchen“
- Keine doppelten Karten, wenn ein Speichern wiederholt wird
- Warnung, wenn die Script-Dateien nicht dieselbe Version haben
- Fehlt eine Script-Datei, nennt das Tool sie gleich beim Start
- Treffer antippen geht schneller, die Karte ist schon geladen
- Handy-Seite lädt schneller, ohne das Import-Werkzeug

## [1.1.1] – 2026-10-25

- Prüfliste: offene Zeilen sind als freie Karte vorausgewählt
- Prüfliste: Leiste oben mit „Weiter zur Vorschau“
- Vorschau: zeigt, wie viele Zeilen als freie Karte kommen
- Nach Einrichtung und Update öffnet das Dashboard, nicht die Sammlung
- Laufanzeige unten rechts, bis Einrichtung oder Update fertig ist
- Seitenleiste und Handy-Seite: keine Preiskurve und kein 7/30/90 mehr
- Preisänderung in der Sammlung fest über 30 Tage
- Sammlung zeigt alle Karten, Suchen und Sortieren ohne Warten
- Änderungen speichern im Hintergrund, Karte bleibt an ihrer Stelle
- „Neu laden“ holt Änderungen aus dem Blatt oder vom Handy
- Hinzufügen, +1/−1 und Bearbeiten speichern schneller

## [1.1.0] – 2026-10-23

- Neues Blatt „Dashboard“ mit Gesamtwert, Pokédex-Fortschritt und Wertverlauf
- Dashboard-Knöpfe für alle Menüpunkte (nur am Computer)
- Neuer Menüpunkt „Pokémon > Dashboard“
- Version oben in jeder Script- und HTML-Datei
- Suche nach Künstler, z. B. „Arita“
- Preisverlauf pro Karte: Veränderung über 7, 30 oder 90 Tage
- Preiskurve pro Karte in Seitenleiste und Handy-Seite
- Preisverlauf auch für Karten mit eigenem Preis

## [1.0.3] – 2026-10-22

- Neue Tabelle heißt nach der Version in der Vorlage
- Keine Kopie, wenn die Vorlage noch nicht auf der neuen Version ist
- Erklärung zur gelben Google-Leiste „Daten externer Nutzer“
- Menüpunkt „Einrichtung“ entfernt, „Karten erfassen“ richtet alles ein

## [1.0.2] – 2026-10-22

- „Neue Version holen“ legt nur noch eine Tabelle pro Version an
- Gelöschte neue Tabelle lässt sich wieder anlegen

## [1.0.1] – 2026-10-22

- Import: kein Speicherfehler mehr bei Tabs mit vielen leeren Zeilen
- Tab-Auswahl im Import zeigt die echte Zeilenzahl

## [1.0.0] – 2026-10-21

- Hinweis auf neue Versionen, „Neue Version holen“ kopiert die Vorlage
- Übernahme der alten Tabelle mit einem Klick
- Vorabversionen für Freiwillige (Schalter im Bereich Updates)
- Einstellungen stehen jetzt im versteckten Blatt „Tool-Einstellungen“
