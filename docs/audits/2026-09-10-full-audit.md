# Font Buttler — full application audit, 10 September 2026

**The current working tree is not ready to ship.** Opening Settings crashes the renderer, the production build fails, and several font operations violate retention, project-pin, or Undo guarantees. This audit confirmed **13 behavioral defects: five P1 and eight P2**, plus an independent TypeScript error documented under validation.

Reviewed the working tree based on commit `8595c52`, including its existing uncommitted changes. Application source files were not changed. The earlier audit and its fixes were preserved. New files contain only this report and reproduction evidence.

**Remediation update — 10 September 2026.** The confirmed findings in this snapshot have now been addressed in the working tree. The production build passes, the full serialized suite passes with 652 tests and one platform skip, and the focused reproductions now preserve parked copies, Undo state, project pins, retail restart linkage, and partial batch feedback.

P1 means address before shipping; P2 means fix in the next normal cycle. These are reproducible behavior findings, not a count of lint warnings or hypothetical exploits.

| # | Priority | Confirmed problem |
| --- | --- | --- |
| 1 | P1 | Opening Settings blanks the entire app |
| 2 | P1 | Installing another file with the same basename deletes a parked copy |
| 3 | P1 | Undo of “Install as…” creates two installed copies with the original identity |
| 4 | P1 | Retail sync replaces an actively pinned version and leaves its recorded fingerprint unchanged |
| 5 | P1 | Retail sync can reinstall a font after a concurrent uninstall succeeds |
| 6 | P2 | Adobe removal failures are reported as successful uninstallations |
| 7 | P2 | Undo of an import-plan Switch leaves neither version active |
| 8 | P2 | Interrupted retail sync leaves duplicate, disconnected catalog records after restart |
| 9 | P2 | An explicit Mac destination on a watch folder loses to the global Adobe default |
| 10 | P2 | Adobe-only Tester preview cannot use the retained installed font |
| 11 | P2 | Selection-level batch actions discard partial-failure results |
| 12 | P2 | Updating a deactivated retail font changes its state to Not installed |
| 13 | P2 | Live watch-folder discovery ignores WOFF files that its initial scan accepts |

**1. P1 — Opening Settings crashes the renderer**

Open the app and click Settings. In the isolated browser instance, the complete application tree disappeared. The console reported `ReferenceError: LATIN_PREVIEW_PRESETS is not defined` in `LatinPreviewRow`.

[SettingsDialog.tsx:740](/Users/danielquisek/git/font-butler/src/components/SettingsDialog.tsx:740) uses `LATIN_PREVIEW_PRESETS` without importing it. The same component also references missing `LATIN_PREVIEW_MAX_LENGTH` and `normalizeLatinPreviewCustom` symbols. TypeScript reports five errors for these references. There is no renderer error boundary containing this failure.

Restore the missing imports and verify that Settings opens, preset selection works, and custom preview text can be saved. A renderer smoke check opening Settings would catch the failure that the library-unit tests currently miss.

**2. P1 — A filename collision deletes a deactivated copy**

Install `a/Regular.ttf`, update it, and deactivate it. Then import and install `b/Regular.ttf`. The first font's retained destination is still named `Regular.ttf`, even though its bytes are parked elsewhere. The second install treats that stale destination record as an occupying font: the first entry changes from `deactivated` to `uninstalled`, and its parked path is cleared. Restoring its prior revision then fails because the second copy is active.

[service-lifecycle.ts:120](/Users/danielquisek/git/font-butler/core/service-lifecycle.ts:120) obtains destination conflicts through `occupantsAtPath`, which includes a deactivated entry's old `installedPath`. [The conflict remover](/Users/danielquisek/git/font-butler/core/service.ts:2624) calls the full uninstall path, which [deletes the parked file](/Users/danielquisek/git/font-butler/core/service-lifecycle.ts:403). A parked font should not be uninstalled simply because a new file reuses its former destination name.

Distinguish actual live occupancy from remembered destinations, preserve parked bytes, and allocate or reclaim live paths without uninstalling inactive records. The existing `restoring an inactive alternative cannot overwrite its active sibling` test fails consistently on this sequence. See [parked-collision.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/parked-collision.log).

**3. P1 — Undo of “Install as…” installs the original identity twice**

Install `Original-Regular`, use “Install as…” to create `Renamed`, then Undo that install action. Undo reports one success and zero failures, but both installed files now contain `Original-Regular`. The renamed entry has been changed into another copy of the original instead of being removed.

[service.ts:746](/Users/danielquisek/git/font-butler/core/service.ts:746) captures the original entry's previous revision before the renamed entry is created, then [attaches it to the new entry's operation item](/Users/danielquisek/git/font-butler/core/service.ts:756). [Undo](/Users/danielquisek/git/font-butler/core/service.ts:2091) consequently restores those original bytes into the renamed entry. Its pre-restore identity differs from the original, so the existing sibling check does not prevent the resulting duplicate identity.

Record a new renamed installation as a new asset with no previous installation to restore. Validate the staged revision's identity before restoring it into any entry. See the parsed identities of both resulting files in [undo-install-as.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/undo-install-as.log).

**4. P1 — Retail sync bypasses active project pins and leaves stale fingerprints**

Install a retail font, pin version 1 in an active project, and sync a manifest containing version 2. Sync succeeds with no error, the installed bytes change to version 2, and the project's pin remains version 1. The entry's `installedFingerprint` also remains version 1, concealing the actual byte change from consumers that trust the catalog.

[service-retail.ts:374](/Users/danielquisek/git/font-butler/core/service-retail.ts:374) writes through the retail installer without the service's active-project-pin checks or revision lifecycle. [catalogRetailWrites](/Users/danielquisek/git/font-butler/core/service-retail.ts:282) refreshes names and paths but does not refresh the installed content fingerprint.

Validate the exact incoming bytes against active pins, retain the outgoing revision, and update catalog fingerprints in the same durable mutation as the file replacement. [retail-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/retail-flows.log) records different actual and catalog fingerprints while the pin is still active. Native CoreText effects were mocked; replacement of the on-disk bytes was real inside the temporary library.

**5. P1 — A concurrent retail download can undo a successful uninstall**

Start a retail update and delay its download. Uninstall that retail entry while the download is pending. The uninstall succeeds and reports `uninstalled`; after the download completes, sync writes the file back and returns the entry to `installed` without an error.

[service.ts:2260](/Users/danielquisek/git/font-butler/core/service.ts:2260) runs retail sync outside `runCatalogTask`, while [retail-apply.ts:91](/Users/danielquisek/git/font-butler/core/retail-apply.ts:91) decides the destination before awaiting the download. The stale decision survives the user's intervening mutation.

Download outside the catalog lock if needed, then reacquire serialization and revalidate the entry's state and intended destination immediately before committing. A delayed-download reproduction is recorded as `RACE` in [retail-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/retail-flows.log).

**6. P2 — Failed Adobe removal is reported as success**

Install a font only to the Adobe destination, then make removal fail with an I/O or permission error. An injected `EACCES` left the Adobe file present, but uninstall returned `uninstalled`, cleared `installations`, and added a successful Activity record. The app loses its managed reference to a font that remains in the destination.

[removeAdobeCopy](/Users/danielquisek/git/font-butler/core/service-destinations.ts:138) catches every removal error and unconditionally drops the destination record. Ignore only an already-missing file; propagate other failures and retain the record until absence has been verified. See `failed Adobe unlink` in [core-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/core-flows.log).

**7. P2 — Undo of an import-plan Switch does not reactivate the previous copy**

Install version 1, import another same-identity version, choose Switch in the import plan, then Undo the resulting Activity item. The incoming version becomes uninstalled and the original stays deactivated. Undo reports success even though the original working state has not been restored.

[applyPlan](/Users/danielquisek/git/font-butler/core/service.ts:1700) performs the switch but records a generic `apply-plan` item. Its operation data does not carry the displaced entry needed by the switch inverse. [Undo's generic apply-plan branch](/Users/danielquisek/git/font-butler/core/service.ts:2091) therefore uninstalls the incoming entry rather than switching back.

Record the applied choice and related entry, and execute the appropriate inverse for that choice. Verify that Undo restores the original installed bytes and destination state. See `switch-plan undo` in [core-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/core-flows.log).

**8. P2 — Interrupted retail sync disconnects listings from installed files**

Sync five distinct synthetic fonts and terminate the worker process after the first four have committed, before the fifth download completes. Start a fresh service with `init()` and resume sync. The four files are adopted as ordinary installed records, while their retail listings remain separate records with `uninstalled` status and empty paths. The resumed sync reports zero pending changes and no error. The fifth font is cataloged normally.

[retail-apply.ts:203](/Users/danielquisek/git/font-butler/core/retail-apply.ts:203) persists successful manifest batches before [service-retail.ts:386](/Users/danielquisek/git/font-butler/core/service-retail.ts:386) updates the catalog after the entire run. A restart adopts committed files, but the empty retail stubs have no PostScript identity or installed path to match. Because the manifest already reports those files as current, resuming sync does not repair their retail records.

Persist catalog linkage with each committed batch, or reconcile manifest destinations with retail entries during recovery. The reproduction includes an actual child-process exit and full service initialization, not merely another call to sync. See [retail-restart.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/retail-restart.log).

**9. P2 — Explicit Mac folder destination is ignored**

Set the global destination to Adobe and explicitly configure a watch folder with destination `macos`. Import and install a new font owned by that folder. Its installation is created at Adobe despite the folder's explicit setting.

[defaultDestinationFor](/Users/danielquisek/git/font-butler/core/service-destinations.ts:73) uses a folder destination only when it is not `macos`; it treats explicit Mac selection as though it meant inheritance. Represent inheritance separately or honor every explicit destination. The reproduction records `folder: macos`, `global: adobe-shared`, and `destinations: [adobe-shared]` in [core-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/core-flows.log).

**10. P2 — Adobe-only Tester uses the source instead of the installed copy**

Install only to Adobe, remove the separate source, and open Tester. The card continues to preview the retained font and the inspector says Installed, but Tester labels the font Source and stays at “Loading preview.” This was verified in the isolated browser after waiting through subsequent audit work.

[SpecimenWorkspace.tsx:254](/Users/danielquisek/git/font-butler/src/components/SpecimenWorkspace.tsx:254) selects the displayed CSS family using only the legacy Mac `installedPath`. Adobe-only entries store their installed file in `installations`, so Tester chooses the unavailable source family even though its metadata request already uses the managed-install resolver.

Use the same destination-aware decision for the displayed family, metadata, and label. Verify active and parked Adobe-only installations with and without their original source. The earlier audit's backend preview fix passes, but it does not cover this renderer selection.

**11. P2 — Selection-level batch feedback hides partial failures**

Run the actual `installSelected` action with a backend result containing one success, one failure, and the failed ID. The observed toast is just `Installed Batch Audit` with an Activity action. It contains no failed count or Retry action.

[useFontActions.ts:328](/Users/danielquisek/git/font-butler/src/hooks/useFontActions.ts:328) awaits the result but discards it, so [run's result formatter](/Users/danielquisek/git/font-butler/src/hooks/useFontActions.ts:686) receives `undefined`. Similar loops appear in selection-level reinstall, activation, and retry orchestration. The backend and Activity can now record partial results correctly; the renderer loses them at aggregation.

Aggregate per-family outcomes, preserve failed IDs, and pass the combined result into `run`. The direct action reproduction uses mocked API responses and the real hook/formatter/toast path; see [batch-ui.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/batch-ui.log).

**12. P2 — Retail updates turn deactivated fonts into Not installed**

Deactivate a retail font and sync a newer version. The updater correctly writes into the disabled vault, but the catalog changes from `deactivated` to `uninstalled` and clears the remembered live destination. The disabled file still exists.

[service-retail.ts:304](/Users/danielquisek/git/font-butler/core/service-retail.ts:304) uses the same `parked` flag for an intentionally deactivated installation and an uninstalled cache download. Both cases become `uninstalled`. The destination resolver subsequently treats the latter state as a cache-only font.

Carry the destination's actual role through the write result and preserve deactivation state and installation metadata when updating a retained disabled copy. See `DEACTIVATED` in [retail-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/retail-flows.log).

**13. P2 — Live watch discovery omits supported web previews**

Create a TTF and WOFF in a watched directory after watching begins. The live callback reports the TTF only, while `listInboxFontFiles` includes both files. Web fonts can therefore appear after an initial scan or restart but are missed when added during a running session.

[watch.ts:464](/Users/danielquisek/git/font-butler/core/watch.ts:464) filters events through `isFontFile`, which excludes web fonts, while the discovery/import path accepts previewable web formats. Use the same preview eligibility for initial and live discovery, keeping web fonts preview-only. The polling-backed live watcher reproduction is recorded as `live web` in [core-flows.log](/Users/danielquisek/git/font-butler/docs/audits/2026-09-10-full-evidence/core-flows.log).

**Validation and coverage**

| Check | Result |
| --- | --- |
| Production build | Failed: five missing-symbol errors in Settings and one independent type error in `group.ts` |
| Main test suite via Node + tsx loader | 656 reported tests: 650 passed, 5 failed, 1 skipped |
| Focused rerun with filesystem polling | 40 tests: 39 passed, 1 failed; the parked-copy regression persists |
| Earlier audit regression harness | All 11 corrected-behavior checks passed |
| Lint before adding audit artifacts | Exit 0, 42 warnings |
| Production dependency advisory scan | `npm audit --omit=dev --json`: zero known advisories reported |
| Isolated renderer | Verified empty library, onboarding dismissal, seeded cards, keyboard inspector opening, Details, Tester, Glyphs, Settings crash, Adobe-only preview failure |

The separate build error at [group.ts:226](/Users/danielquisek/git/font-butler/src/lib/group.ts:226) passes an object with optional `entries` to a helper requiring `entries`. Checking the property does not narrow the containing object's declared type. Construct the required shape or narrow the helper input. Fixing only the Settings imports will still leave the build failing.

The normal `npm test` launcher first failed because its tsx CLI could not create an IPC socket in the sandbox. Running the same tests through `node --import tsx --test` avoided that launcher issue. Four reported failures then involved asynchronous `EMFILE` watcher errors; their files passed when rerun with `CHOKIDAR_USEPOLLING=1`. The remaining failure is finding 2. Test and rerun failure excerpts are retained in the evidence directory.

The earlier audit harness validates its earlier fixes, not the newly found variants above. It was run without its optional performance benchmark. No new whole-app performance measurements are claimed here.

The review covered renderer actions and state, preview paths, HTTP authorization and path checks, Electron IPC/navigation and update handling, catalog persistence and mutation journals, installation/deactivation/uninstall/Undo, project pins, watch-folder policies, retail sync, and build configuration. Existing security and Electron tests ran as part of the suite. No additional remotely exploitable issue was confirmed in this pass.

Native font operations were mocked for mutation reproductions; all generated fonts, catalogs, caches, and Adobe paths were temporary. The user’s real font folders and running development instance were not changed. Actual CoreText registration, behavior in Adobe/Office applications, signed-app notifications, Finder associations, and packaged distribution were not exercised end to end. The broken build prevents a current production package check. The advisory scan covers npm production dependencies, not the Electron runtime classified under devDependencies or bundled Python packages.

**Reproducing the evidence**

Run from the repository root with the existing Node dependencies and Python fonttools available. These scripts print observed defects; they are audit probes, not passing regression tests. Every filesystem mutation is in a temporary library, except writing this audit's output files. The retail scripts use injected manifest/download functions and a dummy token; they do not contact the retail service.

```sh
CHOKIDAR_USEPOLLING=1 FONT_BUTLER_TEST=1 node --import tsx docs/audits/2026-09-10-full-evidence/undo-install-as.mts
CHOKIDAR_USEPOLLING=1 FONT_BUTLER_TEST=1 node --import tsx docs/audits/2026-09-10-full-evidence/parked-collision.mts
CHOKIDAR_USEPOLLING=1 FONT_BUTLER_TEST=1 node --import tsx docs/audits/2026-09-10-full-evidence/core-flows.mts
CHOKIDAR_USEPOLLING=1 FONT_BUTLER_TEST=1 node --import tsx docs/audits/2026-09-10-full-evidence/retail-flows.mts
CHOKIDAR_USEPOLLING=1 FONT_BUTLER_TEST=1 node --import tsx docs/audits/2026-09-10-full-evidence/retail-restart.mts
FONT_BUTLER_TEST=1 TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx docs/audits/2026-09-10-full-evidence/batch-ui.mts
```

The build, lint, dependency scan, earlier regression outputs, focused reproduction logs, and main test/rerun summaries are retained alongside these probes. Fix the build and renderer crash first, then the five P1 behavior failures, then the P2 lifecycle and feedback inconsistencies. Convert the observed outcomes into assertions for corrected behavior as each fix is implemented.
