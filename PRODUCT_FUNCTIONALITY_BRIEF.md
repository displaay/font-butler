# Font Buttler — detailed product functionality brief

Prepared 2026-09-05. Audience: the agent implementing the next product iterations.

Specify and deliver a font manager that makes changing font files predictable: users can reconnect moved sources, control automation, inspect an incoming version, and recover a working installation. This document covers all functionality suggestions from the product review, including WOFF/WOFF2 preview and an Adobe testing destination.

This is a separate product brief. The existing [audit brief](/Users/daniel/git/font-butler/AGENT_AUDIT_BRIEF.md) remains the record of the earlier audit. The checked-out commit at preparation was `76e243a00fef77f0be792c54e4b33eb2bba2a243`, with ongoing, uncommitted audit fixes already present. Reconcile the current implementation before starting; earlier audit findings and line numbers are historical, and new helper modules are not evidence that every regression has been resolved. This brief does not claim to validate those changes.

**1. Product intent and scope**

Primary users are people who install fonts from their own folders and revisit those files: designers managing client projects, people testing new exports, and users keeping a local font library. Preserve the fast path for ordinary imports. Add explicit decisions where an action affects an existing installation, a chosen revision, or another project.

The proposed defaults below resolve routine product choices so an implementation agent can proceed. Treat them as requirements for this brief, with departures documented when platform evidence makes a different behavior necessary.

| ID | Workstream | First useful deliverable | Sequence |
| --- | --- | --- | --- |
| F01 | Source recovery and accurate state | Relink a file or moved folder; distinguish missing, offline, and unlinked sources | First increment |
| F02 | Folder automation | A policy selected before scanning, with pause and per-font overrides | First increment |
| F03 | Activity, undo, and versions | Persistent results and restoration of the previous installed revision | First increment |
| F04 | Specimen and comparison | Editable text and installed-versus-source comparison; then axes and features | Second increment |
| F05 | Import decisions | Per-font conflict planning that retains unrelated mixed-format fonts | First increment for planning; expand with F04 |
| F06 | Action behavior and feedback | Explicit style/family scope, honest partial results, and targeted retry | Across the first increment |
| F07 | Project sets | Manual sets, version pins, and activation ownership | Third increment |
| F08 | Web-font preview | Read and compare WOFF/WOFF2 with explicit preview-only capability | Third increment |
| F09 | Adobe testing destination | Compatibility investigation, then a bounded supported implementation | After destination and native-operation foundations |

Keep automatic source editing, cloud synchronization, font purchasing, and background inspection of other applications' documents outside this implementation. Project sets are manually selected; document-driven activation would require a separate specification. Font collection files remain indivisible installation units unless a future feature explicitly introduces extraction.

**2. Shared behavior and terminology**

Use independent facts for installation, source availability, and update state. Derive badges and actions from those facts instead of assigning one status that erases the others.

| Dimension | Required values or meaning |
| --- | --- |
| Installation, per destination | Not installed; installed and active; installed and deactivated; verification unavailable |
| Source availability | No source linked; present; missing; storage offline; unreadable |
| Source comparison | Current; update available; different version retained; comparison pending; invalid incoming file |
| Update policy | Inherit folder/default; manual; automatic; paused after rollback; pinned by project |
| File capabilities | Previewable, installable, renameable, and supported destinations; capability failures have reasons |

Display examples: “Installed · Source missing,” “Deactivated · Update available,” “Installed · No source linked,” and “Installed · Source drive offline.” A source that has never been linked must not be described as having disappeared. An unavailable drive must not trigger cleanup of missing sources. An invalid export must leave the existing installation usable and show a problem with the source.

“Source” means the external file the user linked. “Installed copy” means the bytes managed at a destination. “Revision” means a particular set of bytes with a content fingerprint, rather than a font's declared version string or modification time. “Family” is a display grouping; it is not a safe unique key for file operations.

For TTC/OTC files, selecting a face may change the preview, but an install or deactivate action affects the containing file. Label that scope explicitly, including other affected faces. A family containing several files may have mixed installation states; show a count such as “3 of 5 styles active,” using files or faces instead when a style count would be misleading.

**3. F01 — Source recovery and accurate state**

**Outcome.** Moving a client folder or reconnecting a drive does not require removing and reimporting fonts. Existing IDs, installed copies, retained revisions, and project references survive recovery.

**File workflow.** Expose “Locate source…” on entries with a missing source and “Link source…” on entries without a source. The native picker accepts a supported font file. Inspect the candidate and show the old path, proposed path, identity match, format, and whether its bytes differ from the installed revision. Applying a relink changes tracking only. Installation remains a separate explicit action; the relink transaction must not trigger an automatic update before the user has reviewed the result. When the relink reveals different bytes, persist a review hold until the user chooses Install update or Resume automatic updates.

Prefer an exact recorded source fingerprint when available. Otherwise compare the full face inventory and PostScript identities, format, and relevant naming metadata. A filename or family name alone is insufficient. Renamed derivatives require matching their own identity; do not silently attach their original, differently named source. A mismatched file is rejected as a relink and can be offered as a separate import.

**Folder workflow.** “Relink folder…” lets the user map an old root to a new root. First check the same relative paths; optionally search within the chosen root for unresolved files. Show a review table with Matched, Changed version, Ambiguous, and Not found. Automatically select unambiguous matches, require a choice for ambiguous candidates, and leave unresolved rows untouched. Stage the mappings and revalidate them before one catalog commit. Native picker cancellation performs no mutation.

**Storage and error behavior.** Track the linked root and, where supported, its storage identity. Distinguish an unmounted volume, denied access, a broken link, and a file confirmed absent on available storage. Recheck when storage becomes available and on a manual Refresh action. Bound searches to the folder the user selected, follow the established containment policy, and prevent directory/symlink loops. Do not scan the entire machine by default.

**Acceptance criteria.**

- F01-A: Moving a folder containing several tracked fonts and relinking its root preserves all asset IDs and installed bytes.
- F01-B: Two possible matches with the same basename require disambiguation; neither is silently adopted.
- F01-C: A changed but matching source is linked and shown as an available update without being installed by the relink action.
- F01-D: Disconnecting and reconnecting a test volume changes Offline to Present without deleting records or installing a different revision.
- F01-E: Linking a source to an adopted font does not overwrite its installed copy; a mismatched identity cannot be accepted accidentally.
- F01-F: Missing-source cleanup excludes offline and unreadable entries. A vanished candidate during Apply leaves the prior mapping recoverable and reports the affected row.

**4. F02 — Folder automation and first-run behavior**

**Outcome.** Each source folder has an understandable policy that governs both its initial discovery and future events.

| Policy | Newly discovered font | Changed source of an active installed font | Changed source of a deactivated font |
| --- | --- | --- | --- |
| Add to library | Record and preview | Show update available | Show update available; stay deactivated |
| Install new fonts | Install a valid, non-conflicting new asset | Show update available | Show update available; stay deactivated |
| Install new fonts and updates | Install a valid, non-conflicting new asset | Install after validation and recovery preparation | Show update available; stay deactivated |

Use “Add to library” as the default for a newly configured folder. Keep explicit file-drop behavior as a separate preference, preserving the existing user's setting. Previously recorded uninstalled entries are not “new”: resuming a folder, restarting, or rediscovering a file must not reinstall a font the user deliberately uninstalled.

**Setup workflow.** Choose folder → choose policy and exclusions → inspect discovery summary → Start watching. Persist the complete configuration before importing anything. Onboarding must present the install policy before its first live scan. Scanning for the summary is read-only. Show how many items will be added, installed, left unchanged, or sent for conflict review. Only perform the disclosed operations on confirmation of this configured action.

**Ongoing controls.** Each folder row shows policy, availability, and Pause/Resume. Pause stops new imports and all automatic mutations owned by that folder; it may continue read-only source observations. Existing fonts remain installed and visible. Resume reconciles current files once and applies the saved policy, without replaying every intermediate export. Exclusions initially support folder exclusions and documented relative-path patterns; apply the same rules to initial discovery and event handling. Excluding a file stops folder automation, not installation or catalog membership.

**Precedence.** Protected or unsupported operations are ineligible. Explicit deactivation/uninstallation, rollback/relink review holds, and project pins block automatic activation or replacement. A paused owner folder blocks its automation. Next use an explicit per-font Manual/Automatic override, then the owning folder policy. For tracked loose files without an owner, retain the user's global update preference. Manual commands remain available where safe and show any pin or project conflict before committing.

For overlapping watched folders, assign a newly discovered source to the most specific configured root and record that owner. Adding a parent later does not transfer existing ownership. A transfer caused by removing an owner or relinking a folder must show the replacement policy; use Manual until a replacement owner is established. Deduplicate events by asset and observed revision.

**Migration.** Convert existing watched paths into records with stable IDs. Preserve the effective old combination of install-new and auto-update settings: the internal model should retain separate booleans if necessary, since an old configuration may update existing installations without installing newly discovered files. Do not force that combination into an incompatible preset. A migration or policy edit itself must not cause a bulk reinstall. Explain preserved custom combinations in the UI.

**Acceptance criteria.**

- F02-A: An export folder can update automatically while an archive folder only collects fonts.
- F02-B: Adding a folder during onboarding causes no install before its policy and discovery plan are accepted.
- F02-C: A deactivated or deliberately uninstalled asset stays that way across edits, pause/resume, and restart.
- F02-D: Excluded paths behave identically during scans and live events; overlapping roots produce one operation per revision.
- F02-E: Resuming processes the latest valid revision once. Invalid or conflicting files become review items without damaging a working installation.
- F02-F: Existing settings migrate without lost paths, changed effective policy, or surprise installs.

**5. F03 — Activity, undo, and retained versions**

**Outcome.** Users can tell what happened and recover the previous working state after an unsuccessful export or an unintended operation.

Add an Activity view with time, action, trigger, family/file, destination, outcome, and available recovery action. Triggers include direct import, watched folder, menu-bar command, project activation, and manual repair. Group a batch into one expandable operation with per-item details. Make the entry reachable from the result toast and from the affected font. Keep activity locally; no remote analytics is required.

For each changed installation, retain the previous installed bytes and parsed metadata before replacement. Use immutable content-addressed storage to deduplicate identical revisions. The first version retains one prior installed revision per asset/destination and all explicitly pinned revisions. Recommended storage budget: 1 GiB, adjustable in Settings; recommended activity retention: 90 days or 10,000 operations, whichever limit is reached first. Expose usage and distinguish history records from retained font files.

Evict old, unreferenced extra revisions before required rollback or pinned copies. Do not silently evict a project's pinned revision. If safe staging and the required recovery snapshot cannot fit, postpone automatic updates and surface the storage issue. Manual actions can present an explicit history-retention choice, but transaction rollback must remain available until that operation commits. Garbage collection runs only after reference and transaction checks.

**Restore workflow.** Open Versions → select a retained revision → compare metadata or preview → Restore previous version. Restore only the managed installation, leaving the external source unchanged. Record the restore as a new operation, preserve the revision being replaced when storage permits, and keep the target's prior active/deactivated state. Add a persistent update hold with the label “Updates paused after restore” and an explicit Resume updates action. A source newer than the restored bytes stays visible as an available update; it is not immediately reinstalled.

**Undo rules.**

| Action | Recovery behavior |
| --- | --- |
| Install a new managed copy | Undo removes that installation; retains its library/source record and adds a hold against immediate automatic reinstall |
| Install an update or replace a format | Undo restores the exact previous revision and destination state, including displaced conflicting copies within the same transaction |
| Activate/deactivate | Undo restores the previously verified activation state |
| Uninstall a managed copy | Undo restores retained bytes when available and rechecks destination conflicts |
| Relink source | Undo restores the previous mapping if it has not since been changed; it does not move files |
| Trash an external source | Report the Trash action accurately; do not promise app Undo until the native Trash restore path is supported and tested |
| Clear caches | Report completion/failure; do not offer Undo |

Every undo verifies that the target still matches the expected post-action revision and state and rechecks current project ownership and pins. If a newer action or an external file change intervened, show a conflict and offer an explicit restore plan rather than overwriting it. Repeating the same undo request must not execute it twice. For a partially successful batch, only committed successful items are candidates for undo.

**Crash behavior.** Persist an operation journal before filesystem mutations, identify staged and recovery files, and write a terminal outcome only after catalog and native state reconcile. On startup, reconcile incomplete operations using recorded paths and fingerprints. Restore or complete each transaction deterministically and show any unresolved item in Activity. A history feature must survive app restart, not rely on a toast's lifetime.

**Acceptance criteria.**

- F03-A: Updating A to B and restoring A after restart reproduces A's exact bytes and active/deactivated state while the external source remains B.
- F03-B: Automatic updates do not undo the user's restore or reinstall a newly installed font immediately after Undo.
- F03-C: An intervening manual/external change causes a stale Undo to require a new plan; it does not overwrite silently.
- F03-D: A batch with failures records the real outcomes and only reverses completed items.
- F03-E: Crash injection before replacement, after byte replacement, and before catalog commit leaves either a verified completed operation or a usable recovery record.
- F03-F: Retention cleanup preserves referenced pins and necessary rollback files; insufficient space stops automation with an actionable explanation.

**6. F04 — Specimen workspace and comparison**

**Outcome.** Users can judge a font with their own text and compare revisions before installing.

Start with an editable specimen in the inspector and an expandable comparison view. Remember specimen text, size, line height, and selected sample locally. Provide a few editable sample presets: headline, paragraph, numerals/punctuation, and user-saved text. Do not change install state when opening a preview. Support keyboard editing, Reset, and a clear restore-default-sample action.

Offer two modes: compare selected families, and compare Installed versus Source for one asset. Show two panes initially; optionally allow up to four family panes with shared text and size. Labels identify family, face, declared version if present, source/installed role, format, and revision time. Give each rendered resource an immutable revision identity so browsers cannot show a stale face under a new label. Opening a comparison captures a consistent pair; if a new export arrives, show “A newer source is available” and a Refresh comparison action. Install from comparison must validate the reviewed revision before commit.

**Variable fonts.** Extract axis tags, names, minimum/default/maximum values, and named-instance coordinates from the font. Provide numeric input and sliders with Reset; support custom axes and names that contain no weight keywords. Selecting a named instance sets its complete coordinate map. Moving a control produces Custom. Apply explicit coordinates to the preview; do not infer them from names such as “Bold.” For optical sizing, offer an explicit automatic/manual choice when the font supports it.

**OpenType features.** Expose supported feature tags with friendly labels where known, including kerning, ligatures, and stylistic sets. Preserve font/browser defaults until the user changes a control. Feature availability may depend on script and language; unsupported options should be absent or explained. When comparing fonts with different capabilities, keep text/size linked while keeping unsupported axes or feature values independent. Do not imply that two equally named sliders represent equivalent design spaces.

**Character coverage.** Identify unsupported characters in the specimen and list the missing code points. Make fallback visible with a count or highlight, without interrupting ordinary text input. Separate character coverage from shaping/rendering errors and avoid claiming language support solely from a Unicode range. Handle combining marks, supplementary characters, and right-to-left specimens in tests.

**Acceptance criteria.**

- F04-A: A user's paragraph and size persist across selection and restart; comparing fonts does not install them.
- F04-B: Installed and Source panes display their respective retained/captured bytes, including when metadata names are unchanged.
- F04-C: A source change during comparison cannot cause “Install this version” to install unreviewed bytes.
- F04-D: A variable font with weight, width, and a custom axis renders actual named-instance coordinates and resets correctly.
- F04-E: Supported feature toggles affect the intended preview; unsupported settings do not carry misleading state into another font.
- F04-F: Missing characters are reported, collections can preview each supported face, and an unsupported collection rendering path gets an explicit fallback state.

**7. F05 — Import planning and per-font conflicts**

**Outcome.** Ordinary imports stay quick, and a conflict decision affects only the competing files it describes.

Build one import planner used by drag/drop, file picker, Finder Open With, watch folders, and later destination/project operations. Inspect supported files, read metadata, and compute fingerprints before creating an executable plan. mtime/size can be a discovery shortcut but cannot establish byte identity. Use stable plan/item IDs and expected catalog/source revisions; revalidate on apply.

| Classification | Default behavior |
| --- | --- |
| New, valid, installable face/file | Follow the applicable add/install policy |
| Identical bytes at another path | Do not duplicate installation; preserve existing source ownership and offer explicit relinking if useful |
| Same face identity and format, changed bytes | Treat as a candidate revision; replace only through the applicable update policy or review |
| Same face identity, alternative format | Show a conflict decision for that face/file |
| Same family, different style/face | Add normally; it is not a duplicate merely because the family matches |
| Partial face overlap in a collection | Review the full file-level impact and all affected faces |
| Unsupported/corrupt data | Retain successful unrelated items in the plan; explain the rejected item |
| Preview-only web font | Add to preview library with no native install operation |

When no decision is required, execute the plan and present a compact result. When decisions are required, show one review containing affected items, current and incoming versions/formats, paths, and actions: Keep installed, Replace, Install as…, or Skip incoming. Keep installed may add the alternative to the library without activating it; make this explicit. Do not silently change the tracked source to another identical copy merely because it was discovered later.

A preferred TTF/OTF format only chooses between competing alternatives for the same face. It never discards unique fonts elsewhere in the drop, never overrides a project pin, and never authorizes destructive replacement by itself. “Apply to similar conflicts” must describe the exact matching category and affected count. Background automation queues conflicts for review without opening repeated modal dialogs. Remember Keep installed and Skip decisions for the exact incoming revision and affected installation; rediscovering that unchanged conflict must not repeatedly notify the user. A new incoming revision or changed installation may require a new decision.

“Install as…” uses the existing separate-copy contract: create a derived asset, preserve the original source, record provenance, and verify that the renamed result itself introduces no new conflict. Cancellation during review leaves installations unchanged. A scan can use disposable staging files, but rejected or canceled candidates must not remain as silent orphaned catalog entries.

**Acceptance criteria.**

- F05-A: A unique TTF and a unique OTF in one drop both survive the plan and install when policy permits.
- F05-B: Identical copies at different paths create no duplicate installation and do not steal the existing source binding.
- F05-C: An alternative format requires the correct conflict decision and preserves the working copy until a validated commit.
- F05-D: A TTC containing one conflicting face lists its other affected faces; the operation never claims to replace only one face while replacing the collection.
- F05-E: A pinned revision, changed source, or modified catalog invalidates relevant stale plan items before any replacement.
- F05-F: Finder, drop, and watched-folder entry points agree on classification and outcome; one invalid item does not erase successful unrelated items.

**8. F06 — Action scope, results, and repair**

**Outcome.** An action's label predicts the objects it changes and its result reports what actually happened.

| Context | Primary action/copy | Scope |
| --- | --- | --- |
| New uninstalled file | Install | Selected asset/file |
| Source revision differs | Install update | Reviewed incoming revision at the selected destination |
| Deactivated installation | Activate | Existing installed revision; a pending source update is a separate choice |
| Partly installed family | Install missing styles / files | Eligible uninstalled members only |
| Active family selection | Deactivate N styles / files | Eligible active members only |
| Remove managed installed bytes | Uninstall | Installed copy; keep linked source and retained history according to policy |
| Stop tracking an uninstalled entry | Remove from library | Catalog membership, with a check for project references |
| Delete an external source | Move source to Trash | Explicit named source files; separate from Uninstall |
| Known installed bytes need repair | Reinstall installed version | The retained/current installed revision, unless the user separately chooses an update |

The inspector's style/file action acts on its selection. Place family-wide actions in a clearly labeled family menu. Use stable asset IDs, destination IDs, and eligibility predicates shared with the backend. For collections, show “This changes all N faces in this collection.” Keyboard shortcuts, context menus, card buttons, inspector buttons, and tray commands must use the same scope rules.

**Batch behavior.** Create an operation with a snapshot of intended targets. Continue through independent items after an item-level failure; roll back the entire tightly coupled replacement group when one of its members fails. Show progress, completed/failed/skipped counts, and expandable reasons. Cancellation stops pending work at a safe boundary and does not abandon an in-flight file replacement. Always refresh committed state after success, failure, or cancellation.

Retry failed items only, after checking their current eligibility. A retry must not install a newer source or replace another font without fresh validation. Repeated UI events, SSE reconnects, and repeated request delivery must not execute a successful item twice. Stale selections are cleared or reconciled before a destructive command targets anything.

**Repair.** Provide a Repair entry for installation verification and optional cache maintenance. Report font-operation results separately from ATS, Office, and Adobe cache results: Succeeded, Not found, Unavailable, or Failed with a useful reason. Preserve configured cache preferences during migration. A cleared cache does not establish that a font is active in another app. Explain when the user may need to relaunch an affected app; never close or relaunch their running apps automatically. Open With errors must reach a visible error state or desktop dialog rather than only console output.

**Notifications.** Use the existing preference and native-notification work where available. While the window is hidden, send one meaningful summary for a completed batch or new update batch. Deduplicate by operation/revision, not only by message text. Clicking opens the relevant Activity or Updates view using unfiltered IDs. With notifications disabled, Activity still records the event. A failed operation is never announced as successful.

**Acceptance criteria.**

- F06-A: A family with two active and one uninstalled file offers Install missing for one and Deactivate for two; each command touches only those files.
- F06-B: A selected collection face communicates its file-level action scope before that action is applied.
- F06-C: A ten-item batch with two failures reports eight successes and two failures; retry targets only the two current eligible failures.
- F06-D: Cancellation leaves completed items accurately recorded, pending items canceled, and no half-replaced file.
- F06-E: Menu, keyboard, inspector, and tray actions produce the same target set and honor pins and deactivation intent.
- F06-F: Repair, native notification, and Open With failure messages describe verified outcomes and reach the user while respecting their settings.

**9. F07 — Project sets, pins, and shared activation**

**Outcome.** A project can collect fonts across source folders, activate the versions it needs, and release its activation without disrupting other projects.

**Set workflow.** Create a named set from selected fonts or an empty set, add/remove members, and show membership in a Project section of the sidebar. Store stable asset/file references rather than copying source files into project directories. Renaming a family or relinking a source does not remove membership. An unavailable member remains visible with a recovery action. Deleting a set removes the grouping; for an active set, default to keeping its fonts active and offer a clearly described release action.

**Activation.** Before activating, plan required installs, activations, replacements, and conflicts. Show a compact summary; ordinary already-satisfied members need no work. Commit independent members with per-item outcomes. Show Active only when all requested members are satisfied; otherwise show Partially active with unmet members and Retry. Persist desired set activity and reconcile it after app restart, while reporting external changes rather than blindly reversing them.

**Ownership.** Track activation demand separately from installation state. A manually active font has a manual owner; each active set adds its own owner. Activating a set records any preexisting manual or externally established activation. Deactivating a set releases only its ownership. Disable a font only when no active set or manual owner still requires it and the app can verify the applicable state. Merely closing the app window must not deactivate sets.

When users explicitly deactivate a font that active sets require, show the affected sets and record the user's override; mark those memberships unsatisfied. Do not immediately reactivate the font through a watcher. A missing or uninstalled font similarly remains an explicit unresolved requirement until the user retries or changes the set. Unknown ownership after migration or external change should conservatively preserve activation.

**Version pins.** Pin a retained revision by fingerprint, not its declared version label. The pin must reference retrievable bytes and protects them from history eviction. Show “Pinned for Project X” and pending source revisions without automatically replacing the pin. If two active projects need different revisions of the same conflicting face at the same destination, report the conflict. Default to preserving the active installation. Offer to change/deactivate one requirement or explicitly create a separately named derivative where supported; never silently rewrite project requirements or promise both revisions can coexist.

**Saved filters.** After manual sets work, add saved library filters for source folder, installation/source state, type, and name. A live saved filter is a view. If it can be activated as a set, capture a visible member snapshot; later changes in filter results must not automatically install or deactivate additional fonts without a defined opt-in workflow.

**Acceptance criteria.**

- F07-A: A project references fonts from two folders without duplicating their source files, and membership survives relinking and restart.
- F07-B: Projects A and B share one font. Deactivating A keeps that font active for B; deactivating B still preserves any manual owner.
- F07-C: A pinned revision survives a new export and retention cleanup. An incompatible second pin is surfaced before any replacement.
- F07-D: A partial activation identifies unsatisfied members and retry does not disturb satisfied ones.
- F07-E: Explicit per-font deactivation is respected while affected project membership shows its unresolved state.
- F07-F: Deleting a set or changing a saved filter does not unexpectedly uninstall or disable fonts.

**10. F08 — WOFF/WOFF2 preview**

**Outcome.** A web-font export can be inspected and compared through the same specimen workspace while clearly remaining unavailable for native installation.

Split recognition, parsing, preview, rename, and destination-install capabilities. Accept `.woff` and `.woff2` through file picker, drop, and configured watch-folder discovery when parsing succeeds. Label them “Web font · Preview only.” Their source can be tracked and relinked; changed bytes refresh the available preview revision. Add them to the library and project sets for reference, but exclude them from activation demand and install/update counts. A project consisting entirely of preview-only assets should show “Preview set” instead of claiming native activation.

Native install, activate, and install-renamed-copy actions remain unavailable for these formats unless a separate supported capability is implemented. Do not disguise a web font by renaming its extension or silently convert it. Reject native-install API requests for preview-only data even if a caller bypasses the UI. Determine capability from parsed content as well as the extension.

Allow desktop and web variants of a related face to coexist for comparison. A preferred desktop format must not discard web previews. For Open With on a web font, open its specimen and explain its preview-only status. Preserve upload size and parser resource limits, reject malformed files, and release obsolete preview resources after use.

**Acceptance criteria.**

- F08-A: Valid WOFF and WOFF2 files load a specimen with metadata and no enabled native install action.
- F08-B: A mixed desktop/web import reports installed desktop files and added preview-only files separately.
- F08-C: Direct native-install requests for web-font bytes are rejected even with a misleading extension.
- F08-D: Updating or relinking a web source refreshes its preview without native registration or cache clearing.
- F08-E: Project activation skips preview-only members transparently; invalid or oversized web fonts report errors without corrupting the catalog.

**11. F09 — Adobe testing destination**

**Outcome.** If validated, users can choose a supported Adobe testing destination for managed font copies and understand how it differs from an installation used by macOS applications.

This workstream begins with an investigation because destination support, activation, permissions, and font precedence depend on the applications being tested. Glyphs documents shared and application-specific Adobe font-folder workflows, including conflicts and refresh limitations. That tutorial was last updated in August 2022; it is a starting point, not proof of compatibility with current app versions. [Glyphs: testing fonts in Adobe apps](https://glyphsapp.com/learn/testing-your-fonts-in-adobe-apps).

**Investigation deliverable.** Produce a matrix with tested macOS version, Adobe application/version, destination, TTF/OTF/variable-font support, refresh behavior while open, permission requirements, conflicting system-font behavior, and cleanup/rollback results. Test with generated fixtures and record both successful and unsupported cases. Do not generalize one successful application to all Adobe apps. If support cannot be established, deliver the findings and keep the destination unavailable rather than shipping a speculative writer.

**Supported implementation.** Add an explicit destination choice to relevant folder policies, import plans, and installation details. Start with one verified Adobe destination. Use a separate target adapter for discovery, capability checks, writing, verification, removal, and repair. Show whether a copy is in the macOS destination, the Adobe destination, or both. A file placed in an Adobe folder must not be represented as verified active in a particular app unless that fact can be established.

Treat same-face copies across destinations as a potential precedence conflict and show all known managed copies. Preserve unrelated fonts already in the destination. Reuse immutable revisions, operation journaling, history, and per-destination ownership. Verify writable access and report the remedy when unavailable; do not silently change directory permissions. Never automatically remove unmanaged Adobe fonts, empty the entire destination, or restart an Adobe application. Folder removal or application upgrades must produce a destination-unavailable state, preserving recovery metadata.

**Acceptance criteria.**

- F09-A: The compatibility matrix names exact tested versions and has a clear supported/unsupported conclusion for each destination.
- F09-B: Destination selection is explicit before a copy is written; details accurately list the copies and known verification state.
- F09-C: Update, rollback, deactivation/removal where supported, and restart reconciliation affect only files managed by the app.
- F09-D: A system/Adobe naming conflict is disclosed before automatic replacement or activation could create ambiguity.
- F09-E: Permission denial or disappearance of the destination leaves existing copies and retained revisions recoverable and reports a useful error.

**12. Data model and implementation architecture**

Use the following conceptual entities to support the workflows. Adapt names and storage layout to the current code; keep one shared API/domain contract instead of adding another independent frontend status model.

| Entity | Minimum responsibilities |
| --- | --- |
| FontAsset | Stable ID, collection/file identity, relationships to alternatives or renamed derivatives, capability flags |
| SourceBinding | Asset ID, canonical source path, owning folder ID, optional storage identity, availability, last observation |
| SourceObservation | Content fingerprint when validated, metadata, size/time, parse state; does not require retaining every historical source export |
| FontRevision | Immutable installed or explicitly retained bytes, fingerprint, format, face inventory, metadata, provenance, storage references |
| Installation | Asset, destination, actual installed revision, desired and verified activation states, managed paths |
| WatchFolder | Stable ID, root, policy, paused state, exclusions, availability, discovery/reconciliation state |
| UpdateOverride | Per-asset manual/automatic preference or persistent rollback/relink hold; separately reference applicable pins |
| Operation / OperationItem | Trigger, intended targets, expected revisions, progress, native results, recovery references, terminal outcomes, idempotency key |
| ProjectSet / ProjectMember | Name, stable membership, optional retained-revision pins, desired activity and unmet requirements |
| ActivationOwner | Installation requirement held by a manual choice or active project; enough provenance to release only that demand |
| PreviewPreferences | Remembered text/presets and controls; per-font axis/feature selections validated against its capabilities |

A revision fingerprint establishes byte equality. Face identity establishes potential naming/activation conflicts. Those are different comparisons: two alternative formats can represent the same face without being the same revision. Store metadata for the installed revision separately from metadata observed in its source. Renaming creates a derived asset with provenance and its own identity; preserve the existing detached-source semantics unless a later user action explicitly links a compatible source.

Source paths and filesystem timestamps are observations, not stable IDs. After copying/staging, fingerprint and parse the bytes actually being committed. Preflight conflicts against current catalog and destination state. Keep coupled file changes, catalog writes, and recovery journal transitions under a defined serialized operation boundary. Use worker/background tasks for expensive reads where appropriate; commit through the existing catalog coordinator.

**Suggested service boundaries.** Extend source reconciliation, import planning, revision storage, installation transactions, operation history, project ownership, and destination adapters as distinct modules. The renderer requests plans and actions and displays their outcomes; it should not independently decide which files conflict or derive native success from a resolved HTTP call.

| Capability | Suggested contract, not a required route name |
| --- | --- |
| Inspect/relink source | Prepare mappings with match reasons and expected revisions; apply validated mappings under an operation ID |
| Configure folder | Save complete policy and exclusions; inspect initial plan; start/pause/resume with explicit discovery intent |
| Plan import/update/project activation | Return per-item classification, affected installations, permitted choices, and plan version |
| Apply plan | Accept plan ID, selected choices, expected revisions, and idempotency key; return operation and per-item outcomes |
| History and recovery | List activity/revisions; prepare and apply restore/undo; explain unavailable recovery actions |
| Preview | Resolve asset + source/installed/retained revision + face index to a validated immutable preview resource |
| Project requirements | Edit stable members/pins, plan activation/release, list owners and unmet requirements |
| Destination discovery | Return verified capabilities and availability; do not expose unsupported operations as enabled |

Keep existing loopback authentication, request-origin/host rules, protected-font containment, upload limits, and native-operation test isolation. Serve preview resources by validated identities rather than accepting unrestricted filesystem paths. Version SSE payloads or provide a monotonic catalog/operation revision so reconnects and out-of-order responses can reconcile. A reconnect fetches authoritative state; repeated event delivery does not repeat operations or notifications.

**Current integration points to inspect.** These links identify code areas, not a mandate to rewrite them or a certification of their current behavior.

| Area | Existing code |
| --- | --- |
| Domain and persistence | [core/types.ts](/Users/daniel/git/font-butler/core/types.ts), [core/catalog.ts](/Users/daniel/git/font-butler/core/catalog.ts), [core/settings.ts](/Users/daniel/git/font-butler/core/settings.ts), [src/lib/types.ts](/Users/daniel/git/font-butler/src/lib/types.ts) |
| Lifecycle and native operations | [core/service.ts](/Users/daniel/git/font-butler/core/service.ts), [core/install.ts](/Users/daniel/git/font-butler/core/install.ts), [core/native.ts](/Users/daniel/git/font-butler/core/native.ts), [core/paths.ts](/Users/daniel/git/font-butler/core/paths.ts) |
| Discovery and conflicts | [core/watch.ts](/Users/daniel/git/font-butler/core/watch.ts), [core/formats.ts](/Users/daniel/git/font-butler/core/formats.ts), [src/lib/drop.ts](/Users/daniel/git/font-butler/src/lib/drop.ts) |
| Font metadata and rendering | [core/parse.ts](/Users/daniel/git/font-butler/core/parse.ts), [src/lib/instances.ts](/Users/daniel/git/font-butler/src/lib/instances.ts), [FontFaceStyles.tsx](/Users/daniel/git/font-butler/src/components/FontFaceStyles.tsx), [src/lib/preview.ts](/Users/daniel/git/font-butler/src/lib/preview.ts) |
| Application views and actions | [App.tsx](/Users/daniel/git/font-butler/src/App.tsx), [Inspector.tsx](/Users/daniel/git/font-butler/src/components/Inspector.tsx), [Sidebar.tsx](/Users/daniel/git/font-butler/src/components/Sidebar.tsx), [src/lib/eligibility.ts](/Users/daniel/git/font-butler/src/lib/eligibility.ts) |
| Setup and folder settings | [OnboardingDialog.tsx](/Users/daniel/git/font-butler/src/components/OnboardingDialog.tsx), [SettingsDialog.tsx](/Users/daniel/git/font-butler/src/components/SettingsDialog.tsx), [DropFolderDialog.tsx](/Users/daniel/git/font-butler/src/components/DropFolderDialog.tsx) |
| API and desktop integration | [server/index.ts](/Users/daniel/git/font-butler/server/index.ts), [src/lib/api.ts](/Users/daniel/git/font-butler/src/lib/api.ts), [electron/main.mjs](/Users/daniel/git/font-butler/electron/main.mjs), [electron/preload.cjs](/Users/daniel/git/font-butler/electron/preload.cjs) |

**13. Migration, delivery order, and operational requirements**

**Migration.** Take a recoverable backup before changing schema versions. Make migrations versioned, repeatable, and restart-safe. Preserve asset IDs and all existing settings, paths, custom-name relationships, and installed/deactivated intent. For ambiguous old state, verify available files/native state and mark unknown facts rather than guessing. Existing self-sourced user fonts become installations with no external source binding. Do not create a fake external source merely to satisfy a field requirement.

Initial revision inventory may fingerprint installed files in bounded background work; it must not replace them. Store a retained pin or rollback candidate only after successfully copying and verifying its bytes. Interrupted inventory and migration resume safely. Reconcile any newly added native, transaction, and eligibility helpers from the audit work; extend tested behavior instead of restoring an earlier implementation wholesale.

**Delivery increments.**

1. Establish verified transaction/recovery primitives, shared state and eligibility, revision identity, and migration tests. Confirm the file-safety and catalog-race regressions covered by the audit work remain fixed.
2. Deliver F01, F02, basic F03, the F05 planner, and F06 together: recover sources, govern automation, retain a previous version, resolve conflicts accurately, and show operation outcomes. Include a small complete UI for each capability.
3. Deliver F04's editable specimen and two-pane comparison, then axis/feature controls and coverage reporting. Use the same captured revisions as F03/F05.
4. Deliver F07 manual sets, ownership, and pins; follow with saved filters. Deliver F08 using the capability model and specimen workspace.
5. Complete F09's compatibility investigation. Implement only the destinations supported by that evidence, with a separate native acceptance run.

Each increment must be usable end to end. Avoid shipping controls backed by placeholder success responses or incomplete recovery storage. Retain compatibility with the existing browser development mode; hide or explain genuinely native-only capabilities without blocking browsing and preview.

**Usability and responsiveness.** Keep current list/grid preferences and lightweight card browsing. Source location, revision history, and project details belong in the inspector or focused views. All new controls need accessible names, keyboard operation, visible focus, and error text associated with the affected input. Preserve selection and specimen text when an operation completes. Respect reduced motion. Large discovery jobs show progress and can stop pending work; expensive font parsing must not block interactive rendering or Electron event handling. Benchmark a representative library of at least 2,000 families and a 500-file import on a named test machine, recording UI responsiveness and peak memory before and after the changes.

**14. Test matrix and completion evidence**

Use generated, redistributable fixtures and isolated directories. Read the current native adapter and test flags rather than assuming a data-directory override isolates macOS Fonts or caches. Run portable tests with injected filesystem/native failures and keep a distinct macOS integration suite. No acceptance claim about activation or Adobe behavior may be based solely on the portable no-op adapter.

| Test group | Required cases |
| --- | --- |
| Identity and import | Identical bytes/different paths; same face/new revision; TTF/CFF OTF alternatives; different styles/same family; partial TTC overlap; sanitized filename collisions |
| Sources and storage | File/folder move; missing then restored; offline volume; denied read; ambiguous candidates; relink while source changes; overlapping folder ownership |
| Automation | All folder policies; preserved legacy custom combination; pause/resume; exclusions; deactivated/uninstalled intent; rollback holds; project pins; repeated filesystem events |
| Transactions and history | Copy/register/enable/save failures; disk pressure; crash injection; coupled replacements; stale/idempotent Undo; retention with pins; startup reconciliation |
| Preview | Same metadata/new glyph bytes; installed/source mismatch; source changes during comparison; real named-instance coordinates; custom axes; feature availability; missing characters; collections |
| Actions and events | Mixed eligible states; independent failures; safe cancellation; retries; cleared selection; tray action with search filter; SSE reconnect/deduplication; native notification settings |
| Projects | Shared assets; manual ownership; incompatible pins; missing members; partial activation; deletion of active set; source relink; saved-filter membership changes |
| Web fonts | Valid WOFF/WOFF2; corrupt/oversized files; content/extension mismatch; mixed desktop/web drop; direct API install rejection; preview-only project |
| Native destinations | Real activation/deactivation; installed-state verification; rollback after failure; cache result reporting; packaged restart; every supported Adobe matrix row |

Record each F01–F09 acceptance criterion against automated tests or a reproducible manual result. Add or retain a documented full test command and CI coverage appropriate to the repository's current tooling. Build and lint the final implementation; report actual commands, pass/fail/skip counts, and native environments tested. Do not reuse the old audit's passing counts as validation of new work.

The implementation handoff should include completed feature IDs, schema changes and recovery behavior, user-visible changes, known unsupported cases, test evidence, and screenshots of relink review, folder policy setup, activity/restore, comparison, conflict review, and a project with shared fonts. Document any Adobe investigation limitation explicitly. The resulting app must preserve working font files, respect user activation choices, and make every incomplete operation visible and recoverable.
