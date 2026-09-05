# MidiMan — R&D playbook

Owner: **Nina** (Head of R&D). Update when the build loop changes.

Repo: [`peak-luli/midiman`](https://github.com/peak-luli/midiman) (Issues/PRs live here).

## People

| Role | Who | Owns |
|---|---|---|
| Right hand | Felix | Staffing, cadence, routing |
| PM | Mira | Briefs, acceptance, roadmap |
| Head of R&D | Nina | How we build, QA bar, tooling, shipping |
| Human at the piano | Ishay | Real MIDI play, post-session notes, Claude Code on Mac |

## Loop

1. Mira brief with **testable acceptance** (GitHub Issue).
2. Nina plan + slice → Issue updated; paste-ready **Claude Code handoff** to Ishay.
3. Ishay runs **Claude Code on his Mac** (Nina does not drive the Mac).
4. Push to GitHub — scoped, well-named commits OK; **PR only for playable feature bundles** (not every commit).
5. Nina wakes from **GitHub watch** (PR/CI events) and **main push poll** (~every 30m, 08–23 local) → review-bot flags only what Ishay should skim (stack drift, missing tests, MIDI/relay risk, oversized diffs).
6. Ishay plays once (real MIDI) → Nina sends **feedback packet** to Mira (notes / screenshots / test results / PR link if any).

## Tools

- **Claude Code on Ishay’s Mac** — primary coding path this month. Nina writes the handoff brief; Ishay pastes and runs.
- **Cursor cloud agents** — for non-MIDI work **once** Cursor has access to `peak-luli/midiman` (currently blocked). Prefer **MockMidiBus** (same interface as Web MIDI + fixtures) so agents/CI can run without a piano.
- **GitHub connector / Issues** — shared backlog (Nina + Ishay). Board conventions: Issue `#1`. Active P0 slice: `#2` `[E1][P0][I2] Intro-coach`.

## Stack rules (don’t invent architecture)

Native ES modules, no build step, Web MIDI, `serve.py` relay. Change architecture only with a clear reason and Mira + Ishay alignment.

## QA bar (per slice)

- Unit where logic is pure (e.g. plan shape, streak / accuracy).
- Smoke for Learn / relay when those paths are touched.
- Mock MIDI for agent/CI path when MockMidiBus exists; **real MIDI play is human-only (Ishay)**.
- Gate on the Issue’s cold pass/fail ACs — R&D should verify without Ishay at the piano where possible; he still does the feel playtest.

## Claude Code handoff (minimum)

Paste-ready brief must include: goal, repo/branch, acceptance, in/out of scope, stack rules, likely files, QA checklist, commit/PR style, “done = pushed so Nina’s watch picks it up.”

Reusable skill: [Claude Code handoff brief](sand-workflow:claude-code-handoff-brief) (Grok Bot skill library).

## Feedback packet (back to Mira)

After play: what worked / what broke / how it felt (+ screenshot if something’s weird).  
Plus PR/test notes and AC checklist results from Nina.

## Related

- `docs/` = shared process wiki (this file and siblings).
- Agent persona / desk memory = not the wiki; don’t duplicate org chart here beyond the table above.
- Issues: `#1` board conventions, `#2` Intro-coach (E1 / P0 / I2).
