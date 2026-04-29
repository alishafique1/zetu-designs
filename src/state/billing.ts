/**
 * Billing state management — all functions include Clerk auth headers.
 */
import { authHeaders } from '../providers/auth';

export interface UserBillingInfo {
  userId: string;
  email: string;
  plan: 'free' | 'starter' | 'pro';
  platformMode: 'zetu' | 'byok';
  generationsUsed: number;
  generationsLimit: number;
  hasApiKey: boolean;
  stripeCustomerId?: string;
  subscriptionStatus?: string;
}

export async function fetchBillingInfo(): Promise<UserBillingInfo | null> {
  const resp = await fetch('/api/user/me', { headers: await authHeaders() });
  if (!resp.ok) return null;
  return resp.json();
}

export async function fetchUsage(period?: string): Promise<any | null> {
  const url = period ? `/api/user/usage?period=${period}` : '/api/user/usage';
  const resp = await fetch(url, { headers: await authHeaders() });
  if (!resp.ok) return null;
  return resp.json();
}

export async function saveApiKey(provider: string, apiKey: string): Promise<boolean> {
  const resp = await fetch('/api/user/api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ provider, apiKey }),
  });
  return resp.ok;
}

export async function deleteApiKey(provider: string): Promise<boolean> {
  const resp = await fetch(`/api/user/api-key?provider=${provider}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return resp.ok;
}

export async function switchPlatformMode(mode: 'zetu' | 'byok'): Promise<boolean> {
  const resp = await fetch('/api/user/platform-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ mode }),
  });
  return resp.ok;
}

export async function createCheckoutSession(plan: 'starter' | 'pro'): Promise<string | null> {
  const resp = await fetch(`/api/billing/checkout?plan=${plan}`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.url || null;
}

export async function createPortalSession(): Promise<string | null> {
  const resp = await fetch('/api/billing/portal', {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.url || null;
}
