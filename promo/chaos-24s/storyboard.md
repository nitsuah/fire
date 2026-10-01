# chaos-24s — storyboard

**What it is:** fire's new 🌪️ Chaos mode and customizable layout. Chaos sprinkles realistic, seeded life events onto the retirement projection; the layout lets you collapse, reorder and pin any card to the Dashboard.
**For:** FIRE planners whose spreadsheet assumes a perfectly smooth line.
**Sets it apart:** The events are specific and believable (gallbladder surgery, a cat's cancer, a child, a promotion, a windfall), each with predefined costs, and every marker explains itself on hover.
**Most impressive / funniest:** The plan said $1.8M at 62. With a contested divorce, a kid and a dog that swallowed a sock, it's $723K less.
**Visual hook:** "Every retirement plan assumes nothing goes wrong." — then "nothing" gets struck through in coral.
**Share caption:** see share-copy.txt

**Tone:** default (punchy, clean). **Format:** 1920×1080, 30fps, 22s. **Music:** 120 BPM, A minor; calm pad for the hook, the groove drops on the Chaos click.
**Identity:** bg `#080b11`, violet `#8b5cf6`, emerald `#10b981`, coral `#f43f5e`, amber `#f59e0b`, chaos pink `#ec4899`; Outfit headings, Inter body.

All numbers and events are real app output for the fictional demo portfolio (`promo/demo-seed.js`) with chaos seed 60 (`CHAOS_SEED` in `capture.js`). Event callouts are positioned from the real chart's data points (`chaos.json`).

## Storyboard

| # | Time | Scene |
|---|---|---|
| 1 Hook | 0.0–3.5 | "Every retirement plan / assumes nothing goes wrong." pops in word by word over a calm violet curve drawing itself. At 2.45s "nothing" is struck through in coral and the curve shudders. |
| 2 Chaos | 3.5–8.5 | "🌪️ Chaos mode" + "Realistic life events, rolled onto your plan." The real Projections chart slides up; the cursor clicks **🌪️ Chaos** (4.5s, the groove drops) and the line breaks into ▲/▼ markers. Six real callouts pop at their markers: gallbladder surgery, new job, divorce, child, cat cancer, windfall. |
| 3 Hover | 8.5–12.0 | Zoom into the real hover tooltip (Age 37, gallbladder surgery −$2.5K). Right: "Hover any marker." / "See what happened and what it cost." and the real net effect **−$723K** by age 62 vs. no chaos. |
| 4 Everywhere | 12.0–15.5 | Phone frame with the real mobile Dashboard (chaos on). Right: "Dashboard. Projections. Your phone." The real event-chip list wipes in, then "🎲 Reroll for a different life." |
| 5 Make it yours | 15.5–18.5 | "Make it yours." / "Collapse, reorder, pin any card." The real Dashboard in Customize mode tilts in; the real widget picker pops over it and the cursor clicks **Add** on CD Ladder. |
| 6 Outro | 18.5–22.0 | 🔥 fire · "Plan for the life you'll actually live." · chips `github.com/nitsuah/fire` and `docker compose up fire` · TRY IT LIVE **lifefire.netlify.app** |
