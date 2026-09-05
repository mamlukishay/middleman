# design-sync notes

- This repo has no build, no React and no Storybook, so the converter does not apply.
  The library is hand-authored preview HTML under `design/system/`, one card per file,
  each starting with `<!-- @dsCard group="…" -->`; the app indexes cards from that line.
- Upload the cards and `README.md` as they are (`localDir: design/system`). No
  `_ds_sync.json` anchor is written: every sync re-uploads the whole set, which is small.
- Before syncing, render every card in headless Chrome with `--mute-audio` and run
  `node --test test/design-system.test.mjs`; it checks `backup-c/` cards against the
  `skeuo` worktree's CSS and every other card against the repo root.
