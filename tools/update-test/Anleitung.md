# Update-Test ausführen (Stand 21.10.2026)

Der Test prüft, ob der geplante Update-Knopf ohne eigenes Google-Cloud-Projekt funktioniert. Er läuft in einer leeren Wegwerf-Tabelle. Deine Sammlung wird nicht angefasst. Dauer etwa 5 Minuten.

## 1. Schalter einschalten

1. Öffne https://script.google.com/home/usersettings mit dem Konto, dem die Sammlung gehört (wie immer im Inkognito-Fenster, nur dieses Konto angemeldet).
2. Stelle **Google Apps Script API** auf **An**. Diesen Schritt müssten später auch alle Nutzer einmal machen.

## 2. Wegwerf-Tabelle anlegen

1. Öffne https://sheets.new und nenne die Tabelle „Update-Test“.
2. Klicke auf **Erweiterungen > Apps Script**.
3. Klicke links auf das Zahnrad (**Projekteinstellungen**) und setze den Haken bei **„Manifestdatei appsscript.json im Editor anzeigen“**.
4. Klicke links auf **Editor** (das Symbol `< >`). Ersetze den Inhalt von `Code.gs` durch `Test.gs`.
5. Ersetze den Inhalt von `appsscript.json` durch die mitgelieferte `appsscript.json`.
6. Speichere mit dem Disketten-Symbol.

## 3. Test starten

1. Wähle oben neben „Ausführen“ die Funktion **updateTestStarten** und klicke auf **Ausführen**.
2. Google fragt nach Berechtigungen. Klicke auf **Erweitert > Weiter zu Update-Test (unsicher)** und erlaube alles. Die Warnung kommt, weil Google selbst geschriebene Skripte nicht prüft.
3. Warte, bis unten im Ausführungsprotokoll „Ausführung abgeschlossen“ steht.
4. Im Editor taucht kurz eine Datei „UpdateTestMarker“ auf und verschwindet wieder. Das ist der Test. Lade den Editor danach einmal neu, bevor du etwas speicherst.

## 4. Ergebnis

1. In der Tabelle gibt es jetzt das Blatt **Ergebnis**. Sag mir Bescheid, dann lese ich es über Drive.
2. Schritt 8 legt eine Sicherungskopie „Update-Test – Sicherung …“ in deinem Drive an. Öffne sie und sieh unter **Erweiterungen > Apps Script** nach, ob dort derselbe Test-Code steht. Sag mir, was du siehst.
3. Danach kannst du beide Test-Tabellen löschen.
