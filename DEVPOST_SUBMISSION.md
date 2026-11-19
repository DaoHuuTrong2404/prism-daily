# Devpost Submission Draft — PRISM DAILY

## Project Name
**PRISM DAILY**

## Tagline (Short Description)
Bend the daily laser beam through mirrors, prism splitters, and quantum portals to ignite every crystal in optimal Par moves — right inside a Reddit post.

## Inspiration
Great Reddit daily games like `r/hotandcold`, `r/pocketgrids`, and `r/pixelary` share two traits: you understand them in 2 seconds without reading a manual, and finishing them makes you want to compare your score in the comments. We wanted to bring tactile optical physics — glowing mirrors, beam splitters, and wormhole portals — directly into Reddit's feed with zero external asset bloat and 100% mathematically guaranteed solvability.

## What It Does
- **Living Inline Feed Card (`splash.html`):** Right inside the subreddit feed, players see today's optical bench pulsing with an animated preview beam, today's solver count, and their active streak before even opening expanded mode.
- **3-Stage Daily Optical Run (`game.html`):** Every UTC midnight generates a fresh deterministic 3-stage pack:
  1. **First Light (5×5):** Mirrors & obsidian blockers.
  2. **Split Beam (6×6):** Adds diamond prism splitters that pass light straight *and* reflect 90°.
  3. **Quantum Relay (6×6):** Combines splitters with twin wormhole portals (A ↔ B).
- **Exact Optimal Par & Smart Hint Engine:** An exhaustive bitmask solver verifies every generated stage so every single day is provably solvable with an exact minimum-tap Par — and powers a Smart Hint button that highlights the next optimal tile from any board state.
- **Native Reddit Community Loop:**
  - Subreddit leaderboard powered by Devvit Redis sorted sets with real Reddit usernames and Snoovatars.
  - Subreddit move-distribution histogram and percentile rank (`Top X% of r/Subreddit today`).
  - Automatic user flair awards (`PRISM 💎 Par Master` / `PRISM 🔥 Streak`) when subreddit permissions permit.
  - One-click spoiler-free result sharing straight into the post's comment thread or native share sheet.
- **Community Puzzle Studio (UGC):** Players can paint their own 5×5 or 6×6 laser puzzle inside the app, verify solvability & Par live with the built-in solver, and publish it directly to the subreddit as a new playable Interactive Post.

## How We Built It
- **Platform:** Devvit Web (`@devvit/web`, `@devvit/start`), Hono server, Devvit Redis, and Reddit API (`submitCustomPost`, `submitComment`, `getSnoovatarUrl`, `setUserFlair`).
- **Frontend:** React 19, TypeScript, Tailwind CSS 4, custom SVG real-time raytracer with animated photon flow, procedural WebAudio pentatonic chimes, native accessible `<dialog>` modals, and full keyboard arrow-key navigation.
## Verification
- **Verification:** Pure deterministic optics engine (`src/shared/prismEngine.ts`) unit-tested across 100 consecutive calendar dates (300 stages) to guarantee zero unsolvable puzzles and zero infinite beam loops.

## Submitted Live URLs (Verified 2026-11-19)
- **Devpost Submission:** https://devpost.com/software/prism-daily
- **App Listing URL (Devvit v0.0.1, private upload — not submitted for publish):** https://developers.reddit.com/apps/prism-daily
- **Public Subreddit:** https://www.reddit.com/r/PrismDailyGame/
- **Playable Demo Post:** https://www.reddit.com/r/PrismDailyGame/comments/1y039g5/prism_daily_9_bend_the_beam_20261119/
- **GitHub Repository:** https://github.com/DaoHuuTrong2404/prism-daily
- **Optional Feedback Survey (5 × $200 Feedback Awards):** https://forms.gle/dW45UgK6SctevE756
