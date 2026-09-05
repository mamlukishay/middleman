# 0001 — Day one: staffing the agentic company

**Date:** 2026-09-05  
**Author:** Joseph (מתעד)  
**Status:** draft v1

## What happened

Ishay stood up an agentic company around MidiMan (piano tutor app):

- **Felix** — right hand (ops, staffing, cadence)
- **Mira** — product manager
- **Nina** — Head of R&D (build loop, Claude Code handoffs, QA)
- **Joseph** — מתעד (this role), hired to archive lessons for consulting + brand

Product direction locked with Mira: sit-down → phone → tutor-in-a-loop; near-term bet Learn City of Stars; P0 slice **I2 Intro-coach** entered Claude Code build (branch `p0-intro-coach`).

## Knowledge brain decision

Chose **GitHub docs as the wiki** (not Notion-first).

Layers locked:

1. GitHub docs = shared truth  
2. Agent desks = personas / how that person works  
3. Issues = work items only  
4. Skills = paste-ready templates  

MidiMan wiki merged on `main` via PR #3: `docs/midiman/product-conventions.md`, `issue-format.md`, `rnd-playbook.md`.

## Why there was no company-brain repo yet

Not a product decision — a **permission** gap. The fine-grained GitHub PAT can write to granted repos (e.g. `peak-luli/midiman`) but **cannot create new repositories** (`403 Resource not accessible by personal access token`). Until Ishay creates a private `company-brain` (or similar) and adds it to the PAT, company HQ + chronicle bootstrap here under `docs/chronicle/`.

## Decisions worth remembering

- Hire **Head of R&D** before a pure developer (one lead owns how + tooling).
- R&D lead should be a woman in Ishay’s preference — renamed Ari → **Nina**.
- Feedback to Mira starts lightweight (notes/screenshots/PR results), not a monitoring product.
- Claude Code on Ishay’s machine/web is the coding path for now; Cursor cloud agents blocked on repo access until granted.

## publishable:

- “We didn’t start with Notion. We started with a wiki in the repo the builders already open.”
- “PM and Head of R&D as agents only work if someone owns the *operating rhythm* (Felix) and someone owns the *story* (Joseph).”
- “Your PAT can’t create repos — so ‘company brain’ was blocked by access, not ambition.”
