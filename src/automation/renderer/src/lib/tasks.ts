import type { TFunction } from 'i18next'
import type { TaskInfo, UrlWatcherConfig } from '@shared/types'

const WATCHER_PREFIX = 'watcher:'

/**
 * Task names/descriptions are built in the main process (English). Translate
 * the built-in ones here so task lists read correctly in every language.
 */
export function describeTask(
  t: TFunction,
  task: TaskInfo,
  watchers: UrlWatcherConfig[]
): { name: string; description: string } {
  if (task.id === 'leetcode-poll') {
    return { name: t('tasks.nameLeetcode'), description: t('tasks.descLeetcode') }
  }
  if (task.id === 'check-in-batch') {
    return { name: t('tasks.nameCheckIn'), description: t('tasks.descCheckIn') }
  }
  if (task.id === 'daily-routine') {
    return { name: t('tasks.nameDailyRoutine'), description: t('tasks.descDailyRoutine') }
  }
  if (task.id.startsWith(WATCHER_PREFIX)) {
    const watcher = watchers.find((entry) => entry.id === task.id.slice(WATCHER_PREFIX.length))
    if (!watcher) return { name: task.name, description: task.description }
    const description =
      watcher.mode === 'gmail'
        ? t('tasks.descWatcherGmail', { url: watcher.url })
        : watcher.keyword?.trim()
          ? t('tasks.descWatcherKeyword', { keyword: watcher.keyword.trim(), url: watcher.url })
          : t('tasks.descWatcherHash', { url: watcher.url })
    return { name: t('tasks.nameWatcher', { name: watcher.name }), description }
  }
  return { name: task.name, description: task.description }
}
