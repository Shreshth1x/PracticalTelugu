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
already on the device to the account instead of replacing it. No AI service is
required.

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
