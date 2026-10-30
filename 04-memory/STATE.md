# State

- Created 2026-10-29 for anthropics/claude-code#12619.
- v0.1.0 (unreleased): `tool.call` on ExitPlanMode; copies to `<folder>/<date>-<slug>.md`; same plan again updates its
  copy, a new title gets a new copy, an existing name gets `-2`; 17 tests, 5 of them seen failing on planted bugs
  (no pending set, existing names ignored, no update in place, failed calls saved); release check passes.
- Not yet: a screen preview, the critic pass, an icon, a GitHub repo, an npm package.
