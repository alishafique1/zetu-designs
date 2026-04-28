import { useEffect, useMemo, useState } from 'react';
import { LOCALE_LABEL, LOCALES, useI18n } from '../i18n';
import type { Locale } from '../i18n';
import { PROVIDER_ORDER, PROVIDER_PRESETS } from '../providers/presets';
import { AgentIcon } from './AgentIcon';
import type { AgentInfo, AppConfig, ExecMode, ModelProvider } from '../types';

interface Props {
  initial: AppConfig;
  agents: AgentInfo[];
  daemonLive: boolean;
  welcome?: boolean;
  onSave: (cfg: AppConfig) => void;
  onClose: () => void;
  onRefreshAgents: () => void;
}

export function SettingsDialog({
  initial,
  agents,
  daemonLive,
  welcome,
  onSave,
  onClose,
  onRefreshAgents,
}: Props) {
  const { t, locale, setLocale } = useI18n();
  const [cfg, setCfg] = useState<AppConfig>(initial);
  const [showApiKey, setShowApiKey] = useState(false);

  // If the daemon goes offline mid-edit, force API mode so the UI doesn't
  // pretend Local CLI is selectable.
  useEffect(() => {
    if (!daemonLive && cfg.mode === 'daemon') {
      setCfg((c) => ({ ...c, mode: 'api' }));
    }
  }, [daemonLive, cfg.mode]);

  const installedCount = useMemo(
    () => agents.filter((a) => a.available).length,
    [agents],
  );

  const setMode = (mode: ExecMode) => setCfg((c) => ({ ...c, mode }));

  // Switching providers swaps in that provider's defaults, but preserves
  // any non-empty values the user already typed — they may have a custom
  // baseUrl (e.g. an OpenRouter URL while staying on the openai provider)
  // they don't want clobbered. Empty fields fall back to the preset.
  const setProvider = (provider: ModelProvider) => {
    setCfg((c) => {
      if (c.provider === provider) return c;
      const preset = PROVIDER_PRESETS[provider];
      return {
        ...c,
        provider,
        baseUrl: c.baseUrl?.trim() ? c.baseUrl : preset.baseUrl,
        model: c.model?.trim() ? c.model : preset.defaultModel,
      };
    });
  };

  const activePreset = PROVIDER_PRESETS[cfg.provider];

  const canSave =
    cfg.mode === 'daemon'
      ? Boolean(cfg.agentId && agents.find((a) => a.id === cfg.agentId)?.available)
      : Boolean(
          cfg.apiKey.trim() &&
            cfg.model.trim() &&
            // Azure has no global default base URL — require the user to
            // paste their resource endpoint. Other providers ship a usable
            // default so a blank field falls back to the preset.
            (cfg.provider === 'azure'
              ? cfg.baseUrl.trim().length > 0
              : true),
        );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-settings"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
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
              <div>
                <h3>{t('settings.apiSection')}</h3>
                <p className="hint">{t('settings.providerHint')}</p>
              </div>
            </div>
            <div
              className="seg-control"
              role="tablist"
              aria-label={t('settings.providerLabel')}
            >
              {PROVIDER_ORDER.map((id) => {
                const preset = PROVIDER_PRESETS[id];
                const active = cfg.provider === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={'seg-btn' + (active ? ' active' : '')}
                    onClick={() => setProvider(id)}
                    title={preset.blurb}
                  >
                    <span className="seg-title">{preset.label}</span>
                    <span className="seg-meta">{preset.blurb}</span>
                  </button>
                );
              })}
            </div>
            <label className="field">
              <span className="field-label">{t('settings.apiKey')}</span>
              <div className="field-row">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={activePreset.apiKeyPlaceholder}
                  value={cfg.apiKey}
                  onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
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
                placeholder={activePreset.defaultModel}
                onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              />
              <datalist id="suggested-models">
                {activePreset.modelSuggestions.map((m) => (
                  <option value={m} key={m} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span className="field-label">{t('settings.baseUrl')}</span>
              <input
                type="text"
                value={cfg.baseUrl}
                placeholder={activePreset.baseUrl || 'https://...'}
                onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
              />
            </label>
            {activePreset.needsApiVersion ? (
              <label className="field">
                <span className="field-label">{t('settings.apiVersion')}</span>
                <input
                  type="text"
                  value={cfg.apiVersion ?? ''}
                  placeholder="2024-08-01-preview"
                  onChange={(e) =>
                    setCfg({ ...cfg, apiVersion: e.target.value })
                  }
                />
                <span className="hint">{t('settings.apiVersionHint')}</span>
              </label>
            ) : null}
            <p className="hint">{t('settings.apiHint')}</p>
            <p className="hint">{t('settings.proxyHint')}</p>
          </section>
        )}

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
