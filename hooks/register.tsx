import type { Register } from 'claude-code'

// One plan, filed once per name: the source file Claude Code wrote, the slug and the
// day of the copy, and the copy's path.
type Filed = { slug: string; date: string; file: string }

const MAX_SLUG = 60

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

/** The local date as YYYY-MM-DD. */
export const dayOf = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

/**
 * The copy's file name in `folder`: the earlier copy's of this source when its slug and day
 * are unchanged (the same plan approved again), else the first free `<date>-<slug>[-n].md`,
 * so an earlier plan is never overwritten.
 */
export const nameFor = (folder: string, date: string, slug: string, taken: ReadonlySet<string>, prev?: Filed): string => {
  if (prev && prev.slug === slug && prev.date === date && prev.file.startsWith(`${folder}/`)) {
    return prev.file.slice(folder.length + 1)
  }
  for (let n = 1; ; n++) {
    const name = `${date}-${slug}${n > 1 ? `-${n}` : ''}.md`
    if (!taken.has(name)) return name
  }
}

const folderOf = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : ''
  const folder = raw.replace(/[\\/]+$/, '')
  return folder === '' ? 'plans' : folder
}

export const register: Register = (on, options) => {
  // Paths chosen in this process and not yet written: two plans approved at once never
  // pick the same free name.
  const pending = new Set<string>()

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const done = await next(e)
    try {
      if (done.deny !== undefined || done.isError) return done
      const out = done.result
      if (!out || out.awaitingLeaderApproval) return done
      const plan = out.plan ?? (out.filePath ? await $.fs.read(out.filePath) : null)
      if (typeof plan !== 'string' || plan.trim() === '') return done

      const named = folderOf((options as { folder?: unknown } | undefined)?.folder)
      const isAbsolute = named.startsWith('/') || /^[A-Za-z]:[\\/]/.test(named)
      const folder = isAbsolute ? named : `${(await $.session.cwd()).replace(/[\\/]+$/, '')}/${named}`
      const slug = slugOf(titleOf(plan))
      const date = dayOf(new Date())
      const key = `filed:${out.filePath ?? slug}`
      const prev = (await $.store.get(key)) as Filed | undefined
      const listed = (await $.fs.exists(folder)) ? await $.fs.list(folder) : []
      const taken = new Set([...listed.map(x => x.name), ...[...pending].map(p => p.slice(folder.length + 1))])
      const name = nameFor(folder, date, slug, taken, prev)
      const file = `${folder}/${name}`

      pending.add(file)
      try {
        await $.fs.write(`${folder}/${name}`, plan.endsWith('\n') ? plan : `${plan}\n`)
      } finally {
        pending.delete(file)
      }
      await $.store.set(key, { slug, date, file } satisfies Filed)
      $.ui.toast(`plan-names: plan saved as ${isAbsolute ? file : `${named}/${name}`}`)
    } catch {
      // A failure of this mod never changes the plan or the call.
    }
    return done
  })
}
