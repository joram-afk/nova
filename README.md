# NOVA COPILOT

Web-first app (React + Vite) with Supabase auth/storage, deployed on Vercel.
Voice capture uses the browser Speech API (Chrome/Edge/Android Chrome; audio is processed by the browser vendor). AI runs through the serverless function `api/assist.ts` (Gemini).
Installs on Android as a PWA. The earlier Electron shell is kept in `desktop/` and is not part of the web build.

## Where things live
| Path | What it is |
| --- | --- |
| `src/App.tsx` | Main screen and logic for listening, screen share, meeting audio, sessions and AI calls |
| `src/Dock.tsx` | The control panel at the bottom of a session |
| `src/Settings.tsx`, `src/Profile.tsx`, `src/Auth.tsx`, `src/SessionList.tsx` | Pages and lists |
| `src/types.ts` | Shared mode, row, note and note-kind types |
| `src/lib/assist.ts` | `callAssist()`, a reusable authenticated client for `/api/assist` |
| `src/lib/transcript.ts` | Pure transcript helpers for parsing, chunking, question checks and interim text merging |
| `src/lib/settings.ts` | Settings type, defaults, limits and themes |
| `api/assist.ts` | Server-side prompts, task table, model list and fallback |
| `themes.plugin.mjs` | Build step that turns hex colours in `src/**/*.css` into theme variables |
| `schema.sql` | Supabase database schema |

## 1. Supabase
1. Create a project at supabase.com.
2. In SQL Editor, run `schema.sql`.
3. Project Settings → API → copy the Project URL and the anon/public key.

## 2. Run locally
```bash
cp .env.example .env.local   # paste your two values
npm install
npm run dev          # UI only
npx vercel dev       # UI + /api/assist (put GEMINI_API_KEY in .env.local)
```

## 3. Checks
```bash
npm run check        # type-check + tests
```

## 4. Deploy to Vercel
1. Push this folder to GitHub.
2. Vercel → Add New Project → import the repo (Vite is auto-detected).
3. Add env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `GEMINI_API_KEY` (server-only; optional `GEMINI_MODEL`).
4. Deploy. In Supabase → Authentication → URL Configuration, add your Vercel URL as Site URL.

## 5. Android
Open the Vercel URL in Chrome on Android → menu → **Install app** / Add to Home screen.

## Security
Only the public anon key goes in the client; row-level security protects each user's data.
AI requests are handled by `api/assist.ts`, which checks the user's sign-in token and keeps `GEMINI_API_KEY` on the server. Never put that key in client code.
