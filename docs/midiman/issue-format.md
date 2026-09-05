# MidiMan — GitHub issue format

Owner: **Miriam**. Every eng issue must be readable by Ishay as an app user (not a developer).

## Required sections

1. **IDs** — Epic / Priority / Issue / Slice name (see [product-conventions.md](product-conventions.md)). Can sit at the top of the issue.

2. **User story** — who / what / why in plain language.  
   Example: “As Ishay at the piano with the phone on the stand, I want to land in City of Stars Intro and practice the left-hand vamp in a loop so I feel progress without hunting menus.”

3. **How to get there (STR)** — step-by-step what you *see and tap* in the app. No unexplained code ids. Show labels the UI actually shows (e.g. the button **Put it on the phone**, the step title **Listen**).

4. **Acceptance criteria** — each AC is a **checkbox** (`- [ ]`). ACs *are* the verify list; do **not** add a separate “Verify checklist” section. Write pass/fail so R&D can tick without Ishay at the piano when possible. If an AC is fuzzy, Miriam asks **Noa** before locking.

5. **Out of scope** — hard boundaries.

Reference example: GitHub issue **#2** (Intro-coach).

## Paste-ready template

Copy this into a new GitHub issue. Replace the placeholders. If a section truly doesn’t fit (e.g. pure docs chore), stop and ask Ishay — don’t force a fake user story.

```markdown
## IDs
- **Epic:** E# — <outcome name>
- **Priority:** P0 | P1 | P2
- **Issue:** I# (same as this GitHub number)
- **Slice:** <short-name>

## User story
I am <who, in what situation>.  
I want <what I’m trying to do in the app>.  
So that <why it matters to me>.

### How to get there
1. <Open which page / mode — use the labels on screen>
2. <Tap / choose …>
3. <What I should see next — quote the words on screen>
4. …

## Goal
One or two sentences: what “done” feels like for this slice.

## Acceptance criteria

Tick each AC when it passes. The ACs are the verify list.

- [ ] **AC1 — <plain title>**  
  **Steps:** <how to reach this check>  
  **Pass:** <what I see / hear / can do>  
  **Fail:** <what must not happen>

- [ ] **AC2 — <plain title>**  
  **Steps:** …  
  **Pass:** …  
  **Fail:** …

## Out of scope
- <what this issue deliberately does not do>
```

Title pattern: `[E#] [P0|P1|P2] [I#] Slice-name — short human title`

## Don’t

- Don’t put agent persona / working-style docs in Issues (those live on the agent’s desk).
- Don’t use raw module/file names or `#elementId` as the only description of a feature — translate to what the user sees.
- Don’t duplicate ACs with a second R&D verify checklist.

## When asking Ishay to decide

Restate the choice with a **short concrete example** of what he’d experience either way.
