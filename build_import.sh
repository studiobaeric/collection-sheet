#!/bin/sh
# Baut src/Import.gs aus den Teilen (Quelle der Wahrheit: parts/*.gs) und prüft es.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/src/Import.gs"
cat "$DIR/parts/00_shared.gs" "$DIR/parts/10_quelle.gs" "$DIR/parts/20_erkennung.gs" "$DIR/parts/30_protokoll.gs" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
cp "$OUT" "$DIR/.import_check.js" && node --check "$DIR/.import_check.js" && rm -f "$DIR/.import_check.js"
node "$DIR/test/check_import.js"
echo "Import.gs gebaut: $(wc -l < "$OUT") Zeilen"
