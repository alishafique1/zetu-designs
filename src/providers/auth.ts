/**
 * Clerk token wrapper for API calls.
 * Wraps Clerk's getToken() so every API call can attach Authorization: Bearer <token>.
 */
import { getToken } from '@clerk/nextjs';

export async function getClerkAuthToken(): Promise<string | null> {
  try {
    const token = await getToken();
    return token;
  } catch {
    return null;
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getClerkAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
