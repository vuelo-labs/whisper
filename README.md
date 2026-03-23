# Whisper

> *A sanctuary for intentional anonymous feedback that builds emotional resilience.*

Whisper distinguishes **Harm** (blocked) from **Hurt** (allowed — discomfort is growth). It challenges you to be a brave sender and a strong receiver. Not everyone will like you. That's okay. Be human. Be vulnerable.

---

## Running the app

Whisper is pure vanilla HTML/CSS/JavaScript. No build step. No dependencies to install.

**Option 1 — Open directly in browser:**
```
open index.html
```
> Note: ES modules (`type="module"`) require a server in most browsers. Use option 2.

**Option 2 — Python static server (recommended):**
```bash
cd whisper-app
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Option 3 — Any static server:**
```bash
# npx serve (if you have Node installed)
npx serve .

# VS Code: use the Live Server extension
# Just right-click index.html → "Open with Live Server"
```

---

## File structure

```
whisper-app/
├── index.html          — Landing page (email entry → entity creation)
├── dashboard.html      — Owner's Quiet Room (inboard / outboard / settings)
├── room.html           — Public board view (share this URL)
├── compose.html        — Mindfulness gate + compose form
├── css/
│   └── whisper.css     — Custom animations: fog, breathing circle, dissolve
├── js/
│   ├── entity.js       — SHA-256 hashing, ghost name, sigil SVG generator
│   ├── nlp.js          — AFINN sentiment scoring + harm/slur filter
│   ├── storage.js      — All localStorage CRUD operations
│   └── app.js          — Page detection and initialisation logic
└── supabase/
    └── schema.sql      — Full Supabase schema for when you're ready to scale
```

---

## How it works

### Identity
Each user is identified by the SHA-256 hash of their email address. No passwords. No accounts. A deterministic **ghost name** (e.g. *Velvet Heron*) and **sigil** are generated from this hash — unique to you, consistent across sessions.

### Sending a whisper
Public senders pass through a **five-phase Liturgy**:
1. **Admire** — a quiet strength you see in them
2. **Appreciate** — a small way they've impacted your world
3. **Wish** — a good fortune you hope finds them
4. **Final Mirror** — are you doing this for them, or for yourself?
5. **The Whisper** — the message itself (max 280 chars)

Trusted senders (via a private trust link) skip straight to a 60-second reflection and the compose step.

### Receiving
Whispers arrive in your **Antechamber** as blurred, fog-covered cards. You choose when to unveil them. After unveiling, you can:
- **Integrate** — carry it with you (it appears on your public board)
- **Release** — hear it and let it go

### NLP safety
- Slurs and dehumanising language → **blocked**
- Strong but non-harmful criticism → **allowed with a weight warning**
- Pasted text (velocity check) → **gentle nudge to slow down**
- Warm, positive language → **background shifts toward rose glow**

### Rate limiting
Each sender is limited to **3 whispers per 30-day cycle**. The space is sacred.

---

## Connecting Supabase

When you're ready to make Whisper multi-device and persistent:

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL editor
3. Install the Supabase JS client:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
   ```
4. Replace `js/storage.js` with a Supabase-backed version. The function signatures are identical — only the implementation changes:
   ```javascript
   import { createClient } from '@supabase/supabase-js'
   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

   // Replace localStorage reads/writes with supabase.from('entities').select() etc.
   ```
5. Set `app.current_entity_id` as a Postgres session variable on each request (or use Supabase's RLS with a custom JWT claim).

---

## Philosophy

Whisper exists because the most important things are usually the last to be said.

We live in a world that rewards performance over presence, confidence over vulnerability. Whisper creates a container for the words that don't fit anywhere else — the admiration you never voiced, the disappointment that needed somewhere to land, the quiet wish you held for someone without knowing how to offer it.

It is not a feedback tool. It is not a review platform. It is a place to practise being honest, being brave, and being human.

**Go be human.**

---

*Built with vanilla HTML, CSS, and JavaScript. No frameworks. No tracking. No noise.*
