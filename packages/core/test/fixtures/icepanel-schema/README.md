# IcePanel import schema (vendored)

Fetched on 2026-11-13 from `https://api.icepanel.io/v1/schemas/LandscapeImportData` and every schema it
references under `https://api.icepanel.io/v1/schemas/` (14 files, pretty-printed, otherwise unchanged).
Used by `test/icepanel-schema.test.ts` to validate the Zark exporter and the fixtures offline.

`../icepanel-guide-example.json` is the "Example JSON" payload copied verbatim from IcePanel's guide
"Importing landscapes" (https://developer.icepanel.io/developer-guide/how-to-guides/import-landscapes),
fetched the same day. It does not fully match the schema above: two objects use `type: database` (not in
`ImportModelObjectType`) and its tag group uses `icon: tag` (not in `TagGroupIcon`). The test pins exactly
those deviations so a future schema or guide change is noticed.
