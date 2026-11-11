# NOVA COPILOT

Web-first app (React + Vite) with Supabase auth/storage, deployed on Vercel.
Voice capture uses the browser Speech API (Chrome/Edge/Android Chrome; audio is processed by the browser vendor). AI runs via `api/assist.ts`.
Installs on Android as a PWA. The earlier Electron shell is kept in `desktop/`.

## 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor → run `supabase/schema.sql`.
3. Project Settings → API → copy the Project URL and the anon/public key.

## 2. Run locally
```bash
cp .env.example .env.local   # paste your two values
npm install
npm run dev          # UI only
npx vercel dev       # UI + /api/assist (put GEMINI_API_KEY in .env.local)
```
Existing Supabase project? Run the commented `alter table ... add column kind` line in `schema.sql` once.

## 3. Deploy to Vercel
1. Push this folder to GitHub.
2. Vercel → Add New Project → import the repo (Vite is auto-detected).
3. Add env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `GEMINI_API_KEY` (server-only; optional `GEMINI_MODEL`).
4. Deploy. In Supabase → Authentication → URL Configuration, add your Vercel URL as Site URL.

## 4. Android
Open the Vercel URL in Chrome on Android → menu → **Install app** / Add to Home screen.

## Security
Only the public anon key goes in the client; row-level security protects each user's data.
Future AI calls must go through a Vercel serverless function (`/api`) with the key as a
server-side env var, never in client code.
