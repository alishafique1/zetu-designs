/**
 * BYOK model router. Picks a streaming client based on cfg.provider so
 * the rest of the app can stay provider-agnostic. Adding a fifth provider
 * later means: add an entry to ModelProvider, add a presets row, add a
 * `stream<X>` function, and one more `case` here.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';
import { streamMessage as streamAnthropic } from './anthropic';
import { streamAzure } from './azure';
import { streamGoogle } from './google';
import { streamOpenAI } from './openai';

export async function streamModel(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  switch (cfg.provider) {
    case 'openai':
      return streamOpenAI(cfg, system, history, signal, handlers);
    case 'azure':
      return streamAzure(cfg, system, history, signal, handlers);
    case 'google':
      return streamGoogle(cfg, system, history, signal, handlers);
    case 'anthropic':
    default:
      return streamAnthropic(cfg, system, history, signal, handlers);
  }
}
