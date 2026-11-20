# Word Hunt — online two-player word guessing game

A React + Supabase starter for the agreed rules: Player 1 chooses a five-letter secret word and manually marks each guess; Player 2 gets five attempts. The secret word is only returned by the game RPC to the host player.

## 1. Create the Supabase backend

1. Create a project at https://supabase.com.
2. Open **SQL Editor** and run the complete contents of `supabase.sql`.
3. In **Project Settings → API**, copy the Project URL and anon/public key.
4. Copy `.env.example` to `.env` and fill in the values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Never put a Supabase `service_role` key in this frontend project.

## 2. Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To play online, deploy the app to Vercel or Netlify and set the same two environment variables in the hosting dashboard.

## 3. How to play

- Player 1 chooses **Create a game**, enters a display name and a five-letter word, then shares the six-character room code.
- Player 2 opens the deployed app, chooses **Join a game**, and enters the room code.
- Player 2 submits five-letter guesses.
- Player 1 taps each letter to cycle through grey (absent), yellow (present, wrong position), and green (correct position), then sends feedback.
- Player 2 sees the feedback update. Exact guess wins immediately; otherwise the fifth guess ends the game.

## MVP notes / next hardening steps

- This is a starter implementation, not a production-audited service. RPCs use a browser-generated player ID stored in session storage as a lightweight room credential. Anyone who obtains that credential may impersonate that player; use authenticated Supabase users or signed, expiring room tokens before public launch.
- The app refreshes on Realtime events and also polls every four seconds as a fallback.
- Add rate limiting, room expiry/cleanup, reconnect handling, and automated tests before broad public release.
- The host should mark duplicate letters carefully; feedback is manual by design.
