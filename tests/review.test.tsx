import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { dayOf } from '../hooks/register'

type On = Parameters<TestBody>[1]
const ROOT = '/proj'
const today = () => dayOf(new Date())
const PLAN = '# Plan: Add OAuth login\n\n1. Add the callback route\n'

// In-memory engine as in plan-names.test.tsx, plus a session.cwd that may differ from
// session.root (a shell `cd`).
const world = (on: On, opts: { cwd?: string } = {}) => {
  const files = new Map<string, string>()
  const store = new Map<string, unknown>()
  let answer: unknown = { result: {} }
  on('session.cwd', () => ({ value: opts.cwd ?? ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_, e) => ({ value: [...files.keys()].some(f => f === e.path || f.startsWith(`${e.path}/`)) }))
  on('fs.list', (_, e) => ({
    value: [...files.keys()]
      .filter(f => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/'))
      .map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const t = files.get(e.path)
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => answer as never)
  const approve = (plan: string, filePath?: string) => {
    answer = { result: { plan, isAgent: false, filePath } }
  }
  return { files, store, approve }
}

// Finding 1 (kind 3): with no filePath the store key is `filed:<slug>`, so a different plan with
// the same title is taken as "the same plan" and overwrites the earlier copy.
test('review look-alike: no filePath, a different plan with the same title must not overwrite', async ($, on) => {
  const w = world(on)
  w.approve(PLAN)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve('# Plan: Add OAuth login\n\nother session\n')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`${ROOT}/plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
})

test('review look-alike control: same case with two filePaths keeps the first', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, '/h/.claude/plans/a.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve('# Plan: Add OAuth login\n\nother session\n', '/h/.claude/plans/b.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`${ROOT}/plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
})

// Finding 2 (kind 4): $.session.cwd() follows a shell `cd`; root() does not.
test('review engine: after a shell cd into src/, the plan still goes to <project>/plans', async ($, on) => {
  const w = world(on, { cwd: `${ROOT}/src` })
  w.approve(PLAN, '/h/.claude/plans/a.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()]).toEqual([`${ROOT}/plans/${today()}-add-oauth-login.md`])
})

test('review engine control: cwd at the project root writes <project>/plans', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, '/h/.claude/plans/a.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()]).toEqual([`${ROOT}/plans/${today()}-add-oauth-login.md`])
})

// Finding 3 (kind 3): prev.file.startsWith(`${folder}/`) also matches a sub-folder.
const PREV = { slug: 'add-oauth-login', date: '', file: '' }
test('review look-alike: folder changed to docs, a re-approved plan goes to docs/', { options: { folder: 'docs' } }, async ($, on) => {
  const w = world(on)
  w.store.set('filed:/h/.claude/plans/a.md', { ...PREV, date: today(), file: `${ROOT}/docs/plans/${today()}-add-oauth-login.md` })
  w.approve(PLAN, '/h/.claude/plans/a.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()]).toEqual([`${ROOT}/docs/${today()}-add-oauth-login.md`])
})

test('review look-alike control: folder changed to notes, the plan goes to notes/', { options: { folder: 'notes' } }, async ($, on) => {
  const w = world(on)
  w.store.set('filed:/h/.claude/plans/a.md', { ...PREV, date: today(), file: `${ROOT}/docs/plans/${today()}-add-oauth-login.md` })
  w.approve(PLAN, '/h/.claude/plans/a.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()]).toEqual([`${ROOT}/notes/${today()}-add-oauth-login.md`])
})
