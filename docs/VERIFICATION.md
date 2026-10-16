# Local verification and delivery record

Initial delivery was completed in the project workspace (example checkout: `C:\Projects\realtime-trading-dashboard`). This was an empty independent project directory. No applicable `AGENTS.md` or `CLAUDE.md` was found in the directory or its ancestor instruction paths. All source, icon artwork, fixtures, and synthetic data were authored for this project.

This document records the initial delivery. The subsequent narrow session-replacement repair, current gates, and screenshots are recorded in [QA-REPAIR.md](QA-REPAIR.md). Independent reQA remains pending; neither report grants publication clearance.

## Environment and completed commands

Windows PowerShell; Node **25.1.0**, npm **11.6.2**, Git **2.55.0.windows.2**, existing Google Chrome **155.0.8059.84**. No global install or OS/browser installation was needed. Dependency installation and browser tests ran sequentially; both test runners used one worker.

| Command                                                                      | Actual result                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm ci`                                                                     | Passed; 207 packages installed, 208 audited, **0 vulnerabilities**                   |
| `npm test`                                                                   | Passed; **59 tests in 1 file**, 569 ms total in the final run                        |
| `npm run lint`                                                               | Passed; ESLint with `--max-warnings 0`                                               |
| `npm run typecheck`                                                          | Passed; strict TypeScript project check                                              |
| `npm run build`                                                              | Passed; Vite production build, 33 modules, 1.14 s                                    |
| `npm run test:e2e`                                                           | Passed; **10 scenarios**, 1 worker, no retries, **42.5 s** in the final full run     |
| `npm audit --omit=dev`                                                       | Passed; **0 runtime dependency vulnerabilities**                                     |
| `npm run dev -- --port 5173 --strictPort`                                    | Started successfully; also started automatically by the final browser suite          |
| `npm run preview -- --port 4173 --strictPort`                                | Started successfully; compiled production app exercised in the collaborative browser |
| `npx --yes @aisuite/chub get react/react --version 19.2.6 --lang javascript` | Retrieved and checked React 19.2.6 documentation                                     |

Build output: `index.html` **0.67 kB**, CSS **27.30 kB** (**6.69 kB gzip**), application JavaScript **227.76 kB** (**71.95 kB gzip**). These are build measurements, not performance benchmark claims.

The install reported an ESLint 9 lifecycle deprecation notice. Browser tooling emitted the harness's `NO_COLOR` / `FORCE_COLOR` notice. Neither caused a failed command; application lint had zero warnings. GitHub-hosted CI has **not** run.

## What was actually tested

The 59 domain cases cover reproducible seeded tapes and UTC cadence; replay end bounds; seed/speed validation; generated and imported reset; cash debits, equity, partial-sale basis allocation, realized/unrealized profit and loss, and a mixed-trade accounting identity; market and marketable-limit execution; buy/sell limit crossings and price improvement; pending cash/share reservations and cancellation; short-sale prevention; order, position, cash and gross-exposure rejection; risk rechecks at fill; bounded order history; nonfinite, fractional and oversized inputs; strict CSV headers, byte and row limits, duplicates, order, date and numeric validation; formula-safe exports; and versioned journal reconstruction and malformed-state rejection.

The browser suite runs five scenarios at each of **1440×900** and **390×844**:

1. Play, pause, speed, step, chart range and keyboard inspection/table access, invalid quantity, valid buy, position-cap rejection, reset, keyboard account tabs, and seeded reproducibility.
2. Malformed, formula and oversized file rejection; valid replay import; bad limit precision; reservation and limit fill; explicit cash/equity/P&L math; cancellation; reload reconstruction; real downloaded replay/ledger contents; export/import round trip; imported reset.
3. Malformed localStorage recovery; outward-request guard; successful step/order interactions after Playwright makes the browser context offline; no viewport overflow.
4. Immediate reload preserving the latest order through the page-exit flush; blocked localStorage reporting an error while in-memory orders and reset still work.
5. A populated three-position desk, replay steps, watchlist changes, and real full-page/viewport screenshots, with no viewport overflow.

Production smoke checks additionally selected VOLT, stepped to **09:35:00 UTC**, bought 10 shares, observed **$97,591.70 cash** and **$100,000.00 equity**, and dismissed the reset dialog while retaining the account. The compiled page loaded without external script/font/style assets and fit the desktop viewport horizontally.

## Screenshot evidence

These PNGs are captured by Playwright from the working application, not mockups:

- [`docs/screenshots/desktop-viewport.png`](screenshots/desktop-viewport.png): 1440×900 viewport.
- [`docs/screenshots/desktop.png`](screenshots/desktop.png): full desktop document.
- [`docs/screenshots/mobile-viewport.png`](screenshots/mobile-viewport.png): 390×844 viewport.
- [`docs/screenshots/mobile.png`](screenshots/mobile.png): full intentionally stacked mobile document.

Both layouts were visually reviewed after the final chart responsiveness changes. Wide mobile account tables scroll within their panel. No external font or image service is used.

## Exact delivered file manifest

All 30 files are new in the local initial commit:

```text
.gitattributes
.github/workflows/ci.yml
.gitignore
LICENSE
README.md
docs/AWS-ARCHITECTURE.md
docs/VERIFICATION.md
docs/examples/replay.csv
docs/screenshots/desktop-viewport.png
docs/screenshots/desktop.png
docs/screenshots/mobile-viewport.png
docs/screenshots/mobile.png
eslint.config.js
index.html
package-lock.json
package.json
playwright.config.ts
public/favicon.svg
src/App.tsx
src/Chart.tsx
src/csv.ts
src/domain.ts
src/main.tsx
src/persistence.ts
src/styles.css
tests/domain.test.ts
tests/e2e/workbench.spec.ts
tsconfig.json
vite.config.ts
vitest.config.ts
```

`node_modules`, `dist`, compiler caches, browser traces, failed-run artifacts, environment files, and logs are ignored and excluded from the commit. Screenshots are intentional documentation evidence. The MIT copyright is Zaheer Miah; the local commit author is `EdgeFlowAI <edgeflowai@proton.me>`.

## Remaining limits and blockers

**No genuine local completion blockers remain.** Synthetic execution assumptions, admission-only risk caps, bounded histories, single-tab storage behavior, a small crash-time persistence window, and lack of a PWA navigation cache are documented in the README. No broker integration, real account, API credentials, cloud resources, remote creation, push, or publication was used. Optional AWS hosting is documentation only. Hosted CI and deployment remain unrun and unauthorized.
