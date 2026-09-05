# Font Buttler — agent audit brief

Audit date: 2026-09-05. Baseline: `76e243a00fef77f0be792c54e4b33eb2bba2a243`.

Improve file safety and consistency across imports, installation, watching, and UI actions. Address the P1 findings first, with focused regression tests, then the P2 workflow defects. Preserve source tracking, protected-font restrictions, and the separate-copy behavior of “Install as…”. This audit changes no application code.

**Validation and limits**

- Production build passed. Lint exited successfully with 17 warnings.
- Existing suite: **165 passed, 2 skipped, 0 failed**, using Node 24.4.0, `tsx`, and an audit-only platform shim to disable native macOS font/cache operations. The skipped tests depend on unavailable Booton fonts.
- `npm audit --json` reported zero known vulnerabilities in the installed dependency tree.
- Service reproductions used temporary font directories. The concurrency reproduction replaced native command execution with a delayed stub. UI checks used an isolated production build in a browser.
- Real Core Text activation, Finder integration, notifications, signing/notarization, and packaged DMG behavior remain unverified. A `FONT_BUTLER_DATA` override alone does **not** isolate macOS installs: `getPaths()` still uses the real user Fonts directory, and cache helpers independently resolve the real home directory.

**Prioritized findings**

1. **P1 — Failed replacement can remove a working font. Reproduced.**

   [Single reinstall](/Users/daniel/git/font-butler/core/service.ts:1075), [batch reinstall](/Users/daniel/git/font-butler/core/service.ts:571), and [format replacement](/Users/daniel/git/font-butler/core/service.ts:826) remove existing copies before validating the replacement. Install an external source, delete that source, and reinstall: the operation reports “The source file is missing,” but the installed file is already gone. Replacing the source with `not a font` instead returns `installed` and installs those bytes.

   Stage and parse the complete incoming file before changing the working copy; retain a rollback copy until installation and catalog persistence succeed. Share this implementation across single, batch, automatic, and format-replacement paths. Acceptance: missing/corrupt sources, copy failures, and activation failures preserve the previous bytes and accurate catalog state.

2. **P1 — Deactivating a computer font loses its recovery record and can overwrite another font. Reproduced.**

   [deactivateSystem](/Users/daniel/git/font-butler/core/service.ts:734) moves an unmanaged font to `Disabled/<basename>` without creating a catalog entry. It disappears from both views and remains absent after initialization. Deactivating two different files named `Same.ttf` leaves one disabled file; the first file’s bytes are lost.

   Persist the original path and deactivation state, use collision-proof storage, and expose reactivation. Prefer a consistent activation model across user and computer fonts. Acceptance: both same-named files survive, remain visible after restart, and can be independently restored.

3. **P1 — Cross-format imports bypass replacement safeguards. Reproduced with genuine TTF and CFF OTF fixtures.**

   [Import identity matching](/Users/daniel/git/font-butler/core/service.ts:1197) matches PostScript names without considering format, then overwrites the entry’s source and format. Import/install `Face.ttf`, then import `Face.otf` with the same face identity: both imports return the same ID and the catalog contains one entry. Installing without `replace: true` overwrites the existing `.ttf` path with `OTTO` bytes.

   Preserve distinct format alternatives and distinguish source identity from installed-copy identity. Apply this policy to adoption too. Acceptance: the existing installation remains unchanged until explicit replacement, the conflict reaches the UI, and the destination extension matches the installed format.

4. **P1 — Watcher writes can overwrite concurrent catalog changes. Reproduced.**

   [refreshStatus](/Users/daniel/git/font-butler/core/watch.ts:25) saves the whole catalog outside [runCatalogTask](/Users/daniel/git/font-butler/core/catalog.ts:22). Reproduction: install A and B, delay A’s native deactivation command, and change B’s source during the delay. B emits `outdated`, then A’s stale catalog save resets B to `installed`.

   Route every catalog read/modify/write through the same serialized transaction boundary. Avoid nested queue waits and emit only committed snapshots. Acceptance: source changes during delayed install/deactivate/uninstall operations survive, and automatic reinstall sees the correct final state.

5. **P1 — HTTP bootstrap trusts arbitrary hostnames. Server-side behavior reproduced; browser exploit untested.**

   [API middleware and bootstrap](/Users/daniel/git/font-butler/server/index.ts:68) allow all GET requests and return the mutation token without validating Host or Origin. An isolated request with `Host: untrusted.example` returned the token; a subsequent settings POST with that host, its Origin, and the returned token succeeded. This supplies the server-side conditions for DNS rebinding; browser local-network protections may affect exploitability.

   Validate the bound loopback authority on all routes and permit only explicit application origins for browser requests, including development mode. Consider providing desktop credentials through the preload bridge. Acceptance: untrusted hosts/origins cannot bootstrap, read catalog/font data, or mutate state; packaged and development clients still work.

6. **P2 — Static-file containment accepts sibling directories. Reproduced over HTTP.**

   [mountStatic](/Users/daniel/git/font-butler/server/index.ts:38) checks `candidate.startsWith(root)`. With a static root named `static`, requesting `/..%2Fstatic-private/probe.txt` returned a dummy file from its sibling directory with HTTP 200.

   Validate decoded paths with segment-aware containment and realpath checks; reject malformed encodings and symlink escapes. Acceptance: traversal into prefix-sharing siblings and external symlink targets is denied while normal assets load. The demonstrated exposure is this containment bypass, not unrestricted access to every filesystem path.

7. **P2 — Restored source files stay missing. Reproduced.**

   [Source watcher subscriptions](/Users/daniel/git/font-butler/core/watch.ts:77) handle `change` and `unlink` but omit `add`. Import a source outside a watch folder, delete it, then recreate it: the file exists while its entry remains `source-missing` with `sourcePresent: false`.

   Handle reappearance through the serialized status reconciliation path and reconcile after watcher setup. Acceptance: delete/restore, initially missing sources, and editor saves that replace files recover without restarting; retained installed copies get the appropriate update status.

8. **P2 — Same-named uploads can overwrite each other. Reproduced.**

   [Upload naming](/Users/daniel/git/font-butler/core/service.ts:394) uses `Date.now()` plus a sanitized basename. Two `Face.ttf` uploads in one millisecond share a destination. With the clock fixed, uploading Regular and Bold returned the same ID twice and retained only Bold. Sanitization can also make different names collide.

   Use unique per-upload names and exclusive creation, then remove rejected temporary files. Acceptance: same-basename and same-sanitized-name files in one request retain distinct bytes and correct entries regardless of clock resolution.

9. **P2 — Live updates leave font metadata and preview resources stale. Metadata failure reproduced; preview issue established by code review.**

   [Watcher refresh](/Users/daniel/git/font-butler/core/watch.ts:37) updates statistics but does not parse metadata, and [installation](/Users/daniel/git/font-butler/core/service.ts:873) does not refresh faces. Overwrite an installed Regular source with Bold and reinstall: the catalog still says Regular. [FontFaceStyles](/Users/daniel/git/font-butler/src/components/FontFaceStyles.tsx:31) also keeps the same URL and CSS when installed bytes change.

   Refresh metadata from the validated staged file and version preview resources by the installed revision. Acceptance: family/style/instances and glyph previews update during the same session, including glyph-only changes, without falsely displaying uninstalled source revisions.

10. **P2 — Deselecting the last family leaves it selected. Reproduced in the browser.**

    [Selection handlers](/Users/daniel/git/font-butler/src/App.tsx:486) keep `selectedFamily`/`selectedSystem` set even when the selected-key list becomes empty. [Action selection](/Users/daniel/git/font-butler/src/App.tsx:523) reconstructs the selection from that value. Click one family, then Command-click it: “1 font selected” and its action bar remain.

    Separate focus/inspection from selection and make the selected-key list authoritative. Acceptance: toggling the final item off clears selection and destructive action targets in both library and system views.

11. **P2 — Search filtering breaks update navigation and tray actions. Navigation reproduced; tray path reviewed.**

    [updateGroups](/Users/daniel/git/font-butler/src/App.tsx:354) contains search-filtered results. The [empty-updates effect](/Users/daniel/git/font-butler/src/App.tsx:407) and [tray reinstall handler](/Users/daniel/git/font-butler/src/App.tsx:895) incorrectly use that list as the full update inventory. With Inter outdated, search “IBM” and click Updates: the app immediately returns to Fonts. Tray IDs excluded by the query are also treated as having no updates.

    Maintain an unfiltered update inventory; apply search only to displayed rows. Acceptance: an empty search result stays on Updates with an appropriate message, and tray reinstall acts on its supplied IDs regardless of the renderer query.

12. **P2 — “Allow notifications” never delivers native notifications. Code review confirmed.**

    [The setting](/Users/daniel/git/font-butler/src/components/SettingsDialog.tsx:460) and onboarding request permission and persist `nativeNotifications`, but neither renderer event handling nor the Electron main process uses it to dispatch notifications. There is no native notification creation path.

    Deliver install/update notifications from the desktop event consumer, honor the preference, and deduplicate related events. Acceptance: an update while the window is hidden produces one notification when enabled and none when disabled; permission denial leaves the UI accurate.

**Further changes for the implementation agent**

- Add an injectable native-font/cache adapter and an explicit `npm test` command plus CI. Existing portable tests do not establish that macOS deactivation works. [setFontEnabled](/Users/daniel/git/font-butler/core/caches.ts:303) currently swallows native failures while callers persist success; return a verifiable result and test failure handling.
- Use entry-level eligibility for family actions. A family containing installed and uninstalled styles gets one aggregate status, but deactivate/reinstall handlers send all IDs. Test mixed states and define partial-batch results. [run](/Users/daniel/git/font-butler/src/App.tsx:1029) should refresh committed state on failure as well as success.
- Check and display `/api/open` errors in [openFont](/Users/daniel/git/font-butler/electron/main.mjs:134). HTTP 400 currently resolves `fetch` and is silently ignored, including unsupported web-font files associated with the app.
- After behavior is protected by tests, split the 2,377-line App into selection, import/update orchestration, and view components; split the 1,633-line service around transactions, native operations, and watcher ownership. Share API types and format-conflict rules instead of duplicating them. Profile large libraries before choosing virtualization or background parsing; the system list currently stops at 80 families unless searched.

**Delivery expectations**

Implement focused changes in priority order and document each regression test. Use generated fonts and temporary paths for portable tests; add a separate macOS integration run for activation/deactivation, rollback, notifications, and packaged startup. Finish with build, lint, the full portable suite, targeted native results, and any remaining limitations. Do not count a successful catalog write as proof that macOS accepted the font operation.

**Product proposals — functionality and behavior**

The recommended direction is dependable management of fonts that change frequently. These are proposed additions to scope; implement them when selected for a release. The first product increment should cover source recovery, folder policies, and undo after the file-safety fixes above.

1. **Recover moved sources and explain the font’s state.** Show installation and source state independently: “Installed · Source missing,” “Deactivated · Update available,” or “Installed · No source linked.” An adopted font with no linked source should not say that its source disappeared. Add “Locate source…” and “Relink folder…” with identity checks and a preview of ambiguous matches. Distinguish an unavailable external volume from a confirmed missing file. Acceptance: moving a project folder preserves font IDs, installed copies, and collection membership when relinked.

2. **Give every watched folder its own policy.** Offer “Add to library,” “Install new fonts,” and “Install new fonts and updates,” plus Pause, exclusions, and per-font update overrides. Choose the policy before the initial scan. This also corrects the current onboarding order: folders are saved before the installs step, while automatic installation defaults to enabled. Preserve intentional deactivation when a source changes. Acceptance: one export folder can update automatically while another only collects fonts; adding a folder never installs before its policy is chosen.

3. **Add activity history, Undo, and version rollback.** Record what changed, why (drop, watch folder, manual action), and which files succeeded or failed. Keep at least the previous installed revision within a bounded storage budget. Provide “Restore previous version” and undo for reversible install/deactivate actions. Restoring a previous version should pause automatic updating for that font until the user resumes it. Acceptance: a bad export can be rolled back after restarting the app without changing the external source.

4. **Make previews useful for real decisions.** Replace the fixed specimen sentence with editable, remembered text and size controls. Add a comparison view for two selected families or the installed and incoming versions. Follow with variable-font axes and OpenType feature controls derived from actual font metadata. Show missing characters explicitly. Acceptance: users can compare their own headline or paragraph before installing, and named instances use their actual axis coordinates.

5. **Handle import conflicts per font.** Preserve quick imports for ordinary files and show a review when duplicates, conflicting names, or incompatible alternatives require a decision. Distinguish identical bytes, a changed version, and another format. A TTF/OTF preference should resolve alternatives for the same face; it should not discard unrelated families merely because a mixed drop contains multiple formats. Offer “Keep installed,” “Replace,” and “Install as…” with an exact affected-file summary. Acceptance: a unique TTF and a unique OTF both import; only a conflicting alternative needs a choice.

6. **Make actions explicit about scope and outcome.** Use “Install update” for an available source change and reserve “Reinstall” for repair. A selected style’s inspector should act on that style; family actions should say “Install missing styles” or “Deactivate 3 styles.” Keep source deletion in an explicit secondary action. Batch results should report “8 installed, 2 failed” and let users retry failures. Provide cache repair with a visible result instead of presenting cache clearing as proof that a font is now usable.

7. **Add project sets.** Let a project reference families across multiple source folders, with optional pinned revisions and one action to activate its fonts. Start with manual sets; add saved filters later. Track fonts shared with other active sets so closing one project does not disable another project’s fonts. Acceptance: collections reference existing fonts without duplicating files, and project deactivation preserves independently active fonts.

8. **Explore a dedicated font-testing workflow after the core improvements.** Permit WOFF/WOFF2 preview with installation actions unavailable, and investigate an Adobe-specific testing destination. Glyphs documents a folder-based Adobe testing workflow and its conflict considerations; treat it as a candidate to validate against supported Adobe versions before implementation. [Glyphs: testing fonts in Adobe apps](https://glyphsapp.com/learn/testing-your-fonts-in-adobe-apps). Keep destination choice explicit and report which copy the app manages.
