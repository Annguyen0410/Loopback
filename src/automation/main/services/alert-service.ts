import { getConfig } from './app-config'
import { createLogger } from '../utils/logger'
import type { AlertEvents } from './alerts-types'

const log = createLogger('alerts')

export type { AlertEvents }

/**
 * Push an alert to external channels (Discord webhook / Telegram bot) so
 * important events (new tasks, dailies, check-in failures) reach the user's
 * phone even when the app is minimized or the PC is unattended.
 */
export async function sendAlert(title: string, body: string, event: keyof AlertEvents): Promise<void> {
  const alerts = getConfig().alerts
  if (!alerts?.events?.[event]) return

  const text = `**${title}**\n${body}`
  const jobs: Promise<void>[] = []

  if (alerts.discordWebhookUrl) {
    jobs.push(
      fetch(alerts.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
        signal: AbortSignal.timeout(10_000)
      })
        .then(async (res) => {
          if (!res.ok) log.error(`discord alert failed: HTTP ${res.status}`)
        })
        .catch((err) => log.error(`discord alert failed: ${err instanceof Error ? err.message : String(err)}`))
    )
  }

  if (alerts.telegramBotToken && alerts.telegramChatId) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${alerts.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: alerts.telegramChatId, text: `${title}\n${body}` }),
        signal: AbortSignal.timeout(10_000)
      })
        .then(async (res) => {
          if (!res.ok) log.error(`telegram alert failed: HTTP ${res.status}`)
        })
        .catch((err) => log.error(`telegram alert failed: ${err instanceof Error ? err.message : String(err)}`))
    )
  }

  await Promise.allSettled(jobs)
}

/** Fire-and-forget alert (never blocks the caller). */
export function queueAlert(title: string, body: string, event: keyof AlertEvents): void {
  void sendAlert(title, body, event)
}
