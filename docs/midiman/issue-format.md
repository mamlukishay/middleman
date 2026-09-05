# MidiMan — GitHub issue format

Owner: **Mira**. Every eng issue must be readable by Ishay as an app user (not a developer).

## Required sections

1. **IDs** — Epic / Priority / Issue / Slice name (see [product-conventions.md](product-conventions.md)). Can sit at the top of the issue.

2. **User story** — who / what / why in plain language.  
   Example: “As Ishay at the piano with the phone on the stand, I want to land in City of Stars Intro and practice the left-hand vamp in a loop so I feel progress without hunting menus.”

3. **How to get there (STR)** — step-by-step what you *see and tap* in the app. No unexplained code ids. Show labels the UI actually shows (e.g. the button **Put it on the phone**, the step title **Listen**).

4. **Acceptance criteria** — each AC is a **checkbox** (`- [ ]`). ACs *are* the verify list; do **not** add a separate “Verify checklist” section. Write pass/fail so R&D can tick without Ishay at the piano when possible. If an AC is fuzzy, Mira asks **Nina** before locking.

5. **Out of scope** — hard boundaries.

Reference example: GitHub issue **#2** (Intro-coach).

## Don’t

- Don’t put agent persona / working-style docs in Issues (those live on the agent’s desk).
- Don’t use raw module/file names or `#elementId` as the only description of a feature — translate to what the user sees.
- Don’t duplicate ACs with a second R&D verify checklist.

## When asking Ishay to decide

Restate the choice with a **short concrete example** of what he’d experience either way.
