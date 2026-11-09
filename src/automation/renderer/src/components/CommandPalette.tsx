import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type {
  AppConfig,
  IpcResult,
  ProviderWithCredentials,
  RoutineSnapshot,
  TaskInfo,
  ThemeMode
} from '@shared/types'
import { CREDENTIAL_TYPE_LABELS } from '@shared/constants'
import { describeTask } from '../lib/tasks'
import { getAppearance, subscribeAppearance, setAppearance } from '../lib/theme'
import { pushToast } from '../lib/toast'

type Group = 'pages' | 'actions' | 'routine' | 'tasks' | 'vault'

interface Command {
  id: string
  group: Group
  label: string
  hint?: string
  icon: string
  keywords?: string
  run: () => void | Promise<void>
}

const GROUP_LABEL: Record<Group, string> = {
  pages: 'palette.groupPages',
  actions: 'palette.groupActions',
  routine: 'palette.groupRoutine',
  tasks: 'palette.groupTasks',
  vault: 'palette.groupVault'
}

const PAGES: { path: string; labelKey: string; icon: string; keywords: string }[] = [
  { path: '/daily', labelKey: 'nav.daily', icon: '☀', keywords: 'today routine checklist lich hom nay' },
  { path: '/', labelKey: 'nav.home', icon: '◧', keywords: 'dashboard home trang chu' },
  { path: '/vault', labelKey: 'nav.vault', icon: '⚿', keywords: 'credentials secrets kho bi mat' },
  { path: '/providers', labelKey: 'nav.providers', icon: '◈', keywords: 'opencode provider nha cung cap' },
  { path: '/autoclick', labelKey: 'nav.autoclick', icon: '◉', keywords: 'clicker key presser chuot phim' },
  {
    path: '/promptforge',
    labelKey: 'nav.promptforge',
    icon: '✦',
    keywords: 'prompt forge enhance rewrite openrouter chat cai thien cau lenh'
  },
  { path: '/social', labelKey: 'nav.social', icon: '✎', keywords: 'medium linkedin publish dang bai' },
  { path: '/notifications', labelKey: 'nav.notifications', icon: '🔔', keywords: 'alerts thong bao' },
  { path: '/settings', labelKey: 'nav.settings', icon: '☰', keywords: 'config appearance cai dat' }
]

async function must<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error ?? 'Unknown error')
  return result.data as T
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Simple subsequence/whole-word score — substring matches always win. */
function matchScore(query: string, haystack: string): number | null {
  const text = haystack.toLowerCase()
  const direct = text.indexOf(query)
  if (direct >= 0) return 100 - Math.min(direct, 40)
  let queryIndex = 0
  let gaps = 0
  let lastMatch = -1
  for (let index = 0; index < text.length && queryIndex < query.length; index++) {
    if (text[index] !== query[queryIndex]) continue
    if (lastMatch >= 0) gaps += index - lastMatch - 1
    lastMatch = index
    queryIndex++
  }
  return queryIndex === query.length ? 50 - Math.min(gaps, 40) : null
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [snapshot, setSnapshot] = useState<RoutineSnapshot | null>(null)
  const [providers, setProviders] = useState<ProviderWithCredentials[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    inputRef.current?.focus()

    let cancelled = false
    void Promise.all([
      window.api.config.get(),
      window.api.tasks.list(),
      window.api.routine.get(),
      window.api.credentials.list()
    ]).then(([configResult, taskResult, routineResult, credentialResult]) => {
      if (cancelled) return
      if (configResult.ok && configResult.data) setConfig(configResult.data)
      if (taskResult.ok && taskResult.data) setTasks(taskResult.data)
      if (routineResult.ok && routineResult.data) setSnapshot(routineResult.data)
      if (credentialResult.ok && credentialResult.data) setProviders(credentialResult.data)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = PAGES.map((page) => ({
      id: `page:${page.path}`,
      group: 'pages',
      label: t(page.labelKey),
      icon: page.icon,
      keywords: page.keywords,
      run: () => navigate(page.path)
    }))

    list.push({
      id: 'action:draft',
      group: 'actions',
      label: t('palette.actionDraft'),
      hint: t('palette.actionDraftHint'),
      icon: '✎',
      keywords: 'draft markdown scaffold bai giai',
      run: async () => {
        const file = await must(window.api.routine.createDraft())
        await must(window.api.routine.openDraft(file.path))
        pushToast({
          kind: 'ok',
          title: file.created ? t('daily.draftCreated') : t('daily.draftExists')
        })
        navigate('/daily')
      }
    })

    list.push({
      id: 'action:leetcode',
      group: 'actions',
      label: t('palette.actionLeetcode'),
      hint: t('palette.actionLeetcodeHint'),
      icon: '☀',
      keywords: 'leetcode challenge daily bai tap',
      run: async () => {
        const daily = await must(window.api.leetcode.getDaily())
        pushToast({ kind: 'ok', title: t('palette.leetcodeFetched'), body: daily.title })
        navigate('/daily')
      }
    })

    const accounts = config?.routine.browserCheckIns.filter((account) => account.enabled) ?? []
    list.push({
      id: 'action:check-ins',
      group: 'actions',
      label: t('palette.actionCheckIns'),
      hint: t('palette.actionCheckInsHint'),
      icon: '⚡',
      keywords: 'claim reward diem danh checkin',
      run: async () => {
        if (accounts.length === 0) throw new Error(t('palette.noCheckIns'))
        navigate('/daily')
        for (const account of accounts) {
          try {
            await must(window.api.routine.checkIn(account.id))
          } catch (error) {
            pushToast({
              kind: 'error',
              title: t('palette.checkInFailed', { name: account.name }),
              body: messageOf(error)
            })
          }
        }
        pushToast({ kind: 'ok', title: t('palette.checkInsDone', { count: accounts.length }) })
      }
    })

    list.push({
      id: 'action:mark-read',
      group: 'actions',
      label: t('palette.actionMarkRead'),
      icon: '✓',
      keywords: 'notifications read thong bao',
      run: async () => {
        await must(window.api.notifications.markRead('all'))
        pushToast({ kind: 'ok', title: t('palette.markedRead') })
      }
    })

    const nextTheme: ThemeMode = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
    list.push({
      id: 'action:theme',
      group: 'actions',
      label: nextTheme === 'light' ? t('palette.actionThemeLight') : t('palette.actionThemeDark'),
      hint: t('settings.accent'),
      icon: nextTheme === 'light' ? '☀' : '◐',
      keywords: 'theme dark light appearance giao dien',
      run: async () => {
        setAppearance({ theme: nextTheme, accent: appearance.accent })
        await must(window.api.config.set({ appearance: { theme: nextTheme } }))
      }
    })

    for (const step of snapshot?.steps ?? []) {
      if (snapshot?.state.steps[step.id]?.done) continue
      const title = step.kind === 'custom' ? step.title : t(`daily.step.${step.kind}.title`)
      list.push({
        id: `step:${step.id}`,
        group: 'routine',
        label: t('palette.completeStep', { title }),
        hint: step.kind === 'custom' ? step.description : t(`daily.step.${step.kind}.desc`),
        icon: '✓',
        keywords: 'routine step done lich buoc',
        run: async () => {
          await must(window.api.routine.setStep(step.id, true))
          pushToast({ kind: 'ok', title: t('palette.stepDone') })
        }
      })
    }

    for (const task of tasks) {
      const described = describeTask(t, task, config?.watchers ?? [])
      list.push({
        id: `task:${task.id}`,
        group: 'tasks',
        label: described.name,
        hint: t('palette.runTaskHint', { cron: task.cron }),
        icon: '▶',
        keywords: described.description,
        run: async () => {
          await must(window.api.tasks.runNow(task.id))
          pushToast({ kind: 'ok', title: t('palette.taskDone', { name: described.name }) })
        }
      })
    }

    for (const provider of providers) {
      for (const credential of provider.credentials) {
        list.push({
          id: `credential:${credential.id}`,
          group: 'vault',
          label: `${provider.name} · ${credential.identifier}`,
          hint: CREDENTIAL_TYPE_LABELS[credential.credentialType],
          icon: '⚿',
          keywords: credential.metadata.notes ?? '',
          run: () => navigate(`/vault?q=${encodeURIComponent(credential.identifier)}`)
        })
      }
    }

    return list
    // i18n.language keeps labels fresh after a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance.accent, config, i18n.language, navigate, providers, snapshot, t, tasks])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commands
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`
      return matchScore(normalized, haystack) !== null
    })
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(filtered.length - 1, 0))
  }, [active, filtered.length])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const execute = (command: Command): void => {
    onClose()
    void Promise.resolve()
      .then(() => command.run())
      .catch((error) => {
        pushToast({ kind: 'error', title: t('palette.actionFailed'), body: messageOf(error) })
      })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[active]
      if (command) execute(command)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.open')}>
        <div className="palette-search">
          <span className="palette-search-icon">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" ref={listRef} role="listbox" aria-label={t('palette.open')}>
          {filtered.length === 0 ? (
            <div className="palette-empty">{t('palette.empty')}</div>
          ) : (
            filtered.map((command, index) => (
              <Fragment key={command.id}>
                {(index === 0 || filtered[index - 1].group !== command.group) && (
                  <div className="palette-group">{t(GROUP_LABEL[command.group])}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={`palette-item ${index === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => execute(command)}
                >
                  <span className="palette-item-icon">{command.icon}</span>
                  <span className="palette-item-text">
                    <span className="palette-item-label">{command.label}</span>
                    {command.hint && <span className="palette-item-hint">{command.hint}</span>}
                  </span>
                  {index === active && <span className="palette-item-enter">↵</span>}
                </button>
              </Fragment>
            ))
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('palette.hintNavigate')}
          </span>
          <span>
            <kbd>↵</kbd> {t('palette.hintRun')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('palette.hintClose')}
          </span>
        </div>
      </div>
    </div>
  )
}
