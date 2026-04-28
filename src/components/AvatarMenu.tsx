import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { providerLabel } from '../providers/presets';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import type { AgentInfo, AppConfig, ExecMode } from '../types';

interface Props {
  config: AppConfig;
  agents: AgentInfo[];
  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onOpenSettings: () => void;
  onRefreshAgents: () => void;
  onBack?: () => void;
}

/**
 * Compact avatar at the right of the project topbar. Click opens a dropdown
 * with current execution mode, the agent picker (when in daemon mode), and
 * a Settings entry — replaces the wide AgentPicker + env-pill row.
 */
export function AvatarMenu({
  config,
  agents,
  daemonLive,
  onModeChange,
  onAgentChange,
  onOpenSettings,
  onRefreshAgents,
  onBack,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const currentAgent = useMemo(
    () => agents.find((a) => a.id === config.agentId) ?? null,
    [agents, config.agentId],
  );

  const installedAgents = agents.filter((a) => a.available);

  return (
    <div className="avatar-menu" ref={wrapRef}>
      <button
        type="button"
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('avatar.title')}
      >
        <img
          src="/avatar.png"
          alt=""
          aria-hidden
          draggable={false}
          className="avatar-btn-photo"
        />
      </button>
      {open ? (
        <div className="avatar-popover" role="menu">
          <div className="avatar-popover-head">
            <span className="who">
              {config.mode === 'daemon'
                ? t('avatar.localCli')
                : providerLabel(config.provider)}
            </span>
            <span className="where">
              {config.mode === 'api'
                ? `${config.model}${config.baseUrl ? ` · ${safeHost(config.baseUrl)}` : ''}`
                : currentAgent
                  ? `${currentAgent.name}${currentAgent.version ? ` · ${currentAgent.version}` : ''}`
                  : t('avatar.noAgentSelected')}
            </span>
          </div>

          <button
            type="button"
            className="avatar-item"
            onClick={() => {
              onModeChange('daemon');
              if (!daemonLive) {
                // No daemon — let user know via settings page rather than
                // silently failing.
                setOpen(false);
                onOpenSettings();
              }
            }}
            disabled={!daemonLive && config.mode !== 'daemon'}
          >
            <span className="avatar-item-icon" aria-hidden>
              <Icon name="file-code" size={14} />
            </span>
            <span>{t('avatar.useLocal')}</span>
            {config.mode === 'daemon' ? (
              <span className="avatar-item-meta">{t('avatar.metaActive')}</span>
            ) : !daemonLive ? (
              <span className="avatar-item-meta">{t('avatar.metaOffline')}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="avatar-item"
            onClick={() => onModeChange('api')}
          >
            <span className="avatar-item-icon" aria-hidden>
              <Icon name="link" size={14} />
            </span>
            <span>{t('avatar.useApi')}</span>
            {config.mode === 'api' ? (
              <span className="avatar-item-meta">{t('avatar.metaActive')}</span>
            ) : null}
          </button>

          {config.mode === 'daemon' && installedAgents.length > 0 ? (
            <>
              <div
                style={{
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-faint)',
                  fontWeight: 600,
                  padding: '8px 10px 4px',
                }}
              >
                {t('avatar.codeAgent')}
              </div>
              {installedAgents.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="avatar-item"
                  onClick={() => {
                    onAgentChange(a.id);
                    setOpen(false);
                  }}
                >
                  <AgentIcon id={a.id} size={18} />
                  <span>{a.name}</span>
                  {config.agentId === a.id ? (
                    <span className="avatar-item-meta">
                      {t('avatar.metaSelected')}
                    </span>
                  ) : a.version ? (
                    <span className="avatar-item-meta">{a.version}</span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                className="avatar-item"
                onClick={() => {
                  onRefreshAgents();
                }}
              >
                <span className="avatar-item-icon" aria-hidden>
                  <Icon name="reload" size={14} />
                </span>
                <span>{t('avatar.rescan')}</span>
              </button>
            </>
          ) : null}

          <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 6px' }} />

          <button
            type="button"
            className="avatar-item"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            <span className="avatar-item-icon" aria-hidden>
              <Icon name="settings" size={14} />
            </span>
            <span>{t('avatar.settings')}</span>
          </button>
          {onBack ? (
            <button
              type="button"
              className="avatar-item"
              onClick={() => {
                setOpen(false);
                onBack();
              }}
            >
              <span className="avatar-item-icon" aria-hidden>
                <Icon name="arrow-left" size={14} />
              </span>
              <span>{t('avatar.backToProjects')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
