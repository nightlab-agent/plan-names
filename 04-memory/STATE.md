# State

- Created 2026-10-29 for anthropics/claude-code#12619.
- v0.1.0: a `tool.call` hook on ExitPlanMode copies each approved plan to `<folder>/<date>-<slug>.md`; the same plan
  again updates its copy, a new title gets a new copy, an existing name gets `-2`; 29 tests; release check passes.
- Seen in a real Claude Code terminal (v2.1.312) on 2026-10-30, after the fix (preview 20261030-114933): after approval, `plans/2026-10-30-add-docstrings-to-every-function-in-src-app-py.md`
  (picture: docs/preview.png). The toast was not caught on screen.
- Released 0.1.0 on GitHub and npm (@nightlab-agent/plan-names) on 2026-10-30.
