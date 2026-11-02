import type { Register } from 'claude-code'

// One plan, filed once per name: the source file Claude Code wrote, the slug and the
// day of the copy, and the copy's path.
type Filed = { slug: string; date: string; file: string; sum?: string }

const MAX_SLUG = 60
const TOAST_FITS = 104

/** The plan's title: its first Markdown heading, else its first non-empty line. */
export const titleOf = (plan: string): string => {
  const lines = plan.split(/\r?\n/)
  for (const line of lines) {
    const m = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line)
    if (m?.[1]) return m[1]
  }
  return lines.map(l => l.trim()).find(l => l !== '') ?? ''
}

/** A file-name-safe slug: lower case a-z, 0-9 and dashes, at most 60 characters, never empty. */
export const slugOf = (title: string): string => {
  const plain = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\W*(implementation\s+)?plan\s*[:\-–—]\s*/, '')
  let slug = plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > MAX_SLUG) {
    const cut = slug.slice(0, MAX_SLUG + 1)
    const dash = cut.lastIndexOf('-')
    slug = (dash > 20 ? cut.slice(0, dash) : slug.slice(0, MAX_SLUG)).replace(/-+$/, '')
  }
  return slug || 'plan'
}

/** A short checksum of a copy's text (FNV-1a), to tell our copy from a file someone else wrote there. */
export const sumOf = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16)
}

/** The local date as YYYY-MM-DD. */
export const dayOf = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

/**
 * The copy's file name in `folder`: the earlier copy's of this source when its slug and day
 * are unchanged (the same plan approved again), else the first free `<date>-<slug>[-n].md`,
 * so an earlier plan is never overwritten. Names are compared without case: on macOS and
 * Windows disks, two names differing only in case are one file.
 */
export const nameFor = (folder: string, date: string, slug: string, taken: ReadonlySet<string>, prev?: Filed): string => {
  if (prev && prev.slug === slug && prev.date === date && prev.file.startsWith(`${folder}/`) &&
    !prev.file.slice(folder.length + 1).includes('/')) {
    return prev.file.slice(folder.length + 1)
  }
  const folded = new Set([...taken].map(t => t.toLowerCase()))
  for (let n = 1; ; n++) {
    const name = `${date}-${slug}${n > 1 ? `-${n}` : ''}.md`
    if (!folded.has(name.toLowerCase())) return name
  }
}

const folderOf = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : ''
  const folder = raw.replace(/[\\/]+$/, '')
  return folder === '' ? 'plans' : folder
}

export const register: Register = (on, options) => {
  // Paths chosen in this process, each with the step its write finished (Infinity while
  // pending). A listing begun before that step may not show the file yet, so the path counts
  // as taken: two plans approved at once never pick the same free name, however late a
  // listing arrives, and a copy the user deleted earlier frees its name again.
  const chosen = new Map<string, number>()
  let step = 0

  // Approvals are copied one at a time: two revisions of one plan at once must not both read
  // the same copy and keep the same revision.
  let queue: Promise<unknown> = Promise.resolve()

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const done = await next(e)
    const turn = queue.then(async () => {
    try {
      if (done.deny !== undefined || done.isError) return
      const out = done.result
      if (!out || out.awaitingLeaderApproval) return
      const plan = out.plan ?? (out.filePath ? await $.fs.read(out.filePath) : null)
      if (typeof plan !== 'string' || plan.trim() === '') return

      const named = folderOf((options as { folder?: unknown } | undefined)?.folder)
      const isAbsolute = named.startsWith('/') || /^[A-Za-z]:[\\/]/.test(named)
      const folder = isAbsolute ? named : `${(await $.session.root()).replace(/[\\/]+$/, '')}/${named}`
      const slug = slugOf(titleOf(plan))
      const date = dayOf(new Date())
      // Only a plan file says two approvals are the same plan; without one, a title is not enough.
      const key = out.filePath ? `filed:${out.filePath}` : undefined
      let prev = key ? ((await $.store.get(key)) as Filed | undefined) : undefined
      // Reuse the stored name only while the file there is still the copy this mod wrote.
      if (prev && !(prev.sum !== undefined && (await $.fs.exists(prev.file)) &&
        sumOf(await $.fs.read(prev.file)) === prev.sum)) prev = undefined
      const listedAt = step
      const listed = (await $.fs.exists(folder)) ? await $.fs.list(folder) : []
      const taken = new Set([...listed.map(x => x.name), ...[...chosen].filter(([p, at]) => at > listedAt && p.startsWith(`${folder}/`)).map(([p]) => p.slice(folder.length + 1))])
      const text = plan.endsWith('\n') ? plan : `${plan}\n`
      let name = nameFor(folder, date, slug, taken, prev)
      let keptAs: number | undefined
      // A revised plan updates its one copy; the version it replaces is kept first, under
      // `.revisions/` (anthropics/claude-code#14259). If it cannot be kept there, the copy is
      // left as it is and the revised plan takes the next free name: neither version is lost.
      if (prev && `${folder}/${name}` === prev.file && prev.sum !== sumOf(text)) {
        try {
          const kept = `${folder}/.revisions`
          const had = (await $.fs.exists(kept)) ? (await $.fs.list(kept)).map(x => x.name.toLowerCase()) : []
          const stem = name.replace(/\.md$/, '')
          let n = 1
          while (had.includes(`${stem}-r${n}.md`.toLowerCase())) n++
          // user file: the replaced version of the user's plan, kept beside it.
          await $.fs.write(`${kept}/${stem}-r${n}.md`, await $.fs.read(prev.file))
          keptAs = n
        } catch {
          name = nameFor(folder, date, slug, taken)
        }
      }
      const file = `${folder}/${name}`

      chosen.set(file, Infinity)
      try {
        // user file: the user's plan under its new name.
        await $.fs.write(`${folder}/${name}`, text)
      } finally {
        chosen.set(file, ++step)
      }
      if (key) await $.store.set(key, { slug, date, file, sum: sumOf(text) } satisfies Filed)
      const shown = isAbsolute ? folder : named
      // The toast must fit one 120-column line with its "plan-names: " prefix, so the kept
      // version is named by its number only; a long name gets the shortest form.
      const saved = `plan saved as ${shown}/${name}`
      const longer = ` (earlier kept as -r${keptAs} in .revisions)`
      $.ui.toast(keptAs === undefined ? saved
        : saved.length + longer.length <= TOAST_FITS ? `${saved}${longer}` : `${saved} (earlier: -r${keptAs})`)
    } catch {
      // A failure of this mod never changes the plan or the call.
    }
    })
    queue = turn.catch(() => undefined)
    await turn
    return done
  })
}
