/**
 * Azure OpenAI streaming client. Wire format is OpenAI's (chat.completions
 * SSE), but the URL embeds the deployment name and an api-version query
 * string, and auth uses the `api-key` header rather than `Authorization:
 * Bearer`. We reuse streamChatCompletions() from openai.ts for the SSE
 * pump and only diverge on URL + headers.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';
import { streamChatCompletions } from './openai';

const DEFAULT_API_VERSION = '2024-08-01-preview';

export async function streamAzure(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  if (!cfg.apiKey) {
    handlers.onError(new Error('Missing Azure key — open Settings and paste one in.'));
    return;
  }
  if (!cfg.baseUrl) {
    handlers.onError(
      new Error('Missing Azure endpoint — set Base URL to https://<resource>.openai.azure.com.'),
    );
    return;
  }
  if (!cfg.model) {
    handlers.onError(
      new Error('Missing Azure deployment — set Model to your deployment name.'),
    );
    return;
  }

  const apiVersion = (cfg.apiVersion?.trim() || DEFAULT_API_VERSION);
  const url = buildAzureUrl(cfg.baseUrl, cfg.model, apiVersion);

  const body = {
    stream: true,
    max_tokens: 8192,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  await streamChatCompletions(url, cfg.apiKey, body, signal, handlers, 'azure');
}

function buildAzureUrl(baseUrl: string, deployment: string, apiVersion: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}
