import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { dayOf } from '../hooks/register'

type On = Parameters<TestBody>[1]
const CWD = '/proj'
const today = () => dayOf(new Date())
const PLAN = '# Plan: Add OAuth login\n\n1. Add the callback route\n'
const SRC_A = '/home/u/.claude/plans/fluffy-dancing-otter.md'
const SRC_B = '/home/u/.claude/plans/quiet-blue-heron.md'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// In-memory engine as in plan-names.test.tsx, with knobs:
// - caseless: the disk folds case (macOS APFS / Windows NTFS defaults)
// - listDelays / writeDelays: per-call delays; a list takes its snapshot at once and is
//   delivered after its delay (as readdir results travel back to the plugin)
// - answers: one ExitPlanMode answer per call, in call order
type Opts = { files?: Record<string, string>; caseless?: boolean; listDelays?: number[]; writeDelays?: number[] }
const world = (on: On, opts: Opts = {}) => {
  const fold = (p: string) => (opts.caseless ? p.toLowerCase() : p)
  const files = new Map<string, { name: string; text: string }>()
  for (const [k, v] of Object.entries(opts.files ?? {})) files.set(fold(k), { name: k, text: v })
  const store = new Map<string, unknown>()
  const answers: unknown[] = []
  let lists = 0
  let writes = 0
  const rel = (p: string) => (p.startsWith(`${CWD}/`) ? p.slice(CWD.length + 1) : p)
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: CWD }))
  on('fs.exists', (_, e) => ({ value: [...files.keys()].some(f => f === fold(rel(e.path)) || f.startsWith(`${fold(rel(e.path))}/`)) }))
  on('fs.list', async (_, e) => {
    const dir = rel(e.path)
    const snap = [...files.values()]
      .filter(f => fold(f.name).startsWith(`${fold(dir)}/`) && !f.name.slice(dir.length + 1).includes('/'))
      .map(f => ({ name: f.name.slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }))
    await sleep(opts.listDelays?.[lists++] ?? 0)
    return { value: snap }
  })
  on('fs.read', (_, e) => {
    const f = files.get(fold(rel(e.path)))
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.text }
  })
  on('fs.write', async (_, e) => {
    await sleep(opts.writeDelays?.[writes++] ?? 0)
    const key = fold(rel(e.path))
    const had = files.get(key)
    files.set(key, { name: had?.name ?? rel(e.path), text: e.text })
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => (answers.shift() ?? { result: {} }) as never)
  const approve = (plan: string, filePath?: string) => {
    answers.push({ result: { plan, isAgent: false, filePath } })
  }
  const text = (p: string) => files.get(fold(p))?.text
  const del = (p: string) => files.delete(fold(p))
  return { files, text, del, approve }
}

// Kind 2: two plans of one title from two sources approved together. The second call's
// listing is taken before the first copy lands and arrives after the first call has
// cleared `pending`, so both pick <date>-add-oauth-login.md and the second overwrites the first.
test('review two at once: a late listing must not let a second plan overwrite the first', async ($, on) => {
  const w = world(on, { files: { 'plans/README.md': 'x' }, listDelays: [0, 30] })
  w.approve(PLAN, SRC_A)
  w.approve('# Plan: Add OAuth login\n\nsecond plan\n', SRC_B)
  await Promise.all([$.tool.call({ tool: 'ExitPlanMode' }), $.tool.call({ tool: 'ExitPlanMode' })])
  expect(w.text(`plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
  expect(w.text(`plans/${today()}-add-oauth-login-2.md`)).toContain('second plan')
})

test('review two at once control: listings arriving promptly give two names', async ($, on) => {
  const w = world(on, { files: { 'plans/README.md': 'x' }, listDelays: [0, 0] })
  w.approve(PLAN, SRC_A)
  w.approve('# Plan: Add OAuth login\n\nsecond plan\n', SRC_B)
  await Promise.all([$.tool.call({ tool: 'ExitPlanMode' }), $.tool.call({ tool: 'ExitPlanMode' })])
  expect(w.text(`plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
  expect(w.text(`plans/${today()}-add-oauth-login-2.md`)).toContain('second plan')
})

// Kind 3: on a case-folding disk, the user's own file differing only in case is the same file.
test('review look-alike: a user file differing only in case is never overwritten (caseless disk)', async ($, on) => {
  const mine = `plans/${today()}-Add-OAuth-Login.md`
  const w = world(on, { caseless: true, files: { [mine]: 'mine' } })
  w.approve(PLAN, SRC_A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.text(mine)).toBe('mine')
})

test('review look-alike control: a user file with the exact name is never overwritten (caseless disk)', async ($, on) => {
  const mine = `plans/${today()}-add-oauth-login.md`
  const w = world(on, { caseless: true, files: { [mine]: 'mine' } })
  w.approve(PLAN, SRC_A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.text(mine)).toBe('mine')
})

// Kind 3: the stored name is trusted without checking who holds it now.
test('review look-alike: after the user deletes copy A, B takes the name; re-approving A must not overwrite B', async ($, on) => {
  const name = `plans/${today()}-add-oauth-login.md`
  const w = world(on)
  w.approve(PLAN, SRC_A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.del(name)
  w.approve('# Plan: Add OAuth login\n\nother session\n', SRC_B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(`${PLAN}2. Add tests\n`, SRC_A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.text(name)).toContain('other session')
})

test('review look-alike control: without the delete, B gets -2 and A updates its own copy', async ($, on) => {
  const name = `plans/${today()}-add-oauth-login.md`
  const w = world(on)
  w.approve(PLAN, SRC_A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve('# Plan: Add OAuth login\n\nother session\n', SRC_B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(`${PLAN}2. Add tests\n`, SRC_A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.text(`plans/${today()}-add-oauth-login-2.md`)).toContain('other session')
  expect(w.text(name)).toContain('2. Add tests')
})
