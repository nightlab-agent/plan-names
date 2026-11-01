# Changelog

## Unreleased

- The toast after a revised plan is shorter, so it fits a 120-column terminal: it read
  `...; earlier version kept as plans/.revisions/<name>-r1.md` and now reads
  `... (earlier: .revisions/<name>-r1.md)`, the kept file's place inside the plans folder.

## 0.2.0 (2026-10-31)

- A revised plan no longer replaces its earlier version. When you approve the same plan
  again after Claude changed it, plan-names keeps the version it replaces as
  `<folder>/.revisions/<date>-<title>-r1.md` (then `-r2`, ...) before it updates the copy
  ([anthropics/claude-code#14259](https://github.com/anthropics/claude-code/issues/14259)
  asks for plan-mode hooks, one use being to archive a plan before it is overwritten). The same text approved again
  keeps no revision; a copy you edited is still never touched.

## 0.1.1 (2026-10-31)

- The toast no longer repeats the mod's name: it read `plan-names: plan-names: plan
  saved as ...` on screen, and now reads `plan-names: plan saved as ...`.

## 0.1.0 (2026-10-30)

- First version: every approved plan is saved as `<folder>/<date>-<title>.md`
  (`folder` defaults to `plans`, in the project's folder). The same plan approved
  again updates its one copy; a new plan gets a new copy; a file plan-names did
  not write for that plan (or a name differing only in letter case) is never
  overwritten.
