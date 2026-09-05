# Backup C

These cards document "option C", the block design that lives in the `skeuo` git
worktree (`.claude/worktrees/skeuo`, branch `skeuo`) — not in main. To look at the
app they describe, run `python3 serve.py 8880 127.0.0.1` from inside that worktree
and open http://localhost:8880. They are kept here as a backup of a design that was
explored but not adopted, so the drift test checks them against the worktree's CSS
rather than the repo root, and skips that check when the worktree is not there.
