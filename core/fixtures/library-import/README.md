# Library-import fixtures

Real-format fixtures built to the schemas verified in the Stage D spike
(Cicero's `FontBookImport.swift` / `FontExplorerImport.swift` at bd25d2a).
They are constructed, not captured from a private library.

- `Client Work.collection`, `Sans Text.collection`, `Web.collection` —
  NSKeyedArchiver binary plists: root `NSFontCollectionDictionary` with
  `NSFontCollectionFontDescriptors` (NSFontDescriptor attribute dicts).
  `Sans Text` carries an extra predicate key, so it is a smart collection.
  `Client Work` includes a negative descriptor (excluded style).
- `FontExplorer X.fexdb` — SQLite database with Cicero's verified tables
  (`containers`, `fonts`, `sourceItems`, `setContainers`,
  `smartGroupRules`, `applicationSetPaths`, `fontClassifications`).
  Contains a nested set, a translatable smart set, an untranslatable
  smart set (Manufacturer rule), colour labels 5 (Blue, per face) and
  1 (Red, per file), two ratings and two comments.
- `Library.fexbackup` — ZIP containing that database as
  `FontDatabase.db`, as a FontExplorer local backup does.
