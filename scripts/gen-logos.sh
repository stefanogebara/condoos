#!/usr/bin/env bash
# Generate CondoOS logo prototypes via Gemini 3.1 flash-image.
# Usage: GEMINI_API_KEY=... bash scripts/gen-logos.sh
set -euo pipefail

KEY="${GEMINI_API_KEY:-}"
if [ -z "$KEY" ]; then echo "GEMINI_API_KEY required" >&2; exit 1; fi

OUT="docs/logos"
mkdir -p "$OUT"

BASE_STYLE="Claymorphism + glassmorphism aesthetic, muted sage green and warm cream palette, soft rim lighting, tactile 3D clay surface. Inspired by Claude.ai and Google Material 3. Centered on a warm cream gradient background (#FAF6EF to #E5EADF). Square composition. Clean, editorial, calm, confident. No lorem text, no extra elements."

gen() {
  local name="$1"; local prompt="$2"; local target="$OUT/$name"
  if [ -f "$target" ]; then echo "[skip] $name"; return 0; fi
  echo "[gen] $name"
  local body
  body=$(python -c "import json,sys; print(json.dumps({'contents':[{'parts':[{'text':sys.argv[1]}]}],'generationConfig':{'responseModalities':['IMAGE','TEXT']}}))" "$prompt")
  curl -sS -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=$KEY" \
    -H "Content-Type: application/json" -d "$body" -o "./_logo_tmp.json"
  python -c "
import json, base64, sys
with open('./_logo_tmp.json') as f: data = json.load(f)
if 'error' in data:
    print('  ERROR:', data['error'].get('message','?')[:150]); sys.exit(0)
for p in data.get('candidates',[{}])[0].get('content',{}).get('parts',[]):
    if 'inlineData' in p:
        with open('$target','wb') as f: f.write(base64.b64decode(p['inlineData']['data']))
        print('  saved'); break
"
  rm -f ./_logo_tmp.json
}

echo "Generating CondoOS logo prototypes..."
echo ""

gen "01-wordmark-clean.png" "A minimalist wordmark logo for 'CondoOS' — lowercase 'condoos' in modern Inter Tight typography, tight letter-spacing (-0.04em), weight 600, dusk-ink color #4A3A36. Clean, sophisticated, no ornaments. ${BASE_STYLE}"

gen "02-mark-clay-building.png" "A logo combining a small 3D claymorphism sage-green condominium building icon (3 stories, rounded, warm glowing windows) next to the lowercase wordmark 'condoos' in Inter Tight 600 dusk-ink. Horizontal layout. Balanced composition. ${BASE_STYLE}"

gen "03-monogram-c.png" "A single-letter monogram logo: lowercase 'c' formed from soft sage-green 3D clay with warm cream inner highlight. Rounded, confident, tactile. Centered on cream. ${BASE_STYLE}"

gen "04-badge-circular.png" "A circular badge logo. Outer ring in warm cream clay. Inner: a small stylized sage clay building silhouette with warm glowing window dots. Tiny uppercase 'CONDOOS' label arched at the bottom edge of the circle in Inter 500 letter-spacing 0.2em. Very restrained, editorial. ${BASE_STYLE}"

gen "05-abstract-stack.png" "An abstract logo mark: three stacked soft clay blocks in sage, peach, and cream, each slightly offset horizontally, suggesting floors of a building. Rounded corners 8px. No text. Centered. ${BASE_STYLE}"

gen "06-glass-sphere.png" "A glassmorphism mark: a translucent frosted glass sphere with a subtle inner reflection, revealing behind it a tiny sage clay building silhouette. Next to it, the wordmark 'condoos' in Inter Tight 600. ${BASE_STYLE}"

gen "07-architectural.png" "An architectural-style logo: a precise line-drawing of a small condominium building in dusk-ink (1.5px strokes), with tiny warm-peach glowing windows as the only color. Minimalist, Swiss-design precision meets warm palette. Wordmark 'condoos' below in Inter Tight 600. ${BASE_STYLE}"

gen "08-door-key-abstract.png" "An abstract logo formed from a stylized sage-green clay door with a tiny warm-cream key emerging from its keyhole, suggesting 'access' and 'home'. No text, purely iconic. Centered on a warm cream gradient. ${BASE_STYLE}"

echo ""
echo "Done. Check $OUT/"
