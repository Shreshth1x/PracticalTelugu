# PracticalTelugu

PracticalTelugu is a fast, phrase-first Telugu companion for people who want to
participate in real conversations. It skips alphabet units, grammar detours,
and locked curricula in favor of short, open practice for family visits,
meals, errands, travel, and moments when someone needs help.

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

Situation content lives in `app/course-data.ts`. Every phrase supports an
optional `audioSrc`, so family-recorded pronunciation clips can be added without
changing the practice engine.

## Verification

```bash
npm run lint
npm test
```

`npm test` creates the production vinext build and checks the rendered home
experience.
