import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  PromptForgeMessage,
  PromptForgeModel,
  PromptForgePlugin,
  PromptForgeRule,
  PromptForgeSession,
  PromptForgeState
} from '@shared/types'
import PromptForgeMarkdown from '../components/PromptForgeMarkdown'
import {
  PromptForgePluginsModal,
  PromptForgeRulesModal,
  PromptForgeSettingsModal
} from '../components/PromptForgeModals'
import '../styles/promptforge.css'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function titleFrom(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned || 'New chat'
}

export default function PromptForge() {
  const { t } = useTranslation()

  const [state, setState] = useState<PromptForgeState | null>(null)
  const stateRef = useRef<PromptForgeState | null>(null)
  const [models, setModels] = useState<PromptForgeModel[]>([])
  const [draft, setDraft] = useState('')
  const [enhancing, setEnhancing] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const streamIdRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const apply = useCallback((next: PromptForgeState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const patchSession = useCallback((id: string, updater: (session: PromptForgeSession) => PromptForgeSession) => {
    setState((prev) => {
      if (!prev) return prev
      const next: PromptForgeState = {
        ...prev,
        sessions: prev.sessions.map((session) => (session.id === id ? updater(session) : session))
      }
      stateRef.current = next
      return next
    })
  }, [])

  const persist = useCallback(async (session: PromptForgeSession) => {
    const res = await window.api.promptForge.saveSession(session)
    if (!res.ok) setError(res.error ?? 'Could not save this chat')
  }, [])

  const refreshModels = useCallback(async (): Promise<PromptForgeState | null> => {
    const res = await window.api.promptForge.refreshModels()
    if (!res.ok || !res.data) {
      if (res.error) setNotice(res.error)
      return null
    }
    setModels(res.data.models)
    apply(res.data.state)
    if (res.data.modelChanged && res.data.state.settings.defaultModel) {
      setNotice(t('promptforge.autoModelPicked', { model: res.data.state.settings.defaultModel }))
    }
    return res.data.state
  }, [apply, t])

  useEffect(() => {
    let cancelled = false
    void window.api.promptForge.state().then((res) => {
      if (cancelled) return
      if (!res.ok || !res.data) {
        setError(res.error ?? 'Could not load PromptForge')
        return
      }
      apply(res.data)
      if (res.data.settings.hasApiKey) void refreshModels()
      else setSettingsOpen(true)
    })
    return () => {
      cancelled = true
      if (streamIdRef.current) void window.api.promptForge.stop(streamIdRef.current)
    }
  }, [apply, refreshModels])

  const session = useMemo(
    () => state?.sessions.find((entry) => entry.id === state.activeSessionId) ?? null,
    [state]
  )

  const activeRules = useMemo(
    () => (state?.rules ?? []).filter((rule) => session?.activeRuleIds.includes(rule.id) ?? false),
    [state, session]
  )

  const activePlugins = useMemo(
    () => (state?.plugins ?? []).filter((plugin) => session?.activePluginIds.includes(plugin.id) ?? false),
    [state, session]
  )

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return state?.sessions ?? []
    return (state?.sessions ?? []).filter((entry) => entry.title.toLowerCase().includes(query))
  }, [search, state])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [session?.messages.length, streaming, enhancing])

  const effectiveModel = (session?.model ?? '').trim() || state?.settings.defaultModel || ''

  const selectSession = (id: string): void => {
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, activeSessionId: id }
      stateRef.current = next
      return next
    })
    void window.api.promptForge.setActiveSession(id)
  }

  const newChat = async (): Promise<void> => {
    let model = effectiveModel
    if (!model && state?.settings.autoFreeModel) {
      const refreshed = await refreshModels()
      model = refreshed?.settings.defaultModel ?? ''
    }
    const res = await window.api.promptForge.newSession(model)
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Could not create a chat')
      return
    }
    const created = res.data
    setState((prev) => {
      if (!prev) return prev
      const next: PromptForgeState = {
        ...prev,
        sessions: [created, ...prev.sessions],
        activeSessionId: created.id
      }
      stateRef.current = next
      return next
    })
    setDraft('')
  }

  const deleteSession = async (id: string): Promise<void> => {
    const res = await window.api.promptForge.deleteSession(id)
    if (res.ok && res.data) apply(res.data)
    else setError(res.error ?? 'Could not delete this chat')
  }

  const changeModel = (model: string): void => {
    if (!session) return
    const updated = { ...session, model }
    patchSession(session.id, () => updated)
    void persist(updated)
  }

  const toggleRule = async (ruleId: string): Promise<void> => {
    if (!session) return
    const ids = session.activeRuleIds.includes(ruleId)
      ? session.activeRuleIds.filter((id) => id !== ruleId)
      : [...session.activeRuleIds, ruleId]
    const updated = { ...session, activeRuleIds: ids }
    patchSession(session.id, () => updated)
    await persist(updated)
  }

  const togglePlugin = async (pluginId: string): Promise<void> => {
    if (!session) return
    const ids = session.activePluginIds.includes(pluginId)
      ? session.activePluginIds.filter((id) => id !== pluginId)
      : [...session.activePluginIds, pluginId]
    const updated = { ...session, activePluginIds: ids }
    patchSession(session.id, () => updated)
    await persist(updated)
  }

  const saveRule = async (rule: PromptForgeRule): Promise<void> => {
    const res = await window.api.promptForge.saveRule(rule)
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Could not save this rule')
      return
    }
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, rules: res.data as PromptForgeRule[] }
      stateRef.current = next
      return next
    })
  }

  const deleteRule = async (id: string): Promise<void> => {
    const res = await window.api.promptForge.deleteRule(id)
    if (res.ok && res.data) apply(res.data)
    else setError(res.error ?? 'Could not delete this rule')
  }

  const savePlugin = async (plugin: PromptForgePlugin): Promise<void> => {
    const res = await window.api.promptForge.savePlugin(plugin)
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Could not save this plugin')
      return
    }
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, plugins: res.data as PromptForgePlugin[] }
      stateRef.current = next
      return next
    })
  }

  const deletePlugin = async (id: string): Promise<void> => {
    const res = await window.api.promptForge.deletePlugin(id)
    if (res.ok && res.data) apply(res.data)
    else setError(res.error ?? 'Could not delete this plugin')
  }

  const saveSettings = async (patch: {
    apiKey?: string
    baseUrl?: string
    defaultModel?: string
    enchanterModel?: string
    autoFreeModel?: boolean
  }): Promise<void> => {
    if (patch.apiKey !== undefined) {
      if (patch.apiKey) {
        const valid = await window.api.promptForge.validateKey(patch.apiKey)
        if (!valid.ok || !valid.data) throw new Error(t('promptforge.invalidKey'))
      }
      const keyRes = await window.api.promptForge.setApiKey(patch.apiKey || null)
      if (!keyRes.ok || !keyRes.data) throw new Error(keyRes.error ?? 'Could not save the API key')
      apply(keyRes.data)
    }
    const rest: {
      baseUrl?: string
      defaultModel?: string
      enchanterModel?: string
      autoFreeModel?: boolean
    } = {
      ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
      ...(patch.defaultModel === undefined ? {} : { defaultModel: patch.defaultModel }),
      ...(patch.enchanterModel === undefined ? {} : { enchanterModel: patch.enchanterModel }),
      ...(patch.autoFreeModel === undefined ? {} : { autoFreeModel: patch.autoFreeModel })
    }
    if (Object.keys(rest).length > 0) {
      const res = await window.api.promptForge.setSettings(rest)
      if (!res.ok || !res.data) throw new Error(res.error ?? 'Could not save settings')
      apply(res.data)
    }
    // With free mode on, fetch the catalogue and let the main process pick.
    if (rest.autoFreeModel !== false && stateRef.current?.settings.hasApiKey) await refreshModels()
  }

  const streamAnswer = async (
    target: PromptForgeSession,
    ruleInstructions: string[],
    pluginAppends: string[]
  ): Promise<void> => {
    const assistant: PromptForgeMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    }
    const withAssistant: PromptForgeSession = { ...target, messages: [...target.messages, assistant] }
    patchSession(target.id, () => withAssistant)
    setStreaming(true)

    const messages = withAssistant.messages
      .filter((message) => message.id !== assistant.id)
      .map((message) =>
        message.role === 'user'
          ? { role: 'user' as const, content: message.enhancedContent ?? message.content }
          : { role: 'assistant' as const, content: message.content }
      )
      .filter((message) => message.content.trim().length > 0)

    const settle = (final: PromptForgeSession): void => {
      setStreaming(false)
      streamIdRef.current = null
      patchSession(target.id, () => final)
      void persist(final)
    }

    streamIdRef.current = window.api.promptForge.chat(
      { model: target.model.trim() || effectiveModel, messages, ruleInstructions, pluginAppends },
      {
        onChunk: (_delta, full) => {
          patchSession(target.id, (current) => ({
            ...current,
            messages: current.messages.map((message) =>
              message.id === assistant.id ? { ...message, content: full, isStreaming: true } : message
            )
          }))
        },
        onModel: (next) => {
          const current = stateRef.current?.sessions.find((entry) => entry.id === target.id)
          if (!current || current.model === next) return
          const updated = { ...current, model: next }
          patchSession(target.id, () => updated)
          void persist(updated)
          setNotice(t('promptforge.autoModelSwitched', { model: next }))
        },
        onDone: (full, aborted) => {
          const current = stateRef.current?.sessions.find((entry) => entry.id === target.id)
          if (!current) {
            setStreaming(false)
            streamIdRef.current = null
            return
          }
          settle({
            ...current,
            messages: current.messages.map((message) =>
              message.id === assistant.id
                ? { ...message, content: full || message.content, isStreaming: false }
                : message
            )
          })
          if (aborted) setNotice(t('promptforge.streamStopped'))
        },
        onError: (message) => {
          setError(message)
          const current = stateRef.current?.sessions.find((entry) => entry.id === target.id)
          if (!current) {
            setStreaming(false)
            streamIdRef.current = null
            return
          }
          settle({
            ...current,
            messages: current.messages.map((item) =>
              item.id === assistant.id
                ? {
                    ...item,
                    content: item.content || t('promptforge.errorReply'),
                    isStreaming: false,
                    error: message
                  }
                : item
            )
          })
        }
      }
    )
  }

  const send = async (): Promise<void> => {
    if (!state || !session) return
    const text = draft.trim()
    if (!text || enhancing || streaming) return
    if (!state.settings.hasApiKey) {
      setSettingsOpen(true)
      setNotice(t('promptforge.needKey'))
      return
    }
    let model = effectiveModel
    if (!model && state.settings.autoFreeModel) {
      const refreshed = await refreshModels()
      model = refreshed?.settings.defaultModel ?? stateRef.current?.settings.defaultModel ?? ''
    }
    if (!model) {
      setSettingsOpen(true)
      setNotice(t('promptforge.modelRequired'))
      return
    }

    setDraft('')
    setError(null)
    setNotice(null)

    const userMessage: PromptForgeMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    const base: PromptForgeSession = {
      ...session,
      model: session.model.trim() || model,
      title: session.messages.length === 0 ? titleFrom(text) : session.title,
      messages: [...session.messages, userMessage]
    }
    patchSession(session.id, () => base)
    await persist(base)

    const ruleInstructions = activeRules.map((rule) => rule.instruction)
    const pluginAppends = activePlugins.map((plugin) => plugin.promptAppend)

    setEnhancing(true)
    let enhanced: string | null = null
    try {
      const res = await window.api.promptForge.enhance({
        rawPrompt: text,
        model,
        ruleInstructions,
        pluginAppends
      })
      if (res.ok && res.data) enhanced = res.data
      else throw new Error(res.error ?? t('promptforge.enhanceFailed'))
    } catch (err) {
      setNotice(t('promptforge.enhanceFallback', { error: messageOf(err) }))
    } finally {
      setEnhancing(false)
    }

    const withEnhanced: PromptForgeSession = {
      ...base,
      messages: base.messages.map((message) =>
        message.id === userMessage.id && enhanced ? { ...message, enhancedContent: enhanced } : message
      )
    }
    patchSession(session.id, () => withEnhanced)
    await persist(withEnhanced)
    await streamAnswer(withEnhanced, ruleInstructions, pluginAppends)
  }

  const regenerate = async (messageId: string): Promise<void> => {
    if (!session || streaming || enhancing) return
    const index = session.messages.findIndex((message) => message.id === messageId)
    if (index < 0) return
    const base: PromptForgeSession = { ...session, messages: session.messages.slice(0, index) }
    patchSession(session.id, () => base)
    await persist(base)
    await streamAnswer(
      base,
      activeRules.map((rule) => rule.instruction),
      activePlugins.map((plugin) => plugin.promptAppend)
    )
  }

  const stopStream = (): void => {
    const id = streamIdRef.current
    if (id) void window.api.promptForge.stop(id)
  }

  return (
    <div className="page pf-page page-anim">
      <div className="pf-page-head">
        <div>
          <h1>{t('promptforge.title')}</h1>
          <p className="muted">{t('promptforge.subtitle')}</p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={() => setRulesOpen(true)}>
            🛡 {t('promptforge.rules')} · {activeRules.length}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPluginsOpen(true)}>
            🧩 {t('promptforge.plugins')} · {activePlugins.length}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSettingsOpen(true)}>
            ⚙ {t('promptforge.settings')}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button type="button" className="pf-alert-close" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className="alert alert-warn">
          {notice}
          <button type="button" className="pf-alert-close" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {!state ? (
        <div className="muted">{t('common.loading')}</div>
      ) : (
        <div className="pf-shell">
          <aside className="pf-rail">
            <div className="pf-rail-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void newChat()}>
                + {t('promptforge.newChat')}
              </button>
            </div>
            <input
              type="text"
              className="pf-search"
              value={search}
              placeholder={t('promptforge.searchChats')}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="pf-sessions">
              {filteredSessions.length === 0 && <p className="muted pf-empty-small">{t('promptforge.noChats')}</p>}
              {filteredSessions.map((entry) => (
                <div
                  key={entry.id}
                  className={`pf-session ${entry.id === state.activeSessionId ? 'active' : ''}`}
                >
                  <button type="button" className="pf-session-open" onClick={() => selectSession(entry.id)}>
                    <span className="pf-session-title">{entry.title}</span>
                    <span className="pf-session-meta">
                      {entry.messages.length} {t('promptforge.messages')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pf-session-delete"
                    title={t('promptforge.deleteChat')}
                    onClick={() => void deleteSession(entry.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <section className="pf-main">
            <div className="pf-chat-head">
              <strong className="pf-chat-title">{session?.title ?? t('promptforge.title')}</strong>
              <label className="pf-model">
                <span className="muted">{t('promptforge.model')}</span>
                <input
                  type="text"
                  list="pf-model-list-page"
                  value={session?.model ?? ''}
                  placeholder={
                    state.settings.autoFreeModel
                      ? state.settings.defaultModel || t('promptforge.autoPlaceholder')
                      : 'provider/model'
                  }
                  disabled={!session}
                  onChange={(event) => changeModel(event.target.value)}
                />
                <datalist id="pf-model-list-page">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.free ? `${model.name} · free` : model.name}
                    </option>
                  ))}
                </datalist>
              </label>
            </div>

            <div className="pf-thread">
              {!session ? (
                <div className="pf-empty">
                  <div className="pf-empty-mark">✦</div>
                  <h2>{t('promptforge.emptyTitle')}</h2>
                  <p className="muted">{t('promptforge.emptyDesc')}</p>
                  <button type="button" className="btn btn-primary" onClick={() => void newChat()}>
                    + {t('promptforge.newChat')}
                  </button>
                </div>
              ) : (
                <>
                  {session.messages.length === 0 && !enhancing && (
                    <div className="pf-empty">
                      <div className="pf-empty-mark">✦</div>
                      <h2>{t('promptforge.emptyTitle')}</h2>
                      <p className="muted">{t('promptforge.emptyDesc')}</p>
                    </div>
                  )}

                  {session.messages.map((message) =>
                    message.role === 'user' ? (
                      <div key={message.id} className="pf-msg pf-msg-user">
                        <div className="pf-bubble">{message.content}</div>
                        {message.enhancedContent && (
                          <div className="pf-enhanced">
                            <button
                              type="button"
                              className="pf-link"
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [message.id]: !prev[message.id] }))
                              }
                            >
                              ✦{' '}
                              {expanded[message.id]
                                ? t('promptforge.hideEnhanced')
                                : t('promptforge.showEnhanced')}
                            </button>
                            {expanded[message.id] && (
                              <div className="pf-enhanced-body">
                                <PromptForgeMarkdown content={message.enhancedContent} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div key={message.id} className="pf-msg pf-msg-assistant">
                        <div className="pf-avatar">PF</div>
                        <div className="pf-assistant-body">
                          {message.content ? (
                            <PromptForgeMarkdown content={message.content} />
                          ) : message.isStreaming ? (
                            <span className="pf-dots pulse">● ● ●</span>
                          ) : null}
                          {message.error && <p className="pf-msg-error">{message.error}</p>}
                          {message.isStreaming && message.content && <span className="pf-cursor" />}
                          {!message.isStreaming && message.content && (
                            <div className="pf-msg-actions">
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={streaming}
                                onClick={() => void regenerate(message.id)}
                              >
                                ↻ {t('promptforge.regenerate')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}

                  {enhancing && (
                    <div className="pf-msg pf-msg-assistant">
                      <div className="pf-avatar">PF</div>
                      <div className="pf-enhancing pulse">✦ {t('promptforge.enhancing')}</div>
                    </div>
                  )}
                </>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="pf-composer">
              <div className="pf-chips">
                {activeRules.map((rule) => (
                  <span key={rule.id} className="pf-chip">
                    🛡 {rule.name}
                  </span>
                ))}
                {activePlugins.map((plugin) => (
                  <span key={plugin.id} className="pf-chip">
                    🧩 {plugin.name}
                  </span>
                ))}
                {activeRules.length === 0 && activePlugins.length === 0 && (
                  <span className="muted pf-hint">{t('promptforge.noModifiers')}</span>
                )}
              </div>
              <div className="pf-input-row">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={draft}
                  disabled={!session || enhancing || streaming}
                  placeholder={t('promptforge.composerPlaceholder')}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                />
                {streaming ? (
                  <button type="button" className="btn btn-danger" onClick={stopStream}>
                    ■ {t('promptforge.stop')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!session || !draft.trim() || enhancing}
                    onClick={() => void send()}
                  >
                    {enhancing ? `✦ ${t('promptforge.enhancing')}` : `✦ ${t('promptforge.enhance')}`}
                  </button>
                )}
              </div>
              <p className="muted pf-hint">{t('promptforge.sendHint')}</p>
            </div>
          </section>
        </div>
      )}

      <PromptForgeSettingsModal
        open={settingsOpen}
        settings={
          state?.settings ?? {
            baseUrl: 'https://openrouter.ai/api/v1',
            defaultModel: '',
            enchanterModel: '',
            autoFreeModel: true,
            modelCheckedAt: 0,
            onboardingComplete: false,
            hasApiKey: false
          }
        }
        models={models}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onLoadModels={refreshModels}
        onError={(message) => setError(message)}
      />
      <PromptForgeRulesModal
        open={rulesOpen}
        rules={state?.rules ?? []}
        activeIds={session?.activeRuleIds ?? []}
        onClose={() => setRulesOpen(false)}
        onSave={saveRule}
        onDelete={deleteRule}
        onToggle={toggleRule}
      />
      <PromptForgePluginsModal
        open={pluginsOpen}
        plugins={state?.plugins ?? []}
        activeIds={session?.activePluginIds ?? []}
        onClose={() => setPluginsOpen(false)}
        onSave={savePlugin}
        onDelete={deletePlugin}
        onToggle={togglePlugin}
      />
    </div>
  )
}
