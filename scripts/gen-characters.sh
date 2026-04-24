#!/usr/bin/env bash
# CondoOS — generate claymorphism CHARACTER imagery via Gemini.
# Produces diverse Brazilian residents performing CondoOS tasks + holding phones
# showing the app. Designed to replace the abstract hero on Landing.tsx.
#
# Requires GEMINI_API_KEY env var. Set OVERWRITE=1 to regenerate.
# Usage: scripts/gen-characters.sh
set -euo pipefail

KEY="${GEMINI_API_KEY:-}"
if [ -z "$KEY" ]; then echo "GEMINI_API_KEY not set" >&2; exit 1; fi

OUT="client-app/public/images/characters"
mkdir -p "$OUT"

# Shared style prefix — enforces brand consistency across all characters.
STYLE="Claymorphism 3D character art. Soft matte clay texture, rounded tactile forms, warm cinematic lighting. Palette: cream (#FAF6EF), dusty peach (#E8B9A0), soft sage green (#B5C9B0), muted mauve (#D9BEBC), warm terra-cotta accents, muted dusk (#6B5B56). Pinterest product-photography aesthetic. Pure clean background, no hard shadows, subtle ambient glow. Friendly expressions. Diverse Brazilian cast (mixed ethnicities: Afro-Brazilian, white, East Asian, indigenous, Middle Eastern). Professional but warm tone. No text, no logos, no UI icons. Magazine cover composition quality."

gen() {
  local name="$1"; local prompt="$2"; local target="$OUT/$name"
  if [ -f "$target" ] && [ "${OVERWRITE:-0}" != "1" ]; then echo "[skip] $name"; return 0; fi
  echo "[gen] $name ..."
  local full_prompt="${STYLE}

${prompt}"
  local tmp="./_gemini_tmp.json"
  local body
  body=$(python -c "import json,sys; print(json.dumps({'contents':[{'parts':[{'text':sys.argv[1]}]}],'generationConfig':{'responseModalities':['IMAGE','TEXT']}}))" "$full_prompt")
  curl -sS -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=$KEY" \
    -H "Content-Type: application/json" -d "$body" -o "$tmp"
  python -c "
import json, base64, sys
with open('$tmp') as f: data = json.load(f)
if 'error' in data:
    print('ERROR:', data['error'].get('message','?')[:250]); sys.exit(1)
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

# ─────────────────────────────────────────────────────────────────────────────
# HERO — three variants to pick from
# ─────────────────────────────────────────────────────────────────────────────

gen "hero-community-01.jpg" "Five diverse Brazilian condo residents gathered informally in a warm lobby — two women of mixed ethnicity chatting, one young Afro-Brazilian man holding a phone and smiling at it as if just received good news, an older East Asian woman with a shopping bag, a teenage white boy with a skateboard. They're in a softly-lit apartment building lobby with plants and rounded modernist furniture. Composition: horizontal 16:9, characters slightly off-center-right, ample negative space on the left for text overlay. Shallow depth of field, background slightly blurred. Warm golden-hour ambient light coming from a tall window."

gen "hero-community-02.jpg" "A warm overhead-angle scene of four Brazilian condo residents interacting in a courtyard garden — a young mixed-race couple sitting on a bench, a middle-aged Afro-Brazilian woman walking a small dog, a lanky white teenager on a bike. Soft golden light. Terracotta pots, green foliage, cream paving. Horizontal 16:9. Left third empty for headline text overlay. Pastel claymorphism rendering."

gen "hero-phone-focus-01.jpg" "Close-up portrait of a 30-something Afro-Brazilian woman in a cream sweater holding up her smartphone, looking at the screen with a gentle smile. The screen shows a soft pastel app interface (generic — no real UI, just blurred cards). Soft window light from the left. Behind her, out of focus: the interior of a Brazilian apartment with bookshelves and a plant. Horizontal 16:9. Her hands and phone are center-frame; face takes the right half."

# ─────────────────────────────────────────────────────────────────────────────
# FEATURE / SECTION IMAGES — one per major flow
# ─────────────────────────────────────────────────────────────────────────────

gen "char-voting-phone.jpg" "A young mixed-race Brazilian man sitting on his sofa with feet up, thumb-tapping on his smartphone. He's smiling slightly, focused. The phone tilts toward camera just enough to suggest a pastel voting interface on the screen (but not detailed — soft abstract UI). Apartment living room in the background, warm evening light, a potted monstera plant. Square composition 1:1, intimate framing."

gen "char-ago-assembly.jpg" "A Brazilian condominium Annual General Assembly (AGO) in progress — 8 to 10 diverse residents seated in folding chairs around a modest meeting table in an apartment building common room, in conversation. One woman at the head of the table stands and speaks. A wall-mounted flat-screen shows a soft pastel agenda graphic (blurred, no real text). Warm late-afternoon light through windows. Composition 16:9, slight wide-angle. Calm professional energy, not stiff."

gen "char-package-arrival.jpg" "A concierge (a friendly middle-aged Afro-Brazilian man in a pale-gray vest) hands a cardboard package to a smiling young woman at the front desk of an apartment lobby. Behind him, cubbies with other packages. Warm clay-like shelving. She's holding her phone in her other hand as she reaches for the box. Horizontal 16:9, shot from slight angle. Cheerful, everyday warmth."

gen "char-whatsapp-msg.jpg" "Extreme close-up of a smartphone held in a person's hand (skin tone warm brown), screen showing a WhatsApp-like chat bubble with a cream pastel aesthetic — the bubble text is blurred/illegible but suggests a building notification. Background: soft out-of-focus interior of a Brazilian apartment, terracotta floor tiles, a cup of coffee. Square 1:1. Intimate, morning-light warmth."

gen "char-brazilian-family.jpg" "A multigenerational Brazilian family in the building's shared leisure area: grandmother, father (mixed-race), mother, two kids (boy ~8, girl ~12). They're gathered around a mosaic tile grill (churrasqueira) with a plate of bread. Tropical plants, warm paving, a pool visible in soft background blur. Cream linen clothing, terracotta accents. Horizontal 16:9. Golden-hour lighting. Emotional warmth — this is home."

gen "char-elderly-confident.jpg" "A dignified Afro-Brazilian woman in her late 60s, gray hair pulled back, wearing a crisp mauve-and-cream blouse. She's seated at her kitchen table holding her smartphone naturally with both hands, glasses on, smiling at the screen. Morning light, a cup of coffee, a ceramic bowl with oranges, her small dog at her feet. Horizontal 16:9. The composition feels calm, powerful — technology is for everyone."

# ─────────────────────────────────────────────────────────────────────────────
# ATMOSPHERIC / BACKGROUND — section separators
# ─────────────────────────────────────────────────────────────────────────────

gen "char-community-hands.jpg" "Abstract but character-driven: four hands of different skin tones (Afro-Brazilian, indigenous, white, East Asian) meeting in the center of the frame, palms down in a gentle stack gesture — like a team huddle but softer, more like neighbors agreeing. Clay-like rendering, rounded fingers, soft shadow beneath. Cream background, warm peach glow. Square 1:1. Symbolizes community consensus."

gen "char-phone-closeup-ui.jpg" "Tightly framed hand holding a smartphone screen-on, portrait orientation. The screen displays a clearly-rendered claymorphism mobile app interface with stacked pastel cards: top card shows a pie-chart-like vote tally (sage green + peach), middle card shows a small building icon and text lines (blurred but readable as a dashboard), bottom card has a small rounded button. UI elements are soft-shadowed 3D clay, not flat. Background: out-of-focus cream interior with plants. Square 1:1. This is the money shot — the app looks touchable."

echo ""
echo "All done. Images in $OUT/"
ls -lh "$OUT/" | grep -v "^total"
