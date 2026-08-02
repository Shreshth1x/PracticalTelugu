# PracticalTelugu

PracticalTelugu is a fast, phrase-first Telugu companion for people who want to
participate in real conversations. It skips alphabet units, grammar detours,
and locked curricula in favor of an ordered practical path that moves five
phrases at a time while keeping family visits, meals, errands, travel, and
helpful situations open.

Mayu, an original Indian peacock mascot, introduces the first phrase and
returns to celebrate completed practice. Completed situations and phrase
confidence are stored locally in the browser, so every lesson remains
available without an account. An optional account can be created with Google
or email and password to back up practiced phrases and saved phrases through
Supabase and restore them on another device. Signing in adds any progress
already on the device to the account instead of replacing it. The phrase path
does not require an AI service.

Practice Live is an optional, local-first Telugu voice conversation with Mayu.
Mayu keeps the spoken exchange in Telugu while the screen pairs every turn's
Telugu written in English letters and its pronunciation guide with its English meaning. Native
Telugu script and raw speech-recognition output never enter the live display.
Completed live-session totals are stored on the current device; microphone
audio is streamed only while the learner has an active session.

Google sign-in is ready for public use. Email/password confirmation and
password-reset messages use Supabase Auth; configure a custom SMTP provider
before relying on those email flows for users outside the Supabase project
team.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The development server prints the local URL when it starts.

## Practice Live setup

This checkout uses the Doppler project `practicaltelugu` and its `dev`
configuration. After authenticating the Doppler CLI, start the app with:

```bash
npm run dev:doppler
```

The command makes `GEMINI_API_KEY` available to the local Cloudflare runtime
through an ephemeral `.dev.vars` mount. Doppler removes the mount when the
development server exits, so the key is never copied into the repository.

Without Doppler, create a Gemini API key in
[Google AI Studio](https://aistudio.google.com/app/apikey), then add it to a
local `.env.local` file:

```bash
GEMINI_API_KEY=your_key_here
```

Restart `npm run dev` after changing the environment file. Do not prefix this
variable with `NEXT_PUBLIC_`: the permanent key is read only by the server-side
token route. The browser receives a one-use, short-lived credential for each
conversation instead.

Practice Live currently uses Gemini's prebuilt Aoede voice. A family voice can
be connected later through a consented voice provider without changing the
conversation screen, but no cloned voice is enabled by default.

## Practical situations and family audio

Situation content lives in `app/course-data.ts`. Every phrase keeps four
separate learning layers: its English meaning, stable romanized Telugu, an
easy English-speaker pronunciation cue, and Telugu script. The pronunciation
cue is deliberately approximate and complements, rather than replaces, the
optional `audioSrc` for family-recorded pronunciation clips.

## Verification

```bash
npm run lint
npm test
```

`npm test` creates the production vinext build and checks the rendered home
experience.
