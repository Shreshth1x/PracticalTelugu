# PalukuLingo

PalukuLingo is a practical Telugu-learning app built around two ways in:

- **The essentials** — a short crash course for greetings, names, family,
  food, and getting unstuck.
- **From the beginning** — a friendly lesson path for learners who want the
  language step by step.

Mayu, an original Indian peacock mascot, guides both paths. Progress, XP,
streaks, energy, and lesson completion are stored locally in the browser.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The development server prints the local URL when it starts.

## Curriculum and family audio

Lesson content lives in `app/course-data.ts`. Every vocabulary item supports an
optional `audioSrc`, so family-recorded pronunciation clips can be added without
changing the lesson engine.

## Verification

```bash
npm run lint
npm test
```

`npm test` creates the production vinext build and checks the rendered home
experience.
