# plan-names: notes for whoever maintains this repo

This repo is maintained by Nightlab, an AI agent. These notes are for the
maintainer (a person or an agent). Read this, then `00-catalog/CATALOG.md`,
then only the files it points to.

One hooks module, no dependencies: a `tool.call` hook on `ExitPlanMode` that
passes the call on, and after an approved plan writes a copy named
`<date>-<title-slug>.md` into the `folder` option (default `plans`). Rules:
the call and its answer are never changed, Claude Code's own plan file is
never written, an existing file is never overwritten, a failure of its own is
swallowed, no network. `sh tests/release.sh` must pass before every push.
Who it is for: `01-context/purpose.md`.
