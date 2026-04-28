/**
 * OpenAI-compatible streaming client. Covers any endpoint that speaks the
 * `/chat/completions` SSE wire format — OpenAI proper, OpenRouter,
 * LiteLLM proxy, DeepSeek, Groq, Together, Mistral. Azure has its own
 * URL shape and lives in azure.ts.
 *
 * Browser fetch is fine here for the same BYOK reason streamMessage()
 * uses dangerouslyAllowBrowser: this is a local-first tool, the key is
 * the user's, it never leaves their machine. Move to a server proxy if
 * you ever ship a hosted build.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';

export async function streamOpenAI(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  if (!cfg.apiKey) {
    handlers.onError(new Error('Missing API key — open Settings and paste one in.'));
    return;
  }
  if (!cfg.baseUrl) {
    handlers.onError(new Error('Missing base URL — open Settings and set one.'));
    return;
  }

  const url = joinUrl(cfg.baseUrl, '/chat/completions');
  const body = {
    model: cfg.model,
    stream: true,
    max_tokens: 8192,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  await streamChatCompletions(url, cfg.apiKey, body, signal, handlers, 'bearer');
}

// Shared SSE pump between the OpenAI and Azure clients — they only differ
// in URL shape and auth header.
export async function streamChatCompletions(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  handlers: StreamHandlers,
  auth: 'bearer' | 'azure',
): Promise<void> {
  let acc = '';
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
    else headers['api-key'] = apiKey;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      handlers.onError(new Error(`upstream ${resp.status}: ${text || 'no body'}`));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line. Split on \n\n; the trailing
      // partial frame stays in buf for the next iteration.
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!frame) continue;
        // Each frame is one or more `data: ...` lines plus optional
        // `event:` / comments. We only care about `data:` payloads.
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = extractDelta(parsed);
          if (delta) {
            acc += delta;
            handlers.onDelta(delta);
          }
        }
      }
    }
    handlers.onDone(acc);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function extractDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { delta?: { content?: unknown }; text?: unknown };
  if (first?.delta && typeof first.delta.content === 'string') {
    return first.delta.content;
  }
  // Some legacy / completion-style proxies emit `text` instead of delta.
  if (typeof first?.text === 'string') return first.text;
  return '';
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
