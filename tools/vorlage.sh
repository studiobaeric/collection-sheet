#!/bin/sh
# Pokémon-Sammlung: den Code aus src/ mit clasp in die Vorlage schreiben (#67, docs/RELEASE.md).
#   sh tools/vorlage.sh pruefen      nur nachsehen, welche Version die Vorlage hat
#   sh tools/vorlage.sh einspielen   alle Dateien der Vorlage durch src/ ersetzen, danach nachsehen
# Braucht die Script-ID der Vorlage in .clasp.json und eine clasp-Anmeldung in ~/.clasprc.json (auf GitHub aus dem
# Secret CLASPRC_JSON). Fehlt eins davon oder ist die Version eine Vorabversion, bleibt die Vorlage, wie sie ist (Exit 0).
set -eu
cd "$(dirname "$0")/.."
CLASP="npx --yes @google/clasp@3.4.1"
mode=${1:-}
case "$mode" in pruefen|einspielen) ;; *) echo "Aufruf: sh tools/vorlage.sh pruefen|einspielen" >&2; exit 2 ;; esac
say() { echo "::$1 title=Vorlage::$2"; }

version=$(sed -n "s/^const TOOL_VERSION = '\([^']*\)';.*/\1/p" src/Code.gs)
id=$(sed -n 's/.*"scriptId": *"\([^"]*\)".*/\1/p' .clasp.json 2>/dev/null || true)
if [ -n "${CLASPRC_JSON:-}" ]; then (umask 077 && printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"); fi
case "$version" in *-*) say notice "Vorabversion $version: Die Hauptvorlage bekommt nur fertige Versionen."; exit 0 ;; esac
[ -n "$id" ] || { say notice "Script-ID der Vorlage fehlt in .clasp.json, die Vorlage bleibt, wie sie ist (#67)."; exit 0; }
[ -s "$HOME/.clasprc.json" ] || { say notice "Keine clasp-Anmeldung (Secret CLASPRC_JSON), die Vorlage bleibt, wie sie ist (#67)."; exit 0; }

[ "$mode" = pruefen ] || $CLASP push --force

# Nachsehen, was in der Vorlage steht: in einen leeren Ordner holen, src/ bleibt unberührt
tmp=$(mktemp -d)
printf '{"scriptId":"%s"}\n' "$id" > "$tmp/.clasp.json"
if ! (cd "$tmp" && $CLASP pull > /dev/null); then
  rm -rf "$tmp"
  [ "$mode" = pruefen ] || exit 1
  say warning "clasp kann die Vorlage nicht lesen: Anmeldung abgelaufen, Schalter „Google Apps Script API“ aus oder keine Rechte? (#67)"
  exit 0
fi
have=$(head -n 5 "$tmp"/Code.* 2>/dev/null | sed -n 's/.* Version \([0-9][0-9A-Za-z.-]*\).*/\1/p' | head -n 1)
rm -rf "$tmp"
if [ "$have" = "$version" ]; then echo "Vorlage hat Version $have."; exit 0; fi
if [ "$mode" = einspielen ]; then say error "Nach dem Einspielen hat die Vorlage Version ${have:-?} statt $version."; exit 1; fi
if [ "${GITHUB_REF:-}" = refs/heads/main ]; then
  say warning "Vorlage hat Version ${have:-?}, main hat $version: Vorlage einspielen (Run workflow mit Haken) und dort Karten erfassen öffnen."
else
  say notice "Vorlage hat Version ${have:-?}, src/ hat $version. Vor dem Einspielen ist das normal."
fi
