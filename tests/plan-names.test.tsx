import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { dayOf, slugOf, titleOf } from '../hooks/register'

type On = Parameters<TestBody>[1]
type Answer = { deny: string } | { result: unknown; isError?: boolean }

// The engine beneath: an in-memory disk and store, a toast log, and an ExitPlanMode tool whose
// answer each test sets. `slowWrite` makes every write wait a tick, so two calls interleave.
const world = (on: On, opts: { files?: Record<string, string>; writeFails?: boolean; slowWrite?: boolean } = {}) => {
  const files = new Map(Object.entries(opts.files ?? {}))
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  let answer: Answer = { result: {} }
  const rel = (p: string) => (p.startsWith(`${CWD}/`) ? p.slice(CWD.length + 1) : p)
  on('session.cwd', () => ({ value: CWD }))
  on('fs.exists', (_, e) => ({ value: [...files.keys()].some(f => f === rel(e.path) || f.startsWith(`${rel(e.path)}/`)) }))
  on('fs.list', (_, e) => ({
    value: [...files.keys()]
      .filter(f => f.startsWith(`${rel(e.path)}/`) && !f.slice(rel(e.path).length + 1).includes('/'))
      .map(f => ({ name: f.slice(rel(e.path).length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const text = files.get(rel(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', async (_, e) => {
    if (opts.writeFails) throw new Error('read-only file system')
    if (opts.slowWrite) await new Promise(r => setTimeout(r, 5))
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
  const approve = (plan: string | null, filePath?: string, extra: Record<string, unknown> = {}) => {
    answer = { result: { plan, isAgent: false, filePath, ...extra } }
  }
  return { files, toasts, approve, set: (a: Answer) => { answer = a } }
}

const today = () => dayOf(new Date())
const CWD = '/proj'
const SRC = '/home/u/.claude/plans/fluffy-dancing-otter.md'
const PLAN = '# Plan: Add OAuth login\n\n1. Add the callback route\n'

test('an approved plan is saved under plans/<date>-<title>.md, word for word', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  const name = `plans/${today()}-add-oauth-login.md`
  expect(w.files.get(name)).toBe(PLAN)
  expect(w.toasts).toEqual([`plan-names: plan saved as ${name}`])
})

test('the call itself is passed on unchanged', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC)
  const r = await $.tool.call({ tool: 'ExitPlanMode' })
  expect(r.deny).toBe(undefined)
  expect((r.result as { filePath?: string }).filePath).toBe(SRC)
})

test('the same plan approved again (same source, same title) updates its one copy', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve(`${PLAN}2. Add tests\n`, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  const copies = [...w.files.keys()].filter(f => f.startsWith('plans/'))
  expect(copies).toEqual([`plans/${today()}-add-oauth-login.md`])
  expect(w.files.get(copies[0])).toContain('2. Add tests')
})

test('a new plan in the same file (a pivot) gets its own copy; the earlier one is kept', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve('# Switch to magic links\n', SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
  expect(w.files.get(`plans/${today()}-switch-to-magic-links.md`)).toBe('# Switch to magic links\n')
})

test('look-alike: another session\'s plan with the same title gets -2, never overwrites', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.approve('# Plan: Add OAuth login\n\nother session\n', '/home/u/.claude/plans/quiet-blue-heron.md')
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
  expect(w.files.get(`plans/${today()}-add-oauth-login-2.md`)).toContain('other session')
})

test('a file already in the folder under that name is never overwritten', async ($, on) => {
  const w = world(on, { files: { [`plans/${today()}-add-oauth-login.md`]: 'mine' } })
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`plans/${today()}-add-oauth-login.md`)).toBe('mine')
  expect(w.files.get(`plans/${today()}-add-oauth-login-2.md`)).toBe(PLAN)
})

test('two at once: two plans with one title approved together get two names', async ($, on) => {
  const w = world(on, { slowWrite: true })
  // Both calls share one answer; each passes its own copy of the plan through the same title.
  w.approve(PLAN, undefined)
  await Promise.all([$.tool.call({ tool: 'ExitPlanMode' }), $.tool.call({ tool: 'ExitPlanMode' })])
  const copies = [...w.files.keys()].filter(f => f.startsWith('plans/')).sort()
  expect(copies.length).toBe(2)
})

test('two at once control: one call alone makes one copy', async ($, on) => {
  const w = world(on, { slowWrite: true })
  w.approve(PLAN, undefined)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()].filter(f => f.startsWith('plans/')).length).toBe(1)
})

test('a refused or failed ExitPlanMode saves nothing', async ($, on) => {
  const w = world(on)
  w.set({ deny: 'User rejected the plan' })
  await $.tool.call({ tool: 'ExitPlanMode' })
  w.set({ result: { plan: PLAN, isAgent: false, filePath: SRC }, isError: true })
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()]).toEqual([])
  expect(w.toasts).toEqual([])
})

test('a plan still waiting on a team lead\'s approval is not saved yet', async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC, { awaitingLeaderApproval: true })
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect([...w.files.keys()]).toEqual([])
})

test('no plan text in the answer: the plan is read from its file', async ($, on) => {
  const w = world(on, { files: { [SRC]: '# From disk\n' } })
  w.approve(null, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`plans/${today()}-from-disk.md`)).toBe('# From disk\n')
})

test('Claude Code\'s own plan file is never written', async ($, on) => {
  const w = world(on, { files: { [SRC]: PLAN } })
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(SRC)).toBe(PLAN)
})

test('a disk that refuses the write leaves the call unchanged and shows no toast', async ($, on) => {
  const w = world(on, { writeFails: true })
  w.approve(PLAN, SRC)
  const r = await $.tool.call({ tool: 'ExitPlanMode' })
  expect(r.deny).toBe(undefined)
  expect(w.toasts).toEqual([])
})

test('the folder option is used, a trailing slash dropped', { options: { folder: 'docs/plans/' } }, async ($, on) => {
  const w = world(on)
  w.approve(PLAN, SRC)
  await $.tool.call({ tool: 'ExitPlanMode' })
  expect(w.files.get(`docs/plans/${today()}-add-oauth-login.md`)).toBe(PLAN)
})

test('titles: first heading, else first line', () => {
  expect(titleOf('intro\n## Real title\n')).toBe('Real title')
  expect(titleOf('\n\n  Just a line  \nmore')).toBe('Just a line')
  expect(titleOf('')).toBe('')
})

test('slugs: plain, safe on every OS, at most 60 characters, never empty', () => {
  expect(slugOf('Plan: Add OAuth login')).toBe('add-oauth-login')
  expect(slugOf('Implementation Plan — Fix CI')).toBe('fix-ci')
  expect(slugOf('Café: résumé parser')).toBe('cafe-resume-parser')
  expect(slugOf('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  expect(slugOf('')).toBe('plan')
  expect(slugOf('日本語')).toBe('plan')
  const long = slugOf('Refactor the authentication middleware so that every route checks the session token')
  expect(long.length <= 60).toBe(true)
  expect(long.endsWith('-')).toBe(false)
  expect(long.startsWith('refactor-the-authentication-middleware')).toBe(true)
})

test('slug control: a title that merely contains "plan" keeps it', () => {
  expect(slugOf('Planner page redesign')).toBe('planner-page-redesign')
})

