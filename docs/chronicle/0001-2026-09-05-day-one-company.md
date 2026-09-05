# 0001 — Day one: staffing the agentic company

**Date:** 2026-09-05 (IDT)  
**Author:** Joseph (מתעד)  
**Status:** owned v1 (names updated 2026-09-05 for Miriam)  
**Sources:** Felix / Miriam / Nina memory logs; MidiMan PR #3 (wiki), Issues #1–#2; PR #4 (this archive)

## What happened

Ishay stood up an agentic company around MidiMan (piano tutor / practice app, GitHub `peak-luli/midiman`):

| Role | Who | Owns |
|---|---|---|
| Right hand | **Felix** | Ops, staffing, cadence |
| Product | **Miriam** (briefly Mira; see [0002](0002-2026-09-05-mira-to-miriam.md)) | What/why, ACs, roadmap |
| Head of R&D | **Nina** (renamed from Ari) | How we build, QA bar, Claude Code / Cursor handoffs |
| Chronicler | **Joseph** (מתעד) | Archive decisions, loops, role lessons, publishable nuggets |

Product north star locked with Miriam: sit-down → phone → tutor-in-a-loop; Practice stays; Learn spine with **City of Stars** as near-term bet; Looper/jam/voice parked.

P0 slice **[E1][P0][I2] Intro-coach** (Issue #2): City of Stars Intro bars 1–4 LH Gm vamp — polish the existing tutor spine (loop, live %, streak, advance, coach text, phone), not a rewrite. Ishay kicked Claude Code on the web (~19:51 IDT) on branch `p0-intro-coach`; Nina watching for branch/PR.

Operating loop in play: Miriam brief → Nina plan/slice → Claude Code build → PR + tests → Ishay plays once → feedback packet back to Miriam.

## Knowledge brain decision

Chose **GitHub docs as the wiki** (not Notion-first).

Layers locked:

1. **GitHub docs** — shared truth for rules and playbooks  
2. **Agent desks** — personas / how that person works  
3. **GitHub Issues** — work items only  
4. **Skills** — paste-ready templates (e.g. Claude Code handoff brief)

MidiMan wiki on `main` via PR #3: `docs/midiman/product-conventions.md`, `issue-format.md`, `rnd-playbook.md`.

## Why there was no company-brain repo yet

Not a product decision — a **permission** gap. The fine-grained GitHub PAT can write to granted repos (e.g. `peak-luli/midiman`) but **cannot create new repositories** (`403 Resource not accessible by personal access token`). Until Ishay creates a private `company-brain` (or similar) and adds it to the PAT, company HQ + this chronicle live under `docs/chronicle/` in MidiMan.

## Decisions worth remembering

- Hire **Head of R&D** before a pure developer — one lead owns how + tooling.
- R&D lead should be a woman in Ishay’s preference — Ari → **Nina**.
- Feedback to Miriam starts lightweight (notes / screenshots / PR results), not a monitoring product.
- Issue ACs are checkbox-only verify lists (no separate Verify section).
- Claude Code (web / Mac kickoff) is the coding path until Anthropic month ends; Cursor cloud agents wait on Cursor↔GitHub App access to this repo.
- Tracking tags: `[E#] [P0|P1|P2] [I#]` + slice name; Epic replaces Milestone for outcome bets.

## publishable:

- “We didn’t start with Notion. We started with a wiki in the repo the builders already open.”
- “PM and Head of R&D as agents only work if someone owns the *operating rhythm* (Felix) and someone owns the *story* (Joseph).”
- “Your PAT can’t create repos — so ‘company brain’ was blocked by access, not ambition.”
- “Day one loop: Miriam writes the bet, Nina owns the how, Claude Code ships the slice, Ishay plays once.”
