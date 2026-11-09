import { dialog, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { documentsDir } from '../adapters/host'
import type { DraftContent, DraftFile, LeetCodeDaily } from '@shared/types'
import { getConfig, patchConfig } from './app-config'
import { primaryWindow } from './windows'
import { createLogger } from '../utils/logger'

const log = createLogger('draft')

/** Default folder for daily solution drafts. */
export function draftDir(): string {
  const configured = getConfig().routine.draftDir.trim()
  if (configured) return configured
  return join(documentsDir() || join(homedir(), 'Documents'), 'TaskOrbit', 'Daily')
}

function slugify(text: string): string {
  const base = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.slice(0, 60) || 'daily'
}

/** `2026-09-20-two-sum.md` */
export function draftFileName(date: string, title: string): string {
  return `${date}-${slugify(title)}.md`
}

function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

/** Today's draft, when one already exists (newest match wins). */
export function findDraft(date: string): string | undefined {
  const dir = draftDir()
  if (!existsSync(dir)) return undefined
  const matches = readdirSync(dir)
    .filter((name) => name.startsWith(`${date}-`) && name.endsWith('.md'))
    .sort()
  const newest = matches[matches.length - 1]
  return newest ? join(dir, newest) : undefined
}

/**
 * Skeleton for the day's write-up. The human still writes the thinking — the
 * app only removes the boilerplate (front matter, headings, complexity list).
 */
function buildTemplate(date: string, daily: LeetCodeDaily | undefined, language: 'en' | 'vi'): string {
  const vi = language === 'vi'
  const tags = daily?.tags ?? []
  const front = [
    '---',
    `title: "${(daily?.title ?? 'Untitled').replace(/"/g, "'")}"`,
    `date: ${date}`,
    daily?.difficulty ? `difficulty: ${daily.difficulty}` : 'difficulty: ',
    `tags: [${tags.map((t) => t.toLowerCase().replace(/\s+/g, '-')).join(', ')}]`,
    daily?.link ? `leetcode: ${daily.link}` : 'leetcode: ',
    '---',
    ''
  ].join('\n')

  if (vi) {
    return `${front}
# ${daily?.title ?? 'Bài giải hôm nay'}

> ${daily ? `${daily.difficulty} · ${tags.slice(0, 4).join(', ')}` : 'Ghi chú nhanh trước khi viết'}

## Đề bài
<!-- Tóm tắt đề bằng 1–3 câu, theo cách bạn hiểu -->

## Ý tưởng
<!-- Nghĩ gì trước, brute force ở đâu, tối ưu bằng gì -->

## Thuật toán
1.
2.
3.

## Code
\`\`\`python

\`\`\`

## Độ phức tạp
- Thời gian:
- Bộ nhớ:

## Chỗ dễ sai / bài học
-

## Ảnh cần chèn
<!-- Chụp màn hình, sơ đồ, output — ghi đường dẫn ảnh ở đây trước khi đăng -->
-
`
  }

  return `${front}
# ${daily?.title ?? "Today's solution"}

> ${daily ? `${daily.difficulty} · ${tags.slice(0, 4).join(', ')}` : 'Quick notes before you write'}

## Problem
<!-- Summarise the statement in 1–3 sentences, in your own words -->

## Idea
<!-- What did you try first, what made it faster -->

## Algorithm
1.
2.
3.

## Code
\`\`\`python

\`\`\`

## Complexity
- Time:
- Space:

## Gotchas / takeaways
-

## Images to add
<!-- Screenshots, diagrams, output — list the files here before publishing -->
-
`
}

/** Create (or reuse) today's draft. Never overwrites an existing file. */
export function createDraft(options: { date: string; daily?: LeetCodeDaily; force?: boolean }): DraftFile {
  const dir = ensureDir(draftDir())
  const existing = findDraft(options.date)
  if (existing && !options.force) {
    return { path: existing, created: false, date: options.date }
  }

  const name = draftFileName(options.date, options.daily?.title ?? 'daily')
  const path = join(dir, name)
  const language = getConfig().appearance.language === 'vi' ? 'vi' : 'en'
  writeFileSync(path, buildTemplate(options.date, options.daily, language), { encoding: 'utf8' })
  log.info(`draft created: ${path}`)
  return { path, created: true, date: options.date }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Single implementation of the draft format: YAML front matter + a leading H1.
 * Both the composer hand-off and the automatic publishing use it, so the text
 * sent to Medium/LinkedIn is exactly what the file says.
 */
export function parseDraft(content: string): { title: string; tags: string[]; body: string } {
  let title = ''
  let tags: string[] = []
  let rest = content

  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (frontMatter) {
    for (const line of frontMatter[1].split(/\r?\n/)) {
      const match = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line)
      if (!match) continue
      const [, key, rawValue] = match
      if (key.toLowerCase() === 'title') title = unquote(rawValue)
      if (key.toLowerCase() === 'tags') {
        tags = rawValue
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((tag) => unquote(tag))
          .filter(Boolean)
      }
    }
    rest = content.slice(frontMatter[0].length)
  }

  // The H1 repeats the front-matter title — use it as a fallback, then drop it.
  const heading = /^\s*#\s+(.+?)\s*$/m.exec(rest)
  if (heading && !title) title = heading[1].trim()
  const body = heading ? rest.replace(heading[0], '').replace(/^\s*\n/, '') : rest

  return { title: title || 'Daily solution', tags, body: body.trim() }
}

/** Read a draft (today's by default) with its front matter already parsed. */
export function readDraft(date: string, path?: string): DraftContent | null {
  const target = path && existsSync(path) ? path : findDraft(date)
  if (!target || !existsSync(target)) return null
  const content = readFileSync(target, 'utf8')
  const parsed = parseDraft(content)
  return { path: target, content, title: parsed.title, tags: parsed.tags, body: parsed.body }
}

/** Body of the draft with the front matter stripped (what you paste into Medium). */
export function stripFrontMatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  return (match ? content.slice(match[0].length) : content).trim()
}

/** Open the draft in the OS default editor. */
export async function openDraftFile(date: string, path?: string): Promise<string> {
  const target = path && existsSync(path) ? path : findDraft(date)
  if (!target) throw new Error('No draft for today yet — create one first')
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
  return target
}

export async function openDraftFolder(): Promise<string> {
  const dir = ensureDir(draftDir())
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
  return dir
}

/** Let the user choose another drafts folder. */
export async function pickDraftDir(): Promise<string> {
  const win = primaryWindow()
  const options: Electron.OpenDialogOptions = {
    title: 'Choose the folder for daily drafts',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) throw new Error('Canceled')
  const dir = result.filePaths[0]
  patchConfig({ routine: { draftDir: dir } })
  log.info(`draft folder set to ${dir}`)
  return dir
}
