# Plan: Pokémon-Sammlung in Google Sheets

Stand 2026-10-14, mit Eric abgestimmt. Bearbeitbare Fassung mit Diagrammen: https://claude.ai/code/artifact/b28c45b7-572b-49bc-9788-cdfdadf2fec1 (diese Datei ist eine Kopie für spätere Bau-Threads; bei Abweichungen gilt das Dokument).

## Ziel und Umfang

Ein Google Sheet mit Apps-Script-Oberfläche erfasst deutsche Pokémon-Karten über die tcgdex-API, zählt sie hoch und runter und zeigt die Sammlung durchsuchbar mit täglich aktualisiertem Cardmarket-Trendpreis. Einträge mit 0 Karten bleiben erhalten.

| Thema | Entscheidung |
| --- | --- |
| Oberfläche | HTML-Sidebar im Sheet (Desktop) plus dieselbe Oberfläche als Web-App fürs Handy |
| Kartensprache | Fast nur Deutsch, Suche über tcgdex `de` |
| Deutsche Karte fehlt | Name lokal per Übersetzungstabelle ins Englische, zweite Suche über tcgdex `en`; letzter Weg Set plus Nummer |
| Übersetzungstabelle | Per Menüpunkt aus tcgdex erzeugt (deutsche und englische Kartenliste, gepaart über die Karten-ID), eigene Einträge möglich |
| Eintrag | Karte + Variante + Zustand, Zustand optional |
| Variante | Standard ohne Holo; Checkbox Reverse Holo und 1. Edition nur, wenn tcgdex die Variante kennt; Holo-Rares automatisch als Holo |
| Suchfelder Hinzufügen | Name, Nummer (auch als 025/165), Set optional mit Vorschlagsliste |
| Nach dem Hinzufügen | Formular wird geleert; Mehrfache über das Feld Anzahl oder +1 in der Sammlung (Knopf Nochmal +1 seit 1.1.3 entfernt, #34) |
| Entfernen | Lokale Suche, Knöpfe -1 und +1 wirken sofort, kurz Rückgängig möglich |
| 0er-Einträge | Standardmäßig versteckt, per Schalter ausgegraut sichtbar, in Suchergebnissen immer ganz unten |
| Sammlungssuche | Ein Suchfeld (Name oder Nummer) plus Set-Filter, per Formel |
| Sortierung | Dropdown: Set und Nummer (Standard), Name, Wert, zuletzt hinzugefügt |
| Bilder in der Ansicht | Per Schalter ein- und ausblendbar |
| Spalten | Erweitert, inklusive Seltenheit, Kartentyp, Illustrator, Preisstand |
| Preis | Cardmarket Trend in Euro |
| Preisaktualisierung | Täglich automatisch in der Nacht plus Knopf |
| Wertverlauf | Eine Zeile pro Nacht mit Gesamtwert, dazu ein Diagramm |
| Import bestehender Listen | Später entscheiden |

## Architektur

Alles lebt in einem Google Sheet mit gebundenem Apps-Script-Projekt. Oberfläche, Preislauf und Ansichtsformeln arbeiten auf einem gemeinsamen Datenblatt, das nur das Skript beschreibt.

Diagramm (im Dokument): Sidebar (Desktop), Web-App (Handy) und Zeit-Trigger (Preislauf nachts) rufen dieselben Apps-Script-Funktionen auf. Nur das Skript ruft tcgdex ab und schreibt in die Blätter Daten, Sets, Übersetzung, Verlauf. Das Blatt Sammlung liest Daten per Formel.

| Blatt | Zweck | Sichtbar |
| --- | --- | --- |
| Sammlung | Ansicht mit Suchfeld, Set-Filter, Sortierung, Schaltern und Summen; nur Formeln | ja |
| Daten | Ein Eintrag pro Karte + Variante + Zustand | versteckt, geschützt |
| Sets | Zwischenspeicher der Setliste (de und en) mit Größe und Erscheinungsdatum | versteckt |
| Übersetzung | Namenspaare Deutsch nach Englisch plus eigene Einträge | versteckt |
| Verlauf | Eine Zeile pro Nacht mit Gesamtwert, dazu ein Liniendiagramm | ja |

Skriptdateien:

- `Menu.gs`: Menü Pokémon mit Karten erfassen, Preise jetzt aktualisieren, Übersetzung und Sets aktualisieren, Einrichtung (legt die Trigger an).
- `Api.gs`: tcgdex-Aufrufe für Suche, Karte und Sets, Normalisierung der Kartennummern, ein Wiederholversuch bei Fehlern.
- `Collection.gs`: Lesen und Schreiben im Datenblatt unter `LockService`, Hinzufügen, -1, +1, Rückgängig.
- `Prices.gs`: nächtlicher Preislauf in Paketen mit Fortsetzung, Verlaufszeile.
- `Translate.gs`: Aufbau von Übersetzungstabelle und Sets-Cache.
- `WebApp.gs`: `doGet` liefert dieselbe HTML-Oberfläche wie die Sidebar.
- `Ui.html`: Tabs Hinzufügen und Entfernen, responsiv mit großen Tippflächen fürs Handy.

Die Web-App wird mit „Ausführen als: ich" und „Zugriff: nur ich" bereitgestellt. Die Tabellen-ID steht in den Script Properties, damit die Web-App das Sheet per `openById` findet; die URL kommt als Lesezeichen auf den Handy-Homescreen.

## Datenmodell

Jede Zeile im Blatt Daten ist ein Eintrag aus Karte, Variante und Zustand, identifiziert über einen Schlüssel wie `swsh3-136|reverse|NM`. Gibt es den Schlüssel schon, erhöht das Hinzufügen nur die Anzahl.

| Spalte | Inhalt |
| --- | --- |
| Schlüssel | Karten-ID, Variante und Zustand, mit senkrechtem Strich verbunden |
| Karten-ID | tcgdex-ID, z. B. `swsh3-136` |
| Set-ID | z. B. `swsh3` |
| Setname | Deutscher Setname, beim englischen Ersatz der englische |
| Set-Erscheinungsdatum | Für die Sortierung nach Set |
| Nummer | `localId` wie von tcgdex geliefert |
| Nummer sortierbar | Zahlenteil der Nummer ohne führende Nullen, für Sortierung und Suche |
| Setgröße | `cardCount.official` des Sets |
| Name | Deutscher Kartenname; beim Ersatz der eingegebene deutsche Name |
| Name englisch | Nur beim Ersatz gefüllt |
| Quelle | `de` oder `en-Ersatz` |
| Variante | `normal`, `holo`, `reverse` oder `firstEdition` |
| Zustand | Leer (unbekannt) oder MT, NM, EX, GD, LP, PL, PO wie bei Cardmarket |
| Anzahl | Ganze Zahl ab 0 |
| Trendpreis (EUR) | Cardmarket Trend passend zur Variante |
| Preisstand | `pricing.cardmarket.updated` |
| Bild-URL | Basis aus `image`, Qualität und Endung hängt die Oberfläche an |
| Seltenheit | `rarity` |
| Kartentyp | `category`: Pokémon, Trainer, Energie |
| Illustrator | `illustrator` |
| Hinzugefügt am | Datum der ersten Erfassung |
| Zuletzt geändert | Datum der letzten Anzahländerung, für „zuletzt hinzugefügt" |

Regeln für die Variante:

- Basisvariante ist `holo`, wenn tcgdex `holo` aber kein `normal` meldet (Holo-Rare), sonst `normal`; hat eine Karte keins von beiden, die erste vorhandene.
- Die Checkbox Reverse Holo erscheint nur bei `variants.reverse`, die Checkbox 1. Edition nur bei `variants.firstEdition`. Beide schließen sich gegenseitig aus.
- Der Zustand beeinflusst den Preis nicht, weil tcgdex keinen Preis je Zustand liefert.

## Ablauf Hinzufügen

Die Suche läuft in bis zu drei Stufen: deutsch, englisch mit übersetztem Namen, zuletzt Set plus Nummer. Jede Stufe endet in derselben Bildauswahl und Bestätigung. Eine Stufe läuft nur, wenn die vorige nichts findet.

1. Eingabe: Name, Nummer und optional Set (Vorschlagsliste aus dem Sets-Cache). Nötig ist der Name oder Set plus Nummer.
2. Nummer zerlegen: `025/165` ergibt Nummer 25 und Setgröße 165. Führende Nullen fallen weg, Buchstabenpräfixe wie TG05 oder GG01 bleiben als Text erhalten.
3. Suche deutsch: `GET /v2/de/cards?name=<Name>&localId=<Nummer>`. Beide Filter sind dabei „enthält", also wird danach lokal exakt gefiltert: Nummer normalisiert gleich, Set über die Set-ID gegen den Sets-Cache (Name enthält Eingabe, Setgröße gleich `cardCount.official`). Ohne Namen direkt `GET /v2/de/sets/<setId>/<Nummer>`.
4. Treffer anzeigen: Details der Kandidaten parallel laden (`UrlFetchApp.fetchAll`, höchstens 24), Galerie mit `low.webp`, darunter Setname und Nummer. Bei mehr als 24 Treffern ein Hinweis, die Eingabe zu verfeinern. Bei genau einem Treffer direkt zur Bestätigung.
5. Kein deutscher Treffer: Name über das Blatt Übersetzung ins Englische (erst exakt, sonst Grundname plus Zusatz wie ex, V, VMAX, VSTAR, GX), dann dieselbe Suche gegen `/v2/en`.
6. Immer noch nichts: Set-Auswahl mit Logos (vorbelegt, falls ein Set eingegeben wurde), dann `GET /v2/en/sets/<setId>/<Nummer>`.
7. Bestätigung: großes Bild (`high.webp`), Name, Set, Nummer, Seltenheit, aktueller Trendpreis; Checkboxen Reverse Holo und 1. Edition (nur wenn vorhanden), Zustand-Dropdown (leer), Anzahl 1. Englische Ersatzdaten tragen einen sichtbaren Hinweis.
8. Speichern: unter Lock den Schlüssel suchen, Anzahl erhöhen oder neue Zeile mit allen Daten und Preis anlegen. Meldung wie „Glurak, Reverse Holo, NM hinzugefügt, jetzt 3 Stück" (der Knopf Nochmal +1 dazu ist seit 1.1.3 entfernt, #34). Danach wird das Formular geleert und der Cursor steht wieder im Namensfeld.

## Ablauf Entfernen

Der Tab Entfernen durchsucht nur das Datenblatt und ändert die Anzahl mit einem Klick, ohne Rückfrage und ohne API-Aufruf.

- Suche: ein Feld mit derselben Logik wie in der Sammlungsansicht (Text sucht im Namen, Zahlen oder 025/165 in der Nummer), dazu optional das Set.
- Treffer: kleines Bild, Name, Set, Nummer, Variante, Zustand und Anzahl. Einträge mit Anzahl 0 stehen ausgegraut ganz unten.
- Knöpfe -1 und +1 speichern sofort. -1 ist bei Anzahl 0 deaktiviert; der Eintrag bleibt bei 0 mit allen Daten erhalten.
- Nach jedem Klick zeigt die Zeile etwa 5 Sekunden lang Rückgängig, das die letzte Änderung zurücknimmt.
- +1 hier ist der schnelle Weg für Doppelte einer Karte, die schon in der Sammlung ist.

## Sammlungsansicht

Das Blatt Sammlung ist eine reine Formelansicht auf das Datenblatt: oben Steuerfelder und Summen, darunter eine einzige Formel, die filtert, sortiert und die Tabelle ausgibt. Sie läuft ohne Skript und damit auch in der Sheets-App am Handy.

- Kopfzeile: Gesamtwert (Summe Wert), Kartenanzahl (Summe Anzahl) und Zahl der Einträge, jeweils für die aktuelle Suche.
- Steuerzeile: Suchfeld, Set-Dropdown (Sets aus der eigenen Sammlung plus „Alle"), Sortier-Dropdown, Checkbox 0er zeigen, Checkbox Bilder zeigen.
- Suche: Der Text wird in Wörter zerlegt. Ein Wort mit Ziffern vergleicht die sortierbare Nummer (bei 025/165 zusätzlich die Setgröße), ein Wort ohne Ziffern sucht im Namen ohne Groß- und Kleinschreibung. Alle Wörter müssen passen. Die Formel rechnet nach Enter neu.
- Sortierung: zuerst Anzahl größer 0 vor 0, dann nach Wahl Set und Nummer (Sets nach Erscheinungsdatum), Name, Wert absteigend oder zuletzt geändert.
- 0er-Einträge: ausgeblendet, solange 0er zeigen aus ist; sonst per bedingter Formatierung grau und immer unten.
- Spalten: Bild, Name, Set, Nummer, Variante, Zustand, Anzahl, Trendpreis (EUR), Wert (EUR), Seltenheit, Kartentyp, Illustrator, Preisstand.
- Bilder: Die Bildspalte nutzt `IMAGE(<Basis>/low.png)` nur bei aktivem Schalter. PNG statt WebP, weil nicht gesichert ist, dass `IMAGE()` WebP anzeigt.
- Zeilenhöhe: Ein installierbarer onEdit-Trigger reagiert auf die Bild-Checkbox und setzt die Tabellenzeilen auf etwa 90 px oder zurück auf 21 px.
- Die Tabelle selbst ist nicht editierbar; Änderungen laufen nur über die Oberfläche.

## Preise und Wertverlauf

Der Preis ist der Cardmarket-Trend in Euro aus `pricing.cardmarket`, den tcgdex mit jeder Karte liefert und täglich aktualisiert (https://tcgdex.dev/markets-prices). Ein nächtlicher Lauf aktualisiert alle Einträge und schreibt eine Verlaufszeile.

| Variante | Preisfeld |
| --- | --- |
| normal | `trend` |
| holo (Holo-Rare) | `trend` |
| reverse | `trend-holo` |
| firstEdition | `trend`, mit Hinweis, dass es kein eigener 1.-Edition-Preis ist |

- Fehlt `pricing` oder das Feld, bleibt der Preis leer, der Wert zählt als 0 und die Ansicht zeigt „kein Preis".
- Zeitplan: Zeit-Trigger täglich zwischen 3 und 4 Uhr, dazu der Menüpunkt Preise jetzt aktualisieren.
- Abrufe: ein Abruf pro eindeutiger Karten-ID über alle Einträge, 0er eingeschlossen, gegen `/v2/de` oder `/v2/en` je nach Quelle. Pakete zu 20 per `fetchAll`, 1 Sekunde Pause dazwischen, Ergebnisse gebündelt per `setValues` zurückschreiben.
- Laufzeit: Nach etwa 5 Minuten speichert der Lauf seine Position in den Script Properties und legt einen einmaligen Trigger an, der eine Minute später weitermacht.
- Fehlgeschlagene Abrufe behalten den alten Preis und Preisstand und werden im Verlauf gezählt.
- Verlauf: nach Abschluss eine Zeile mit Datum, Gesamtwert, Kartenanzahl und Einträgen ohne Preis; ein zweiter Lauf am selben Tag überschreibt die Tageszeile. Das Blatt Verlauf zeigt den Gesamtwert als Liniendiagramm.
- Menge: Bei 1.000 verschiedenen Karten sind das 1.000 Abrufe pro Nacht, deutlich unter dem Tageskontingent von Apps Script für private Konten (etwa 20.000, aus Wissen, beim Bau prüfen).

## Übersetzungstabelle und Set-Cache

Ein Menüpunkt Übersetzung und Sets aktualisieren baut beide versteckten Blätter aus tcgdex neu auf; er läuft einmal bei der Einrichtung und wieder, wenn neue Sets erscheinen.

Übersetzung:

- Lädt `GET /v2/de/cards` und `GET /v2/en/cards` (Kartenlisten mit `id` und `name`, bei Bedarf seitenweise über `pagination:page`).
- Paart deutsche und englische Namen über die gleiche Karten-ID; bei mehreren englischen Varianten gewinnt die häufigste.
- Leitet zusätzlich Grundnamen ab, indem Zusätze wie ex, EX, GX, V, VMAX und VSTAR abgeschnitten werden. So lässt sich auch eine unbekannte Karte wie „Glurak-ex" über „Glurak" und den Zusatz übersetzen.
- Spalten: Deutsch, Englisch, Zahl der Belege, Eigene Übersetzung. Ein Eintrag in Eigene Übersetzung überschreibt den erzeugten Wert und überlebt jede Neuberechnung.

Set-Cache:

- Lädt `GET /v2/de/sets` und `GET /v2/en/sets` mit Set-ID, Name, Logo, Symbol und `cardCount`.
- Das Erscheinungsdatum steht nur im vollen Set-Objekt. Es wird beim ersten Auftauchen eines Sets in der Sammlung einmal über `GET /v2/<Sprache>/sets/<setId>` geholt und gespeichert.
- Liefert die Vorschlagsliste im Setfeld, den Abgleich der Setgröße bei 025/165 und die Logos für die Set-Auswahl der letzten Suchstufe.

## Fehlerfälle und Grenzen

Im Zweifel speichert das Tool nichts und sagt, warum; ein halber Eintrag entsteht nie.

| Fall | Verhalten |
| --- | --- |
| tcgdex nicht erreichbar | Meldung in der Oberfläche, nichts gespeichert; im Preislauf bleibt der alte Preis |
| Karte ohne Bild | Platzhalterbild in Galerie und Ansicht |
| Karte ohne Cardmarket-Preis | Preis leer, Wert 0, Hinweis „kein Preis" |
| Mehr als 24 Treffer | Hinweis, Nummer oder Set zu ergänzen |
| Sidebar und Handy gleichzeitig | `LockService` serialisiert alle Schreibzugriffe |
| Neues Set noch nicht im Cache | Setfilter greift nicht, Suche funktioniert trotzdem über Name und Nummer; Hinweis, die Sets zu aktualisieren |
| Handy-App | Ansicht, Suche und Schalter funktionieren; Erfassen und Entfernen nur über die Web-App, weil die Sheets-App keine Sidebars kennt |

## Beim Bau zu prüfen

Die tcgdex-API war aus der Planungsumgebung nicht live abfragbar. Diese Annahmen stammen aus der tcgdex-Doku (https://tcgdex.dev/reference/card) oder aus Wissen und werden mit dem ersten Prototyp geprüft.

- [ ] Liefert `/v2/de/cards/<id>` ebenfalls `pricing`? Die Doku zeigt nur `en`.
- [ ] Entspricht `trend-holo` bei normalen Karten dem Reverse-Holo-Preis?
- [ ] Wie vollständig sind deutsche Daten und Bilder bei alten Sets?
- [ ] Welche Formate hat `localId` je Ära (4, 136, 025, TG05), und wie verhält sich der `localId`-Filter?
- [ ] Sind Set- und Karten-IDs in `de` und `en` identisch?
- [ ] Wie groß sind die vollständigen Kartenlisten, und braucht der Übersetzungsaufbau Pagination?
- [ ] Zeigt `IMAGE()` WebP an? Sonst bleibt es bei PNG.
- [ ] Wie hoch ist das UrlFetch-Tageskontingent des Kontos?
- [ ] Feuert der installierbare onEdit-Trigger auch bei Änderungen aus der Sheets-App?

## Umsetzungsschritte

Gebaut wird von innen nach außen: erst die API-Annahmen prüfen, dann Datenbasis, dann Oberfläche, zuletzt Automatik und Handy.

1. API-Prototyp: Testfunktionen im Skript, die die Punkte aus „Beim Bau zu prüfen" mit echten Karten beantworten.
2. Grundgerüst: Blätter, Menü, Script Properties; der Menüpunkt Einrichtung legt alle Trigger an.
3. Sets-Cache und Übersetzungstabelle.
4. Tab Hinzufügen in der Sidebar, erst die deutsche Suche, dann die beiden Ersatzstufen.
5. Tab Entfernen mit -1, +1 und Rückgängig.
6. Sammlungsansicht: Formel, Steuerfelder, Summen, bedingte Formatierung, Zeilenhöhen-Trigger.
7. Preislauf mit Fortsetzung, Zeit-Trigger und Verlauf mit Diagramm.
8. Web-App bereitstellen und Layout am Handy prüfen.
9. Abnahme mit echten Karten: neue deutsche Karte, Holo-Rare, Reverse Holo, alte Karte über den englischen Ersatz, Karte ohne Preis, Mehrfaches Hinzufügen und Entfernen bis 0.

## Bekannte Probleme

Ein Cardmarket-Trend von tcgdex kann unplausibel sein; das Tool übernimmt ihn bisher ungeprüft.

- Despotar, Expedition 66 (normal), gemeldet am 16.10.2026: tcgdex liefert 527,37 € als Trend. Die Karte ist richtig erkannt (Ordner Zeile 12, Link „Tyranitar-V2-EX66“), im Ordner stehen 12,03 € als 30-Tage-Trend (Stand 04.10.).
- Ursache: kein Rechenfehler im Tool. Vermutlich zeigt tcgdex auf die andere Cardmarket-Version (V1 statt V2), oder der Trend ist durch wenige Verkäufe verzerrt. Aus der Cloud-Umgebung nicht prüfbar, weil tcgdex dort nicht erreichbar ist.
- Der Ordner-Preis wurde nicht übernommen, weil der Import den Preis aus der Quelle nur nutzt, wenn tcgdex keinen Preis hat.
- Umgehung: In der Sammlung beim Eintrag „Eigener Preis in EUR“ eintragen und speichern. Der nächtliche Preislauf überschreibt diesen Preis nicht.

## Release und Updates

Festgelegt am 21.10.2026: Das Tool wird öffentlich geteilt. Zuerst kopieren Nutzer eine Vorlage, später kommt ein Add-on im Google Workspace Marketplace. Ein Update-Knopf, der den Code in der Tabelle selbst ersetzt, geht nicht: Google sperrt dafür die Apps-Script-API in jedem Skript (Test am 21.10.2026). Deshalb kommt eine neue Version als neue Tabelle (Entscheidung von Eric am 21.10.2026).

| Thema | Entscheidung |
| --- | --- |
| Zielgruppe | Öffentlich, beliebig viele Nutzer, auch ohne Apps-Script-Kenntnisse. |
| Phase 1: Kopie | Nutzer kopieren die Vorlage-Tabelle per Link. Jede Kopie hat ihr eigenes Skript. |
| Phase 2: Add-on | Kommt, sobald viele das Tool nutzen. Updates landen dort bei allen automatisch. Der Code ist von Anfang an darauf ausgelegt. |
| Ablage | Öffentliches GitHub-Repo. Jede Version ist ein Release mit Nummer und Änderungsliste. Alte Releases bleiben liegen. |
| Lizenz | Nicht-kommerziell, zum Beispiel PolyForm Noncommercial 1.0.0: privat nutzen und ändern ja, verkaufen oder geschäftlich nutzen nein. |
| Hinweis | Seitenleiste und Web-App zeigen „Version x ist da“ mit Änderungsliste. Bis der Nutzer wechselt, läuft die alte Version weiter. |
| Neue Version holen | Ein Klick in der Seitenleiste am Rechner legt eine Kopie der Vorlage mit der neuen Version im selben Ordner an. Die neue Tabelle bietet beim ersten Öffnen sofort die Übernahme an. |
| Übernahme | Alles 1:1 ohne Erkennung und Prüfliste: Karten, eigene Preise, Verlauf, Importe samt Rücknahme, Begriffe, Vorlagen, Set-Zuordnungen, Seltenheiten, Zusatzspalten, Einstellungen, eigene Blätter. Die neue Tabelle bekommt den Namen der alten, die alte heißt danach „… (alt)“. Tabelle und Handy-Link ändern sich, die Web-App wird in der neuen Tabelle einmal bereitgestellt. |
| Alte Tabelle | Nach der Übernahme stillgelegt: vorne ein Hinweis mit Link zur neuen Tabelle, Menü und Preislauf stoppen, die Daten bleiben lesbar. Ihre Handy-Seite verweist auf die neue. |
| Zurück | „Diese Tabelle wieder benutzen“ im Menü der alten Tabelle holt Menü und Preislauf zurück. Was inzwischen in der neuen Tabelle geändert wurde, fehlt dort. Eine eigene Sicherungskopie braucht es nicht, die alte Tabelle ist der Stand davor. |
| Vorabversionen | GitHub-Vorabversionen sehen nur Tabellen mit eingeschaltetem „Vorabversionen bekommen“. Jeder Nutzer kann das einschalten. Vorabversionen haben eine eigene Vorlage. Nach ein paar Tagen ohne Probleme gibt Eric die Version für alle frei. |
| Ersatzweg: von Hand | Anleitung im Repo zum Einfügen des Codes für Erfahrene. Tabelle und Handy-Link bleiben. |
| Wechsel zum Add-on | Der Menüpunkt „Zum Add-on wechseln“ in der Kopie löscht deren Auslöser und legt ihr Menü still. Die Tabelle bleibt dieselbe, am Handy gilt dann der gemeinsame Link des Add-ons. |
| Erics Tabelle | Bekommt Version 1.0.0 einmal durch Einfügen von Hand, danach denselben Weg wie alle. |

### So läuft ein Update

1. Das Tool sieht einmal am Tag (beim Preislauf) und beim Öffnen der Seitenleiste auf GitHub nach der neuesten Version.
2. Der Hinweis zeigt Versionsnummer und Änderungen.
3. „Neue Version holen“ kopiert die Vorlage dieser Version in den Ordner der Tabelle. An der alten Tabelle ändert sich dabei nichts.
4. In der neuen Tabelle: Pokémon > Karten erfassen. Google fragt einmal nach den Berechtigungen, dann richtet sich die Tabelle ein und zeigt die Übernahme mit Vorschau.
5. „Jetzt übernehmen“ holt alle Daten, stellt sie auf den neuen Aufbau um, auch über mehrere Versionen hinweg, und legt die alte Tabelle still.
6. Wer die Handy-Seite nutzt, stellt sie in der neuen Tabelle einmal bereit.

### Regeln für den Bau

- Dauerhafte Einstellungen, die früher in Skript-Eigenschaften lagen (Schema-Version, Web-App-Link, Zusatzspalten der Ansicht), stehen im versteckten Blatt „Tool-Einstellungen“. Ein Add-on kann die Eigenschaften der Kopie nicht lesen.
- Die Namen der Funktionen, die Auslöser aufrufen, bleiben über alle Versionen gleich.
- Versionsnummer und Änderungsliste kommen als Datei von raw.githubusercontent.com, nicht über die GitHub-API. Die erlaubt ohne Anmeldung nur 60 Abrufe pro Stunde, und Apps Script teilt sich die Adressen.
- Vor jedem Release kommt die Vorlage auf die neue Version. Erst dann wird die Versionsliste auf GitHub veröffentlicht.
- Ab dem ersten öffentlichen Release prüft jede Version, ob ihre Tabelle als „übernommen“ markiert ist, und stoppt dann Menü und Preislauf. Ältere Tabellen bekommen eine Anleitung, den Auslöser von Hand zu löschen.
- Fürs Add-on liest der Import .xlsx-Dateien über eine Dateiauswahl statt mit vollem Drive-Zugriff. Sonst verlangt Google eine teure jährliche Sicherheitsprüfung.
- Der Code protokolliert keine Kartendaten, weil Protokolle eines Add-ons in Erics Google-Cloud-Projekt landen.

### Offen

- [x] Test: Klappt die Apps-Script-API aus einem an die Tabelle gebundenen Skript? Nein (21.10.2026, Fehler 403: im Standard-Projekt gesperrt). Kopie und Übernahme sind der Hauptweg bis zum Add-on.
- [ ] Vorlage-Tabelle anlegen, ihren Link in die Versionsliste eintragen und das Repo öffentlich machen.
- [ ] Bleibt der Kopie-Weg nach dem Start des Add-ons unterstützt?
- [ ] Name des Tools: „Pokémon“ ist eine Marke. Geplant ist ein eigener Name, die Beschreibung „für Pokémon-Karten“ und der Satz „nicht verbunden mit Nintendo oder The Pokémon Company“. Kartenbilder kommen nur von tcgdex und stecken nie in der geteilten Vorlage.
- [ ] Nutzungsbedingungen von tcgdex (Karten, Cardmarket-Preise) und PokeAPI (deutsche Namen) für eine öffentliche Weitergabe prüfen.
- [ ] Sprache der Oberfläche für ein öffentliches Publikum.

## Spätere Erweiterungen

Das Datenmodell lässt diese Punkte zu, ohne bestehende Daten umzubauen; gebaut werden sie erst bei Bedarf.

- Import bestehender Listen: Name, Nummer und optional Set in ein Importblatt einfügen; eindeutige Treffer werden übernommen, unklare landen in einer Prüfliste mit Bildauswahl. Entscheidung offen.
- Sprache pro Eintrag, falls doch englische oder japanische Karten dazukommen (neue Spalte im Schlüssel).
- Pokédex-Tab: Ein eigenes Blatt Pokédex kommt irgendwann dazu. Noch nicht geplant; was es zeigt, ist offen.
- Sortierung nach Pokédex-Nummer: steht auf dem Plan, Details noch offen, auch wo sie angeboten wird. tcgdex liefert die Nummer als `dexId` bei Pokémon-Karten; Trainer- und Energiekarten haben keine.
- Sortierung im Tab Sammlung von Web-App und Seitenleiste: steht auf dem Plan, welche Sortierungen es gibt, ist noch offen.
- Sortierung nach Seltenheit: steht auf dem Plan, Details noch offen. tcgdex liefert die Seltenheit als Text (`rarity`), die Reihenfolge der Stufen muss also noch festgelegt werden.
- Suche nach Künstler (Illustrator): steht auf dem Plan, Details noch offen, auch wo gesucht wird. Das Datenblatt speichert den Illustrator schon je Karte (Spalte Illustrator, aus tcgdex `illustrator`).
- Karte bearbeiten direkt im Sammlungs-Tab: steht auf dem Plan. Offen ist, wo genau: Der Tab Sammlung in Seitenleiste und Web-App hat schon einen Knopf Bearbeiten je Exemplar (laut `Ui.html`), gemeint ist also vermutlich das Blatt Sammlung im Sheet. Wie die Aktion dort funktioniert, ist noch offen.
- Import-Tab in der Web-App: Heute gibt es den Import-Tab nur in der Seitenleiste; er soll auch in die Web-App kommen. Details noch offen.
- Optimierungen und Geschwindigkeit beim Suchen und Hinzufügen: steht auf dem Plan, welche Maßnahmen, ist noch offen.
- Release: Der Update-Weg ist am 21.10.2026 entschieden, siehe Abschnitt Release und Updates. Offen sind dort noch Name, Nutzungsbedingungen der Datenquellen und Sprache der Oberfläche.
- Import aus einer früheren Version: Das Import-Tool muss die Daten aus dem Sheet einer früheren Version dieses Tools übernehmen können. Das ist wichtig, damit Nutzer ohne Apps-Script-Kenntnisse ihre Sammlung auf eine neue Version bringen können; gehört zum Release. Entschieden am 21.10.2026: 1:1-Übernahme in eine neue Tabelle, das ist jetzt der Hauptweg für Updates (Einzelheiten unter Release und Updates).
- Umgang mit unplausiblen tcgdex-Preisen: Wie das Tool solche Preise erkennen und behandeln soll, ist noch zu entscheiden (Anlass: Despotar unter Bekannte Probleme).
- Bilderkennungs-Tool für Pokémon-Karten: steht auf der Liste. Wie es funktioniert und wo es eingebunden wird, ist noch offen.
