# Changelog

Was sich in jeder Version des Tools geändert hat, neueste zuerst. Daraus entstehen die Release-Notizen: `node tools/release.js` schreibt die Punkte nach `releases/channel.json`, die Tabellen zeigen sie unter **Updates**. Beim Push eines Tags `v…` legt GitHub den Release mit denselben Punkten an.

Eine neue Version eintragen (Ablauf in [docs/RELEASE.md](docs/RELEASE.md)):

- Oben einen Abschnitt `## [1.2.0]` anlegen, ohne Datum. Das Datum trägt `tools/release.js` beim Release ein.
- Je Neuerung ein Punkt in einer Zeile, aus Sicht der Nutzer, als einfacher Text ohne Markdown (die Tabellen zeigen ihn so, wie er hier steht) und ohne Punkt am Ende.

## [1.1.0] – 2026-10-22

- Neues Blatt „Dashboard“ ganz vorne: Gesamtwert mit Veränderung seit 7 Tagen, Anzahl Karten, Pokédex-Fortschritt und Wertverlauf der letzten 90 Tage. Am Computer startet die Tabelle dort
- Knöpfe im Dashboard für Karten erfassen, Preise aktualisieren, Importieren, Updates, Sets und Übersetzung, Ansicht neu aufbauen und den Handy-Link, dazu Knöpfe zu Sammlung, Pokédex, Verlauf und Seltenheiten
- Die Knöpfe funktionieren am Computer. In der Sheets-App am Handy zeigt das Dashboard nur die Zahlen, Karten erfasst du dort wie bisher über die Handy-Seite
- Neuer Menüpunkt „Pokémon > Dashboard“
- Oben in jeder Script- und HTML-Datei steht jetzt die Version, so siehst du beim Aktualisieren von Hand, welchen Stand jede Datei hat

## [1.0.3] – 2026-10-22

- Die neue Tabelle von „Neue Version holen“ heißt nach der Version, die wirklich in der Vorlage steckt
- Ist die Vorlage noch nicht auf der angekündigten Version, legt das Tool keine Kopie an und sagt das
- Die Update-Schritte und die Übernahme erklären die gelbe Google-Leiste zu „Daten externer Nutzer“ (Kartenbilder)
- Der Menüpunkt „Einrichtung“ ist weg: „Karten erfassen“ richtet alles ein und legt fehlende Blätter und den nächtlichen Preislauf von selbst wieder an

## [1.0.2] – 2026-10-22

- „Neue Version holen“ legt pro Version nur noch eine neue Tabelle an, auch bei Doppelklick oder zwei offenen Fenstern
- Wurde die neue Tabelle gelöscht, lässt sie sich wieder anlegen

## [1.0.1] – 2026-10-22

- Import: Tabs mit sehr vielen leeren Zeilen (z. B. Kästchen bis ganz unten) führen nicht mehr zu „Fehler aufgrund fehlenden Speichers“
- Die Tab-Auswahl im Import zeigt die echte Zeilenzahl

## [1.0.0] – 2026-10-21

- Neue Versionen: Hinweis in Seitenleiste und Web-App, „Neue Version holen“ legt eine neue Tabelle aus der Vorlage an
- Übernahme aus der alten Tabelle mit einem Klick, die alte wird stillgelegt und lässt sich wieder benutzen
- Vorabversionen für Freiwillige (Schalter im Bereich Updates)
- Einstellungen stehen jetzt im versteckten Blatt „Tool-Einstellungen“
