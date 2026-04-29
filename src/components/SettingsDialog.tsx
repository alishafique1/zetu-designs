import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LOCALE_LABEL, LOCALES, useI18n } from '../i18n';
import type { Locale } from '../i18n';
import type { Dict } from '../i18n/types';
import { MEDIA_PROVIDERS } from '../media/models';
import type { MediaProvider, MediaProviderId } from '../media/models';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import type {
  AgentInfo,
  AppConfig,
  ExecMode,
  MediaProviderCredentials,
} from '../types';

interface Props {
  initial: AppConfig;
  agents: AgentInfo[];
  daemonLive: boolean;
  welcome?: boolean;
  // Pre-select a tab on open. Used when other surfaces (e.g. the model
  // picker in NewProjectPanel) deep-link the user into a specific
  // section like 'media' to fix a missing key.
  initialTab?: SettingsTab;
  onSave: (cfg: AppConfig) => void;
  onClose: () => void;
  onRefreshAgents: () => void;
}

const SUGGESTED_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
];

// The settings dialog is split into vertically-stacked sections that
// were previously rendered in one long scrolling column. To keep each
// section scannable we now expose them as side-rail tabs (Execution /
// Media / Language) — same pattern as macOS native settings panes.
export type SettingsTab = 'execution' | 'media' | 'language';

const TABS: Array<{
  id: SettingsTab;
  icon: 'sliders' | 'image' | 'sparkles';
  labelKey: keyof Dict;
  hintKey: keyof Dict;
}> = [
  {
    id: 'execution',
    icon: 'sliders',
    labelKey: 'settings.tabExecution',
    hintKey: 'settings.tabExecutionHint',
  },
  {
    id: 'media',
    icon: 'image',
    labelKey: 'settings.tabMedia',
    hintKey: 'settings.tabMediaHint',
  },
  {
    id: 'language',
    icon: 'sparkles',
    labelKey: 'settings.tabLanguage',
    hintKey: 'settings.tabLanguageHint',
  },
];

export function SettingsDialog({
  initial,
  agents,
  daemonLive,
  welcome,
  initialTab,
  onSave,
  onClose,
  onRefreshAgents,
}: Props) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AppConfig>(initial);
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'execution');
  const panelRef = useRef<HTMLDivElement>(null);

  // If the daemon goes offline mid-edit, force API mode so the UI doesn't
  // pretend Local CLI is selectable.
  useEffect(() => {
    if (!daemonLive && cfg.mode === 'daemon') {
      setCfg((c) => ({ ...c, mode: 'api' }));
    }
  }, [daemonLive, cfg.mode]);

  // Reset the content panel scroll position whenever the user switches
  // tabs — without this, opening a long Media tab and then jumping to
  // Language leaves the new (short) panel scrolled past the start.
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
  }, [tab]);

  const canSave =
    cfg.mode === 'daemon'
      ? Boolean(cfg.agentId && agents.find((a) => a.id === cfg.agentId)?.available)
      : Boolean(cfg.apiKey.trim() && cfg.model.trim() && cfg.baseUrl.trim());

  // Surface a "configured" dot on the Media tab when the user has at
  // least one provider key set — it's a tiny affordance but it answers
  // "did I save my key?" without making the user click in to check.
  const mediaConfiguredCount = useMemo(() => {
    const map = cfg.mediaProviders ?? {};
    let n = 0;
    for (const v of Object.values(map)) {
      if (v && typeof v.apiKey === 'string' && v.apiKey.trim()) n += 1;
    }
    return n;
  }, [cfg.mediaProviders]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-settings"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head modal-head-settings">
          {welcome ? (
            <>
              <span className="kicker">{t('settings.welcomeKicker')}</span>
              <h2>{t('settings.welcomeTitle')}</h2>
              <p className="subtitle">{t('settings.welcomeSubtitle')}</p>
            </>
          ) : (
            <>
              <span className="kicker">{t('settings.kicker')}</span>
              <h2>{t('settings.title')}</h2>
              <p className="subtitle">{t('settings.subtitle')}</p>
            </>
          )}
        </header>

        <div className="modal-settings-body">
          <nav
            className="modal-settings-nav"
            role="tablist"
            aria-label={t('settings.tabsAria')}
          >
            {TABS.map((entry) => {
              const active = tab === entry.id;
              const badge =
                entry.id === 'media' && mediaConfiguredCount > 0
                  ? mediaConfiguredCount
                  : undefined;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={'modal-settings-tab' + (active ? ' active' : '')}
                  onClick={() => setTab(entry.id)}
                >
                  <Icon name={entry.icon} size={15} className="modal-settings-tab-icon" />
                  <span className="modal-settings-tab-text">
                    <span className="modal-settings-tab-name">
                      {t(entry.labelKey)}
                    </span>
                    <span className="modal-settings-tab-hint">
                      {t(entry.hintKey)}
                    </span>
                  </span>
                  {badge != null ? (
                    <span className="modal-settings-tab-badge">{badge}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="modal-settings-panel" role="tabpanel" ref={panelRef}>
            {tab === 'execution' ? (
              <ExecutionPanel
                cfg={cfg}
                setCfg={setCfg}
                agents={agents}
                daemonLive={daemonLive}
                onRefreshAgents={onRefreshAgents}
              />
            ) : null}
            {tab === 'media' ? (
              <MediaProvidersSection cfg={cfg} setCfg={setCfg} />
            ) : null}
            {tab === 'language' ? <LanguageSection /> : null}
          </div>
        </div>

        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={onClose}>
            {welcome ? t('settings.skipForNow') : t('common.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSave}
            onClick={() => onSave(cfg)}
          >
            {welcome ? t('settings.getStarted') : t('common.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ============================================================
   Execution panel — mode toggle + agent picker / API config.
   ============================================================ */
function ExecutionPanel({
  cfg,
  setCfg,
  agents,
  daemonLive,
  onRefreshAgents,
}: {
  cfg: AppConfig;
  setCfg: (next: AppConfig | ((c: AppConfig) => AppConfig)) => void;
  agents: AgentInfo[];
  daemonLive: boolean;
  onRefreshAgents: () => void;
}) {
  const { t } = useI18n();
  const [showApiKey, setShowApiKey] = useState(false);
  const installedCount = useMemo(
    () => agents.filter((a) => a.available).length,
    [agents],
  );
  const setMode = (mode: ExecMode) => setCfg((c) => ({ ...c, mode }));

  return (
    <Panel>
      <div
        className="seg-control"
        role="tablist"
        aria-label={t('settings.modeAria')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={cfg.mode === 'daemon'}
          className={'seg-btn' + (cfg.mode === 'daemon' ? ' active' : '')}
          disabled={!daemonLive}
          onClick={() => setMode('daemon')}
          title={
            daemonLive
              ? t('settings.modeDaemonHelp')
              : t('settings.modeDaemonOffline')
          }
        >
          <span className="seg-title">{t('settings.modeDaemon')}</span>
          <span className="seg-meta">
            {daemonLive
              ? t('settings.modeDaemonInstalledMeta', { count: installedCount })
              : t('settings.modeDaemonOfflineMeta')}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={cfg.mode === 'api'}
          className={'seg-btn' + (cfg.mode === 'api' ? ' active' : '')}
          onClick={() => setMode('api')}
        >
          <span className="seg-title">{t('settings.modeApi')}</span>
          <span className="seg-meta">{t('settings.modeApiMeta')}</span>
        </button>
      </div>

      {cfg.mode === 'daemon' ? (
        <section className="settings-section">
          <div className="section-head">
            <div>
              <h3>{t('settings.codeAgent')}</h3>
              <p className="hint">{t('settings.codeAgentHint')}</p>
            </div>
            <button
              type="button"
              className="ghost icon-btn"
              onClick={onRefreshAgents}
              title={t('settings.rescanTitle')}
            >
              {t('settings.rescan')}
            </button>
          </div>
          {agents.length === 0 ? (
            <div className="empty-card">
              {t('settings.noAgentsDetected')}
            </div>
          ) : (
            <div className="agent-grid">
              {agents.map((a) => {
                const active = cfg.agentId === a.id;
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={
                      'agent-card' +
                      (active ? ' active' : '') +
                      (a.available ? '' : ' disabled')
                    }
                    onClick={() =>
                      a.available && setCfg((c) => ({ ...c, agentId: a.id }))
                    }
                    disabled={!a.available}
                    aria-pressed={active}
                  >
                    <AgentIcon id={a.id} size={40} />
                    <div className="agent-card-body">
                      <div className="agent-card-name">{a.name}</div>
                      <div className="agent-card-meta">
                        {a.available ? (
                          a.version ? (
                            <span title={a.path ?? ''}>{a.version}</span>
                          ) : (
                            <span title={a.path ?? ''}>
                              {t('common.installed')}
                            </span>
                          )
                        ) : (
                          <span className="muted">
                            {t('common.notInstalled')}
                          </span>
                        )}
                      </div>
                    </div>
                    {a.available ? (
                      <span
                        className={'status-dot' + (active ? ' active' : '')}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="settings-section">
          <div className="section-head">
            <h3>{t('settings.apiSection')}</h3>
          </div>
          <label className="field">
            <span className="field-label">{t('settings.apiKey')}</span>
            <div className="field-row">
              <input
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-ant-..."
                value={cfg.apiKey}
                onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))}
                autoFocus
              />
              <button
                type="button"
                className="ghost icon-btn"
                onClick={() => setShowApiKey((v) => !v)}
                title={
                  showApiKey ? t('settings.hideKey') : t('settings.showKey')
                }
              >
                {showApiKey ? t('settings.hide') : t('settings.show')}
              </button>
            </div>
          </label>
          <label className="field">
            <span className="field-label">{t('settings.model')}</span>
            <input
              type="text"
              value={cfg.model}
              list="suggested-models"
              onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
            />
            <datalist id="suggested-models">
              {SUGGESTED_MODELS.map((m) => (
                <option value={m} key={m} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">{t('settings.baseUrl')}</span>
            <input
              type="text"
              value={cfg.baseUrl}
              onChange={(e) => setCfg((c) => ({ ...c, baseUrl: e.target.value }))}
            />
          </label>
          <p className="hint">{t('settings.apiHint')}</p>
        </section>
      )}
    </Panel>
  );
}

/* ============================================================
   Language panel — interface locale toggle.
   ============================================================ */
function LanguageSection() {
  const { t, locale, setLocale } = useI18n();
  return (
    <Panel>
      <section className="settings-section">
        <div className="section-head">
          <div>
            <h3>{t('settings.language')}</h3>
            <p className="hint">{t('settings.languageHint')}</p>
          </div>
        </div>
        <div
          className="seg-control"
          role="tablist"
          aria-label={t('settings.language')}
        >
          {LOCALES.map((code) => {
            const active = locale === code;
            return (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={active}
                className={'seg-btn' + (active ? ' active' : '')}
                onClick={() => setLocale(code as Locale)}
              >
                <span className="seg-title">{LOCALE_LABEL[code]}</span>
                <span className="seg-meta">{code}</span>
              </button>
            );
          })}
        </div>
      </section>
    </Panel>
  );
}

/* ============================================================
   Media providers — keys for image / video / audio dispatchers.
   We render every provider in MEDIA_PROVIDERS so the user sees
   the full surface area of what lobehub-class image/video models
   need; "integrated" providers ship real upstream calls today,
   the rest are explicitly labelled as stubs so users know what
   they're getting before they paste a secret in.
   ============================================================ */
function MediaProvidersSection({
  cfg,
  setCfg,
}: {
  cfg: AppConfig;
  setCfg: (next: AppConfig | ((c: AppConfig) => AppConfig)) => void;
}) {
  const { t } = useI18n();
  // Default to showing every provider — this view is the user's full
  // surface area for configuring keys, so hiding most of it behind a
  // toggle made the section feel intentionally opinionated. The Hide
  // button is still here for users who only care about the integrated
  // pair (OpenAI + Volcengine) and want to scan past the rest.
  const [showAdvanced, setShowAdvanced] = useState(true);

  // Stable list ordering: integrated providers first, then stubs.
  const ordered = useMemo(() => {
    const arr = [...MEDIA_PROVIDERS].filter((p) => p.id !== 'stub');
    arr.sort((a, b) => Number(b.integrated) - Number(a.integrated));
    return arr;
  }, []);

  const visible = useMemo(
    () => (showAdvanced ? ordered : ordered.filter((p) => p.integrated)),
    [ordered, showAdvanced],
  );

  function update(id: MediaProviderId, patch: Partial<MediaProviderCredentials>) {
    setCfg((curr) => {
      const map = { ...(curr.mediaProviders ?? {}) };
      const prev = map[id] ?? { apiKey: '', baseUrl: '' };
      const next = { ...prev, ...patch };
      // Drop the entry entirely once both fields are blank — keeps the
      // localStorage payload tidy.
      if (!next.apiKey && !next.baseUrl) {
        delete map[id];
      } else {
        map[id] = next;
      }
      return { ...curr, mediaProviders: map };
    });
  }

  return (
    <Panel>
      <section className="settings-section">
        <div className="section-head">
          <div>
            <h3>{t('settings.mediaProviders')}</h3>
            <p className="hint">{t('settings.mediaProvidersHint')}</p>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced
              ? t('settings.mediaSectionCollapse')
              : t('settings.mediaSectionExpand')}
          </button>
        </div>
        <div className="media-provider-list">
          {visible.map((provider) => {
            const entry = cfg.mediaProviders?.[provider.id] ?? {
              apiKey: '',
              baseUrl: '',
            };
            return (
              <MediaProviderRow
                key={provider.id}
                provider={provider}
                value={entry}
                onChange={(patch) => update(provider.id, patch)}
              />
            );
          })}
        </div>
      </section>
    </Panel>
  );
}

function MediaProviderRow({
  provider,
  value,
  onChange,
}: {
  provider: MediaProvider;
  value: MediaProviderCredentials;
  onChange: (patch: Partial<MediaProviderCredentials>) => void;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const configured = value.apiKey.trim().length > 0;
  const integrated = provider.integrated;
  return (
    <div className={`media-provider-row${integrated ? '' : ' pending'}`}>
      <div className="media-provider-head">
        <div className="media-provider-meta">
          <span className="media-provider-name">{provider.label}</span>
          <span className="media-provider-hint">{provider.hint}</span>
        </div>
        <div className="media-provider-badges">
          <span
            className={`media-provider-badge ${integrated ? 'ok' : 'pending'}`}
          >
            {integrated
              ? t('settings.mediaProviderIntegrated')
              : t('settings.mediaProviderPending')}
          </span>
          <span
            className={`media-provider-badge ${configured ? 'on' : 'off'}`}
          >
            {configured
              ? t('settings.mediaProviderConfigured')
              : t('settings.mediaProviderUnset')}
          </span>
        </div>
      </div>
      <div className="media-provider-body">
        <div className="field-row">
          <input
            type={show ? 'text' : 'password'}
            placeholder={t('settings.mediaProviderPlaceholder')}
            value={value.apiKey}
            aria-label={`${provider.label} ${t('settings.mediaProviderApiKey')}`}
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => setShow((v) => !v)}
          >
            {show ? t('settings.hide') : t('settings.show')}
          </button>
          {value.apiKey ? (
            <button
              type="button"
              className="ghost icon-btn"
              onClick={() => onChange({ apiKey: '' })}
            >
              {t('settings.mediaProviderClear')}
            </button>
          ) : null}
        </div>
        {provider.defaultBaseUrl ? (
          <input
            className="media-provider-baseurl"
            type="text"
            placeholder={
              provider.defaultBaseUrl
              || t('settings.mediaProviderBaseUrlPlaceholder')
            }
            value={value.baseUrl}
            aria-label={`${provider.label} ${t('settings.mediaProviderBaseUrl')}`}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
          />
        ) : null}
        {provider.docsUrl ? (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="media-provider-docs"
          >
            {t('settings.mediaProviderDocs')}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Shared wrapper around each tab's content. Keeps the gap + bounded
 * height consistent across panels so the side rail height matches.
 */
function Panel({ children }: { children: ReactNode }) {
  return <div className="modal-settings-panel-inner">{children}</div>;
}
