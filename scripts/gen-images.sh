#!/usr/bin/env bash
# CondoOS — generate claymorphism + glassmorphism imagery via Gemini.
# Requires GEMINI_API_KEY env var.
# Usage: scripts/gen-images.sh
set -euo pipefail

KEY="${GEMINI_API_KEY:-}"
if [ -z "$KEY" ]; then echo "GEMINI_API_KEY not set" >&2; exit 1; fi

OUT="client-app/public/images"
mkdir -p "$OUT"

gen() {
  local name="$1"; local prompt="$2"; local target="$OUT/$name"
  if [ -f "$target" ]; then echo "[skip] $name"; return 0; fi
  echo "[gen] $name ..."
  local tmp="./_gemini_tmp.json"
  local body
  body=$(python -c "import json,sys; print(json.dumps({'contents':[{'parts':[{'text':sys.argv[1]}]}],'generationConfig':{'responseModalities':['IMAGE','TEXT']}}))" "$prompt")
  curl -sS -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=$KEY" \
    -H "Content-Type: application/json" -d "$body" -o "$tmp"
  python -c "
import json, base64, sys
with open('$tmp') as f: data = json.load(f)
if 'error' in data:
    print('ERROR:', data['error'].get('message','?')[:200]); sys.exit(1)
parts = data.get('candidates',[{}])[0].get('content',{}).get('parts',[])
for p in parts:
    if 'inlineData' in p:
        with open('$target','wb') as f: f.write(base64.b64decode(p['inlineData']['data']))
        print('saved', '$target')
        break
else:
    sys.exit('no image in response')
"
  rm -f "$tmp"
}

gen "bg-dusk.jpg" "A soft serene dusk landscape background. Rolling sand dunes and distant smooth mountains in muted peach, dusty rose, and soft lavender. Gradient sky transitioning from warm peach near horizon to dusty mauve and gentle teal above. Minimal, no people, no text. Cinematic soft-focus, pastel, slightly desaturated. Portrait 3:4 orientation. Suitable as full-bleed background behind floating glass UI cards."

gen "bg-sage.jpg" "A soft sage-green studio backdrop with subtle warm cream gradient at the bottom, gentle soft shadow, minimalist, Pinterest claymorphism product photography. No objects, just the pastel sage-to-cream gradient surface with soft ambient light. Wide 16:9."

gen "bg-dunes.jpg" "Warm beige and peach sand dunes at golden hour, distant soft hills, calm water reflecting the sky, tall wispy grasses in foreground slightly blurred. Minimal, no people, no text. Muted pastel palette, dusty rose and cream. Pinterest glassmorphism hero background. 3:4 portrait orientation."

gen "clay-mail.png" "A single 3D claymorphism icon of a stylized mailbox with a small package sticking out of the top. Soft matte clay texture. Warm beige and sage green. Isolated on pure white background. Studio product photography. Rounded, friendly, tactile. No text. Square composition, transparent-looking background clean edges."

gen "clay-key.png" "A single 3D claymorphism icon of a stylized door key. Soft matte clay. Warm peach and sage accents. Isolated on pure white background. Studio product photography. Square."

gen "clay-megaphone.png" "A single 3D claymorphism icon of a friendly stylized megaphone. Soft matte clay texture. Cream and dusty coral. Isolated on pure white background. Studio product photography. Square."

gen "clay-vote.png" "A single 3D claymorphism icon of a ballot box with a folded paper being dropped in. Soft matte clay. Sage green and cream. Isolated on pure white background. Studio product photography. Square."

gen "clay-pool.png" "A single 3D claymorphism icon of a tiny stylized swimming pool with a floating ring. Soft matte clay texture. Dusty teal water, cream surround. Isolated on pure white background. Studio product photography. Square."

gen "clay-building.png" "A standalone 3D claymorphism icon: small 3-story condominium building, soft sage-green matte clay, rounded edges, tiny warm windows, isolated on pure white background. Square composition, studio product photography."

echo "Done."
