# Oh Sheet!
> Turn a photo of any sheet music into an editable digital score (MusicXML)

**Oh Sheet!** is a CS 343 course project by [Vansh Chugh](https://github.com/ChughVansh), [Khizran Fatima](https://github.com/kfatima317), and [Anh Phan](https://github.com/salad905).

Oh Sheet! is a browser-based optical music recognition (OMR) tool for printed classical scores and handwritten jazz lead sheets, with no installation or payment required. Upload a photo or scan (PNG, JPG, or multi-page PDF), choose *classical* or *jazz*, and get back an editable, playable `.musicxml` file that opens directly in MuseScore.

Three independently pretrained backends sit behind one interface: **Legato** (default for classical), **homr** (alternate classical model you can compare against), and **Jazzmus** (handwritten jazz lead sheets, including chord symbols). All three converge on a single in-browser editor, player, and score library.

---

## How It Works
Upload PNG, JPG, or PDF (single or multiple files; PDFs are rasterized per page)
↓
Choose Classical or Jazz
↓
Modal GPU endpoint routes to Legato / homr (classical) or Jazzmus (jazz)
↓
Output converted to a single MusicXML document
↓
View and edit in the browser → export .musicxml → open in MuseScore

---

## Features

**Upload**
- Drag-and-drop anywhere on the page, or browse/camera
- Multi-file upload with drag-to-reorder page preview
- Multi-page PDF support: every page is processed automatically
- Per-image crop and rotate in the preview lightbox
- Classical and Jazz model selection, with an optional alternate classical model (homr) to compare

**Editor**
- Interactive sheet music viewer powered by OpenSheetMusicDisplay
- Click any note to select it; shift-click for multi-select
- Pitch editing: click up/down, drag a note vertically, or use the keyboard
- Accidental, duration, and chord-note controls in the properties panel
- Chord symbols: click a chord to rename or remove it, or add one to any note with the Chord button (Ctrl+K), including on lead sheets where none were detected
- Consistent 4 bars per line
- Supports several keyboard shortcuts (see the keyboard button at the bottom right of the editor)
- Transpose entire score by semitone or octave
- Playback with BPM control; **click a note to start playing from that point**
- Undo / redo history
- Mobile-responsive layout with a compact quick-edit toolbar

**Export & Library**
- One-click export to `.musicxml` (opens in MuseScore, Sibelius, etc.)
- Export to PDF via browser print
- Google OAuth sign-in (Firebase Auth)
- Personal library: save, browse, and re-open past scores (Firestore)

---

## Running Locally

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) (install with `brew install pnpm` on Mac or `npm install -g pnpm`)
- Environment variables: see `.env.example`

### Frontend Setup

```bash
git clone https://github.com/ChughVansh/music-app.git
cd music-app/Frontend

# Copy the env template and fill in the values
cp .env.example .env
# Edit .env: set VITE_API_URL and all VITE_FIREBASE_* vars

pnpm install
pnpm dev
# → http://localhost:5173
```

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/upload` | Upload sheet music files (requires sign-in) |
| `/editor` | View converted score and export `.musicxml` |
| `/library` | Personal saved scores (protected, requires sign-in) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Tailwind CSS v4 + shadcn/ui |
| Animations | Motion (Framer Motion) |
| Auth | Firebase Authentication (Google OAuth) |
| Database | Firestore (user score library, inline thumbnails) |
| Backend | Python + FastAPI + [Legato](https://github.com/guang-yng/legato), [homr](https://github.com/liebharc/homr), and Jazzmus OMR models |
| PDF conversion | pdf2image + poppler |
| GPU Hosting | [Modal](https://modal.com) (T4 GPU, pay-per-invocation) |
| Frontend Hosting | Cloudflare Pages |

---

## Project Structure
music-app/
├── Backend/
│   └── modal_app.py        # Modal GPU endpoint: OMR inference, Firebase token verification
├── Frontend/
│   ├── src/app/
│   │   ├── pages/          # LandingPage, UploadPage, EditorPage, LibraryPage
│   │   ├── components/     # Navbar, SheetMusicCanvas, ProtectedRoute, editor UI
│   │   ├── lib/            # firebase.ts, auth-context.tsx, save-score.ts, generate-thumbnail.ts
│   │   ├── routes.tsx
│   │   └── App.tsx
│   ├── .env.example        # Copy to .env and fill in all vars
│   ├── firestore.rules     # Firestore security rules (deploy via Firebase console)
│   ├── public/_redirects   # Cloudflare Pages SPA routing fix
│   └── package.json
└── README.md

---

## Backend Deployment

The Modal backend is deployed once and shared across the team. To redeploy after changes:

```bash
# One-time: install modal and authenticate
pip install modal
modal setup

# One-time: create the Firebase service account secret
# Generate a service account key from Firebase Console → Project Settings → Service Accounts
# Then:
modal secret create firebase-service-account FIREBASE_SERVICE_ACCOUNT_JSON='<paste JSON here>'

# Deploy
modal deploy Backend/modal_app.py
# → prints the endpoint URL to put in VITE_API_URL
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/transcribe-multi` | POST | Multiple files or PDF → MusicXML. Requires `score_type` form field: `"classical"` (Legato by default, or homr via the `model` field) or `"jazz"` (Jazzmus) |

---

## Frontend Deployment (Cloudflare Pages)

1. [cloudflare.com](https://cloudflare.com) → Workers & Pages → Create → Pages → Connect to Git
2. Build settings:
   - **Root directory**: `frontend`
   - **Build command**: `pnpm install && pnpm build`
   - **Output directory**: `dist`
3. Add environment variables (all `VITE_*` keys from `.env.example`)
4. Deploy. Live at `*.pages.dev`

---

## Team

| Name | Role |
|------|------|
| Vansh Chugh | ML / OMR model + backend |
| Khizran Fatima | Frontend & UI/UX + backend |
| Anh Phan | Research + integration + backend |
