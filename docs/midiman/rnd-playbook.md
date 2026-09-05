# MidiMan — R&D playbook

Owner: **Nina** (Head of R&D). Update when the build loop changes.

## People

| Role | Who | Owns |
|---|---|---|
| Right hand | Felix | Staffing, cadence, routing |
| PM | Mira | Briefs, acceptance, roadmap |
| Head of R&D | Nina | How we build, QA bar, tooling, shipping |
| Human at the piano | Ishay | Real MIDI play, post-session notes, Claude Code on Mac |

## Loop

1. Mira brief with acceptance  
2. Nina plan + slice (+ GitHub issue)  
3. Paste-ready **Claude Code handoff** → Ishay runs on Mac  
4. Push to GitHub (scoped commits OK; PRs for playable bundles)  
5. Nina watch / review-bot flags what Ishay should skim  
6. Ishay plays once → feedback packet (notes / screenshots / PR results) → Mira  

## Tools

- **Claude Code on Ishay’s Mac** — primary coding path this month.  
- **Cursor cloud agents** — when repo access is granted; not for live MIDI. Prefer MockMidiBus for agent-side work when it exists.  
- **GitHub connector** — Issues/PRs/commits (fine-grained PAT; personal repos only as granted).  

## Stack rules (don’t invent architecture)

Native ES modules, no build step, Web MIDI, `serve.py` relay. Keep changes inside that world unless Mira + Ishay agree otherwise.

## QA bar (per slice)

- Unit tests where logic is pure.  
- Smoke for Learn / relay when those paths are touched.  
- Real MIDI play is human-only (Ishay).  

## Feedback packet (back to Mira)

After play: what worked / what broke / how it felt (+ screenshot if something’s weird).  
Plus PR/test notes from Nina when relevant.

## Related

- Skill: Claude Code handoff brief (paste-ready template).  
- Issues: `#1` board conventions, `#2` Intro-coach (E1 / P0 / I2).
