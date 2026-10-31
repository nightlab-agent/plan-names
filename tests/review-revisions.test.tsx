import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { dayOf } from '../hooks/register'

type On = Parameters<TestBody>[1]
const ROOT = '/proj'
const today = () => dayOf(new Date())
const SRC = '/home/u/.claude/plans/fluffy-dancing-otter.md'
const A = '# Plan: Add OAuth login\n\n1. Add the callback route\n'
const B = `${A}2. Add tests\n`
const C = `${B}3. Add docs\n`
const STEM = () => `plans/${today()}-add-oauth-login`

// In-memory engine as in plan-names.test.tsx, but with the declared behaviour of a listing:
// `$.fs.list` "Lists a directory" (claude-code.d.ts:3339) and an OS refusal rejects with its
// errno (d.ts:3305-3311), so listing a regular file rejects ENOTDIR. `deny` refuses a write
// whose path matches, as an fs.write guard above this mod may. `delay` holds an op per path.
const world = (on: On, opts: { deny?: RegExp; delay?: (op: string, p: string) => number } = {}) => {
  const files = new Map<string, string>()
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  let answer: unknown = { result: {} }
  const rel = (p: string) => (p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : p)
  const wait = async (op: string, p: string) => {
    const ms = opts.delay?.(op, rel(p)) ?? 0
    if (ms) await new Promise(r => setTimeout(r, ms))
  }
  on('session.cwd', () => ({ value: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', async (_, e) => {
    await wait('exists', e.path)
    return { value: [...files.keys()].some(f => f === rel(e.path) || f.startsWith(`${rel(e.path)}/`)) }
  })
  on('fs.list', async (_, e) => {
    await wait('list', e.path)
    const d = rel(e.path)
    if (files.has(d)) throw new Error(`ENOTDIR: not a directory, scandir '${e.path}'`)
    return {
      value: [...files.keys()]
        .filter(f => f.startsWith(`${d}/`) && !f.slice(d.length + 1).includes('/'))
        .map(f => ({ name: f.slice(d.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.read', async (_, e) => {
    await wait('read', e.path)
    const t = files.get(rel(e.path))
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.write', async (_, e) => {
    await wait('write', e.path)
    if (opts.deny?.test(rel(e.path))) throw new Error('EACCES: permission denied')
    files.set(rel(e.path), e.text)
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => answer as never)
  const approve = (plan: string, filePath = SRC) => {
    answer = { result: { plan, isAgent: false, filePath } }
  }
  return { files, toasts, approve }
}

// Look-alike / failure path: `plans/.revisions` is a file (the user's, or another tool's), not a
// folder. exists() says true, list() rejects, the catch swallows it: the revised plan is never
// written, no toast, and since the store still holds A's sum, every later revision fails too.
test('review failure: a file named plans/.revisions must not stop the revised plan being saved', async ($, on) => {
  const w = world(on)
  w.files.set('plans/.revisions', 'my notes\n')
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(C)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get('plans/.revisions')).toBe('my notes\n')
  // The revision cannot be kept, so the copy is left alone and each revised plan gets its own name.
  expect(w.files.get(`${STEM()}.md`)).toBe(A)
  expect(w.files.get(`${STEM()}-2.md`)).toBe(B)
  expect(w.files.get(`${STEM()}-3.md`)).toBe(C)
})

test('review failure control: with plans/.revisions a folder, the revised plan is saved', async ($, on) => {
  const w = world(on)
  w.files.set('plans/.revisions/readme.txt', 'x\n')
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(C)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`${STEM()}.md`)).toBe(C)
})

// Failure path: the revision write is refused (a guard on dot-folders, a full disk). b9ce421 threw before the copy write and
// saved nothing; now the copy is left alone and the revised plan takes the next free name.
test('review failure: a refused revision write must not lose the revised plan', async ($, on) => {
  const w = world(on, { deny: /\/\.revisions\// })
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`${STEM()}.md`)).toBe(A)
  expect(w.files.get(`${STEM()}-2.md`)).toBe(B)
  expect(w.toasts).toHaveLength(2)
})

test('review failure control: with the revision write allowed, the revised plan is saved', async ($, on) => {
  const w = world(on)
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`${STEM()}.md`)).toBe(B)
  expect(w.toasts).toHaveLength(2)
})

// Two at once: B and C approved together on the same source (reachability: needs two overlapping
// ExitPlanMode calls with one filePath). Both list an empty .revisions, both keep A as r1, and the
// later copy write replaces the other's plan with no revision of it.
test('review race: two revisions at once must both survive (copy or .revisions)', async ($, on) => {
  const w = world(on, { delay: (op) => (op === 'write' ? 5 : 0) })
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  const p1 = $.tool.call({ tool: 'ExitPlanMode' })
  // One tick so each call reads its own answer; the 5 ms writes still overlap.
  await new Promise(r => setTimeout(r, 1))
  w.approve(C)
  const p2 = $.tool.call({ tool: 'ExitPlanMode' })
  await Promise.all([p1, p2])
  const all = [...w.files.values()]
  expect(all.includes(A) && all.includes(B) && all.includes(C)).toBe(true)
})

test('review race control: the same two revisions one after the other all survive', async ($, on) => {
  const w = world(on, { delay: (op) => (op === 'write' ? 5 : 0) })
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(C)
  await $.tool.call({ tool: 'ExitPlanMode' })
  const all = [...w.files.values()]
  expect(all.includes(A) && all.includes(B) && all.includes(C)).toBe(true)
})

// Look-alike: a user file named like a revision, in other case, is skipped, not overwritten.
test('review look-alike: a user file named like r1 (other case) is not overwritten', async ($, on) => {
  const w = world(on)
  w.files.set(`plans/.revisions/${today()}-ADD-OAUTH-LOGIN-R1.md`, 'mine\n')
  w.approve(A)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(B)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`plans/.revisions/${today()}-ADD-OAUTH-LOGIN-R1.md`)).toBe('mine\n')
  expect(w.files.get(`plans/.revisions/${today()}-add-oauth-login-r2.md`)).toBe(A)
})
