# Study 5, shrunk to real size

Jérémie's ask: does the tapered post + cog in [`iter-05-tilted-cog-tapered-post.svg`](iter-05-tilted-cog-tapered-post.svg) still read once it's not blown up to a 256px display card? Rendered at the actual pixel sizes below (not scaled by CSS — each image is a native `rsvg-convert` render at that exact size), next to Baseline B (`media/adr-icon-scale-marketplace.svg`, the already-committed level/dot/no-taper candidate) for a fair comparison.

Delivered as a plain file, not a hosted page — the last artifact link didn't work for you. (I fetched it myself and got back the full, correct, up-to-date HTML, "owned by you" — so the publish itself is fine; whatever's wrong is on the client side and I can't chase it from here.)

| Size | Study 5 (tilted, cog, tapered post) | Baseline B (level, dot, no taper) |
|---|---|---|
| 16px | ![](render-check/study5-16px.png) | ![](render-check/baselineB-16px.png) |
| 20px | ![](render-check/study5-20px.png) | ![](render-check/baselineB-20px.png) |
| 24px | ![](render-check/study5-24px.png) | ![](render-check/baselineB-24px.png) |
| 32px | ![](render-check/study5-32px.png) | ![](render-check/baselineB-32px.png) |
| 48px | ![](render-check/study5-48px.png) | ![](render-check/baselineB-48px.png) |
| 64px | ![](render-check/study5-64px.png) | ![](render-check/baselineB-64px.png) |

## What I see

- **Below ~32px, both designs collapse to the same silhouette** — a tilted or level line with two blobby pans. The taper and the cog aren't the reason either one wins or loses at this size; they're just not there yet.
- **The cog becomes legible around 40-48px** — by 48px it reads clearly as a small ring at the pivot, not a smudge. The taper is the weaker of the two details even at 48px; it's a subtle silhouette change and easy to miss unless you're looking for it.
- **This isn't actually the size Study 5 needs to survive.** Study 5 and Baseline B are both Marketplace-icon candidates (128px canvas), not ActivityBar candidates — the extension detail page shows this one at 128px, and VS Code's list/search views show it around 32-48px. So the realistic floor is closer to the 48px row than the 16px row, and at 48px the cog holds up fine; only the taper is genuinely marginal.
- **The 16-24px rows are here for completeness, not as a verdict** — that's ActivityBar territory, which is Baseline A / Studies 7-8's job (the abstract 16px design), not this one's.

## Bottom line

Keep the cog if you like it — it survives its actual deployment sizes. The tapered post is the part I'd call optional: it reads at 128px, is marginal at 48px, and does no real work below that. If you want one fewer variable, dropping the taper and keeping everything else from Study 5 is a reasonable simplification; I haven't drawn that combination since you didn't ask for it, but it's a five-minute follow-up if useful.
