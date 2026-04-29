/**
 * BillingSettings — full billing panel with 3 tabs: Plan, API Keys, Usage.
 */
import React, { useEffect, useState } from 'react';
import { UsageMeter } from './UsageMeter';
import type { UserBillingInfo } from '../state/billing';
import {
  createCheckoutSession,
  createPortalSession,
  deleteApiKey,
  fetchBillingInfo,
  fetchUsage,
  saveApiKey,
  switchPlatformMode,
} from '../state/billing';

type Tab = 'plan' | 'apikeys' | 'usage';

const PLAN_LIMITS: Record<string, number> = {
  free: 50,
  starter: 500,
  pro: 2000,
};

export function BillingSettings() {
  const [tab, setTab] = useState<Tab>('plan');
  const [info, setInfo] = useState<UserBillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usageData, setUsageData] = useState<any | null>(null);
  const [usagePeriod, setUsagePeriod] = useState('current');
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetchBillingInfo().then((data) => {
      setInfo(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (tab === 'usage') {
      fetchUsage(usagePeriod === 'current' ? undefined : usagePeriod).then(setUsageData);
    }
  }, [tab, usagePeriod]);

  async function handleUpgrade(plan: 'starter' | 'pro') {
    const url = await createCheckoutSession(plan);
    if (url) window.location.href = url;
  }

  async function handleManage() {
    const url = await createPortalSession();
    if (url) window.location.href = url;
  }

  async function handleTestAndSave(provider: string, apiKey: string) {
    setApiKeySaving(true);
    setApiKeyMsg(null);
    const ok = await saveApiKey(provider, apiKey);
    if (ok) {
      setApiKeyInput('');
      setApiKeyMsg({ ok: true, text: 'API key saved successfully.' });
      // Refresh billing info
      const updated = await fetchBillingInfo();
      setInfo(updated);
    } else {
      setApiKeyMsg({ ok: false, text: 'Failed to save API key. Please try again.' });
    }
    setApiKeySaving(false);
  }

  async function handleDeleteApiKey(provider: string) {
    const ok = await deleteApiKey(provider);
    if (ok) {
      const updated = await fetchBillingInfo();
      setInfo(updated);
    }
  }

  async function handleSwitchMode(mode: 'zetu' | 'byok') {
    setSwitching(true);
    await switchPlatformMode(mode);
    const updated = await fetchBillingInfo();
    setInfo(updated);
    setSwitching(false);
  }

  const limit = info ? (PLAN_LIMITS[info.plan] ?? 50) : 50;

  if (loading) {
    return <div className="billing-loading">Loading billing info…</div>;
  }

  if (!info) {
    return <div className="billing-error">Unable to load billing info.</div>;
  }

  return (
    <div className="billing-settings">
      <div className="billing-tabs" role="tablist">
        {(['plan', 'apikeys', 'usage'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`billing-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'plan' ? 'Plan' : t === 'apikeys' ? 'API Keys' : 'Usage'}
          </button>
        ))}
      </div>

      <div className="billing-tab-content" role="tabpanel">
        {tab === 'plan' && (
          <div className="billing-plan">
            <div className="billing-plan-badge">
              <span className={`plan-badge plan-${info.plan}`}>{info.plan.toUpperCase()}</span>
              <span className="plan-mode-badge">
                {info.platformMode === 'zetu' ? 'Zetu' : 'BYOK'}
              </span>
            </div>

            {info.plan === 'free' ? (
              <button className="billing-btn primary" onClick={() => handleUpgrade('starter')}>
                Upgrade to Starter
              </button>
            ) : (
              <button className="billing-btn secondary" onClick={handleManage}>
                Manage Subscription
              </button>
            )}

            {info.subscriptionStatus && (
              <p className="billing-sub-status">
                Status: <strong>{info.subscriptionStatus}</strong>
              </p>
            )}

            <div className="billing-mode-switch">
              <p className="billing-mode-label">Platform Mode</p>
              <div className="billing-mode-btns">
                <button
                  className={`mode-btn${info.platformMode === 'zetu' ? ' active' : ''}`}
                  onClick={() => handleSwitchMode('zetu')}
                  disabled={switching}
                >
                  Zetu
                </button>
                <button
                  className={`mode-btn${info.platformMode === 'byok' ? ' active' : ''}`}
                  onClick={() => handleSwitchMode('byok')}
                  disabled={switching}
                >
                  BYOK
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'apikeys' && (
          <div className="billing-apikeys">
            <p className="billing-apikey-note">
              5% platform fee applies to all generations when using your own API key.
            </p>

            {info.hasApiKey ? (
              <div className="billing-api-key-saved">
                <p className="billing-api-key-display">
                  API Key: •••• {info.hasApiKey ? '(saved)' : ''}
                </p>
                <button
                  className="billing-btn danger"
                  onClick={() => handleDeleteApiKey('anthropic')}
                >
                  Delete API Key
                </button>
              </div>
            ) : (
              <div className="billing-api-key-form">
                <label className="field">
                  <span className="field-label">Anthropic API Key</span>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="sk-ant-..."
                  />
                </label>
                <button
                  className="billing-btn primary"
                  onClick={() => handleTestAndSave('anthropic', apiKeyInput)}
                  disabled={apiKeySaving || !apiKeyInput.trim()}
                >
                  {apiKeySaving ? 'Testing…' : 'Test & Save'}
                </button>
                {apiKeyMsg && (
                  <p className={`billing-api-msg ${apiKeyMsg.ok ? 'ok' : 'error'}`}>
                    {apiKeyMsg.text}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'usage' && (
          <div className="billing-usage">
            <div className="billing-usage-period">
              <label className="field">
                <span className="field-label">Period</span>
                <select
                  value={usagePeriod}
                  onChange={(e) => setUsagePeriod(e.target.value)}
                >
                  <option value="current">Current Month</option>
                  <option value="last">Last Month</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="90d">Last 90 Days</option>
                </select>
              </label>
            </div>

            <UsageMeter used={info.generationsUsed} limit={info.generationsLimit} mode={info.platformMode} />

            {usageData && (
              <div className="billing-usage-breakdown">
                {usageData.tokensUsed !== undefined && (
                  <div className="usage-stat">
                    <span className="usage-stat-label">Tokens Used</span>
                    <span className="usage-stat-value">{usageData.tokensUsed.toLocaleString()}</span>
                  </div>
                )}
                {usageData.generations !== undefined && (
                  <div className="usage-stat">
                    <span className="usage-stat-label">Generations</span>
                    <span className="usage-stat-value">{usageData.generations.toLocaleString()}</span>
                  </div>
                )}
                {usageData.cost !== undefined && info.platformMode === 'byok' && (
                  <div className="usage-stat">
                    <span className="usage-stat-label">Est. Cost (BYOK)</span>
                    <span className="usage-stat-value">${usageData.cost.toFixed(4)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
