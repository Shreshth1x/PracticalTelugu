# PracticalTelugu

PracticalTelugu is a fast, phrase-first Telugu companion for people who want to
participate in real conversations. It skips alphabet units, grammar detours,
and locked curricula in favor of an ordered practical path that moves five
phrases at a time while keeping family visits, meals, errands, travel, and
helpful situations open.

Mayu, an original Indian peacock mascot, introduces the first phrase and
returns to celebrate completed practice. Completed situations and phrase
confidence are stored locally in the browser; no account or AI service is
required.

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
