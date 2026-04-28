/**
 * Provider presets — the BYOK side of the app supports four wire formats
 * (Anthropic-native, OpenAI-compatible, Azure OpenAI, Google Generative
 * Language). Each one ships with a default base URL and a short list of
 * suggested model ids so the SettingsDialog datalist gives the user a
 * head-start. The presets stay deliberately conservative: a user pointing
 * an `openai` provider at LiteLLM / OpenRouter / DeepSeek just types a
 * different baseUrl + model, no code change required.
 *
 * AWS Bedrock and Google Vertex aren't first-class providers here. Both
 * require credential signing (SigV4 for AWS, GCP service-account JWT for
 * Vertex) which is unsafe to do from the browser with long-lived BYOK
 * credentials. The recommended path is to run LiteLLM (or a similar
 * proxy) server-side and point the `anthropic` or `openai` provider at
 * that proxy's URL — the provider chooser surfaces this guidance.
 */
import type { ModelProvider } from '../types';

export interface ProviderPreset {
  id: ModelProvider;
  // Display name shown in the chooser and the env meta line.
  label: string;
  // Short marketing-style line shown under the provider card.
  blurb: string;
  // Default base URL preloaded into the form when the user picks this
  // provider for the first time. Empty string means "the user must fill
  // it in" (Azure has no global default).
  baseUrl: string;
  // Suggested model id (datalist anchor). The user can type anything.
  defaultModel: string;
  // Suggestions surfaced in the model field's <datalist>.
  modelSuggestions: string[];
  // Placeholder hint for the api key field.
  apiKeyPlaceholder: string;
  // Whether the provider requires the Azure-specific apiVersion field.
  needsApiVersion?: boolean;
}

export const PROVIDER_PRESETS: Record<ModelProvider, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Direct to api.anthropic.com or any Anthropic-compatible proxy (LiteLLM, AWS Bedrock / GCP Vertex via proxy).',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    modelSuggestions: [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet-latest',
    ],
    apiKeyPlaceholder: 'sk-ant-...',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI-compatible',
    blurb: 'Any OpenAI /chat/completions endpoint — OpenAI, OpenRouter, LiteLLM proxy, DeepSeek, Groq, Together, Mistral.',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    modelSuggestions: [
      'gpt-4o',
      'gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    apiKeyPlaceholder: 'sk-...',
  },
  azure: {
    id: 'azure',
    label: 'Azure OpenAI',
    blurb: 'Azure-hosted deployments. Base URL is your resource endpoint; Model is the deployment name.',
    baseUrl: '',
    defaultModel: '',
    modelSuggestions: [],
    apiKeyPlaceholder: 'azure key',
    needsApiVersion: true,
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    blurb: 'Google Generative Language API — Gemini family, key from aistudio.google.com.',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    modelSuggestions: [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    apiKeyPlaceholder: 'AIza...',
  },
};

export const PROVIDER_ORDER: ModelProvider[] = [
  'anthropic',
  'openai',
  'azure',
  'google',
];

// True when the provider's wire format expects a deployment-specific URL
// rather than a generic baseUrl + path. Today only Azure qualifies — kept
// as a helper so callers don't have to memorize that.
export function providerLabel(provider: ModelProvider): string {
  return PROVIDER_PRESETS[provider]?.label ?? provider;
}
