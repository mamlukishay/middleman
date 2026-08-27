# Looper design canvas

The sources behind <https://claude.ai/code/artifact/ccfbb32d-d978-47a9-a432-2c8ece959faa>.

Each `.dc.html` is one artboard; `canvas.json` lays them out. The published page is
assembled from these and is not committed -- it is 2.5MB of editor payload.

| Artboard | What it shows |
|---|---|
| `Main` | the looper screen: lanes under the chord strip, deck, key strip |
| `Capture` | taking a loop out of the buffer after playing it |
| `LoopInspector` | per-loop length, mode, follow, quantize, layers |
| `Keys` | the bindings, and why nothing has to be hit on the beat |
| `States` | the lane state machine, and how a late press is backfilled |

The implementation follows these, with two deviations worth knowing:

- **Clearing a lane is not a hold-to-confirm.** `X` clears immediately and `U` puts
  it back, which is both simpler and harder to lose work with.
- **Quantize grid and snap are per-session, not per-loop.** The inspector sets them;
  the per-loop override the artboard implies was not worth the extra state.
