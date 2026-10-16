# Session replacement confirmation: independent reQA handoff

Base commit: `ae8511ce1e814cef6c872736feb563174a495019`.

This repair addresses the confirmed destructive-replacement issue only. Valid CSV import and **Load seed & reset** now require confirmation before replacing an altered session. The execution/accounting engine, chart, persistence format, dependencies, normal Reset confirmation, and existing workspace layout remain unchanged. The only CSS addition scopes wrapping to the new confirmation's buttons.

## Behavior and preservation contract

- CSV is fully validated before staging a replacement. Invalid CSV or seed input reports an error without dispatching an account transition. A slow file read holds replay ticks and rejects queued domain actions until validation completes.
- An altered session includes order/journal history, completed or cancelled orders with zero current positions, changed cash/basis/realized P&L, replay progress, a running replay, changed speed, an imported dataset, or a nondefault seed. Only the untouched default desk may replace directly.
- The native modal has an accessible name and description. **Keep current session** receives initial focus. Enter on that initial focus cancels; Escape cancels. Keyboard Tab reaches the explicit destructive acceptance button. Native modal behavior makes the underlying desk inert and restores focus on close.
- Pending replacement data and validation flags are transient. The existing domain state object and its serialized envelope are retained unchanged while waiting and after cancellation. Replay holds without flipping its running flag; cancellation resumes an already-running replay. Previous validation messages and form drafts also survive cancellation.
- Acceptance applies the existing domain replacement transition once: dataset, source/seed, cursor/start, replay speed/running flag, cash, basis, realized P&L, orders, positions, and journal reset together. Existing persistence saves only that accepted current state. The browser tests verify the accepted replacement after reload using the unchanged debounced-save/page-exit persistence path.
- Normal **Reset** keeps its existing confirmation and tape-preserving semantics.

## Actual local gates

The full run completed successfully with existing laptop tooling and one browser worker. No install, dependency change, provider/settings change, system restart, remote, push, deployment, or publication was performed.

| Command             | Completed result                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm test`          | **76 passed**, 2 files, 953 ms total; original 59 plus 17 focused replacement cases                                |
| `npm run lint`      | Passed with `--max-warnings 0`                                                                                     |
| `npm run typecheck` | Passed                                                                                                             |
| `npm run build`     | Passed; 34 modules, 1.18 s                                                                                         |
| `npm run test:e2e`  | **18 passed**, 1 worker, no retries, reported duration **1.3 minutes**; original 10 plus 8 replacement regressions |

The earlier focused browser run also passed all 8 replacement regressions before the full run. Formatting used the already-cached formatter with `npm exec --offline`; no global installation or dependency update was made. Tooling's `NO_COLOR` / `FORCE_COLOR` notices did not cause test failures. No dependency audit or the independent 19,200-transition probe is claimed as a new run; dependency files and the accounting engine did not change. Hosted CI was not run.

Unit regressions cover staging, exact state identity and serialized-state preservation, cancellation, atomic acceptance and persistence reconstruction for both replacement types; closed/cancelled history and other alteration detection; queued-action blocking; invalid input; pristine direct replacement; and unchanged normal reset behavior.

Each browser viewport (**1440×900**, **390×844**) runs four new regressions:

1. Import: populated position plus open order and execution history; initial safe focus; Enter cancel; Escape cancel; exact main text, control values and stored-byte preservation; keyboard acceptance; consistent reset dataset/account; immediate reload persistence.
2. Seed: the same cancellation, acceptance and reload checks, including focus restoration to **Load seed & reset**.
3. Completed buy/sell trades returning cash and positions to initial values still trigger both confirmations. Cancelling the normal Reset dialog still preserves the account.
4. Invalid CSV/seed does not replace or persist an altered account; pre-existing validation messages survive cancellation; a deliberately delayed file read and an open confirmation hold a running replay beyond a tick interval; Escape retains its running flag and replay resumes.

## Actual screenshot evidence

Captured by Playwright during the full passing run. Confirmation captures show the focused safe action; accepted captures show the fresh account after reload. Desktop seed and mobile import confirmation layouts were visually checked, with all controls visible and no clipping. The tests also assert no viewport horizontal overflow.

| Viewport / replacement | Confirmation                                                                                 | Accepted and reloaded                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Desktop import         | [repair-desktop-import-confirmation.png](screenshots/repair-desktop-import-confirmation.png) | [repair-desktop-import-accepted.png](screenshots/repair-desktop-import-accepted.png) |
| Desktop seed           | [repair-desktop-seed-confirmation.png](screenshots/repair-desktop-seed-confirmation.png)     | [repair-desktop-seed-accepted.png](screenshots/repair-desktop-seed-accepted.png)     |
| Mobile import          | [repair-mobile-import-confirmation.png](screenshots/repair-mobile-import-confirmation.png)   | [repair-mobile-import-accepted.png](screenshots/repair-mobile-import-accepted.png)   |
| Mobile seed            | [repair-mobile-seed-confirmation.png](screenshots/repair-mobile-seed-confirmation.png)       | [repair-mobile-seed-accepted.png](screenshots/repair-mobile-seed-accepted.png)       |

## Exact changed files

```text
docs/QA-REPAIR.md
docs/VERIFICATION.md
docs/screenshots/repair-desktop-import-accepted.png
docs/screenshots/repair-desktop-import-confirmation.png
docs/screenshots/repair-desktop-seed-accepted.png
docs/screenshots/repair-desktop-seed-confirmation.png
docs/screenshots/repair-mobile-import-accepted.png
docs/screenshots/repair-mobile-import-confirmation.png
docs/screenshots/repair-mobile-seed-accepted.png
docs/screenshots/repair-mobile-seed-confirmation.png
src/App.tsx
src/replacement.ts
src/styles.css
tests/e2e/replacement.spec.ts
tests/e2e/workbench.spec.ts
tests/replacement.test.ts
```

The local username/checkout path in `docs/VERIFICATION.md` was replaced with a generic example. Original screenshots remain unchanged. Build output, dependencies, and browser artifacts remain ignored.

**No known local repair blocker remains. Independent reQA is required. No publication clearance is granted or implied.** The repaired commit and tree IDs are supplied in the handoff; obtain them locally with `git rev-parse HEAD` and `git rev-parse 'HEAD^{tree}'`.
