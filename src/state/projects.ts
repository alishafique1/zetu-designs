// Project / conversation / message / tab persistence — backed by the
// daemon's SQLite store. All writes round-trip through HTTP so projects
// stay coherent across multiple browser tabs and across restarts.
//
// These helpers fail soft (returning null / [] on transport errors) so
// the UI can stay rendered when the daemon is briefly unreachable.

import type {
  ChatMessage,
  Conversation,
  OpenTabsState,
  Project,
  ProjectMetadata,
  ProjectTemplate,
} from '../types';
import { authHeaders } from '../providers/auth';

function parseMetadata(raw: unknown): ProjectMetadata | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw as ProjectMetadata;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object'
        ? (parsed as ProjectMetadata)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function toMillis(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeProject(raw: any): Project {
  return {
    id: String(raw.id),
    name: String(raw.name ?? 'Untitled'),
    skillId: raw.skillId ?? raw.skill_id ?? null,
    designSystemId: raw.designSystemId ?? raw.design_system_id ?? null,
    createdAt: toMillis(raw.createdAt ?? raw.created_at),
    updatedAt: toMillis(raw.updatedAt ?? raw.updated_at),
    pendingPrompt: raw.pendingPrompt ?? raw.pending_prompt ?? undefined,
    metadata: parseMetadata(raw.metadata ?? raw.metadata_json),
  };
}

function parseTemplateFiles(raw: unknown): Array<{ name: string; content: string }> {
  if (Array.isArray(raw)) {
    return raw
      .filter((f) => f && typeof f === 'object')
      .map((f: any) => ({
        name: String(f.name ?? ''),
        content: String(f.content ?? ''),
      }))
      .filter((f) => f.name.length > 0);
  }
  if (typeof raw === 'string') {
    try {
      return parseTemplateFiles(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeTemplate(raw: any): ProjectTemplate {
  return {
    id: String(raw.id),
    name: String(raw.name ?? 'Untitled template'),
    sourceProjectId: raw.sourceProjectId ?? raw.source_project_id ?? undefined,
    files: parseTemplateFiles(raw.files ?? raw.filesJson ?? raw.files_json),
    description: raw.description ?? undefined,
    createdAt: toMillis(raw.createdAt ?? raw.created_at),
  };
}

export async function listProjects(): Promise<Project[]> {
  try {
    const resp = await fetch('/api/projects', { headers: await authHeaders() });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { projects: any[] };
    return (json.projects ?? []).map(normalizeProject);
  } catch {
    return [];
  }
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { project: any };
    if (!json.project) return null;
    return normalizeProject(json.project);
  } catch {
    return null;
  }
}

export async function createProject(input: {
  name: string;
  skillId: string | null;
  designSystemId: string | null;
  pendingPrompt?: string;
  metadata?: ProjectMetadata;
}): Promise<{ project: Project; conversationId: string } | null> {
  try {
    const id = crypto.randomUUID();
    const resp = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        id,
        ...input,
        skill_id: input.skillId ?? null,
        design_system_id: input.designSystemId ?? null,
        pending_prompt: input.pendingPrompt ?? null,
      }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { project: any; conversationId: string };
    if (!json.project) return null;
    return { project: normalizeProject(json.project), conversationId: json.conversationId };
  } catch {
    return null;
  }
}

export async function importClaudeDesignZip(
  file: File,
): Promise<{ project: Project; conversationId: string; entryFile: string } | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch('/api/import/claude-design', {
      method: 'POST',
      headers: { ...(await authHeaders()) },
      body: form,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as {
      project: Project;
      conversationId: string;
      entryFile: string;
    };
  } catch {
    return null;
  }
}

// ---------- templates ----------

export async function listTemplates(): Promise<ProjectTemplate[]> {
  try {
    const resp = await fetch('/api/templates', { headers: await authHeaders() });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { templates: any[] };
    return (json.templates ?? []).map(normalizeTemplate);
  } catch {
    return [];
  }
}

export async function getTemplate(id: string): Promise<ProjectTemplate | null> {
  try {
    const resp = await fetch(`/api/templates/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { template: any };
    if (!json.template) return null;
    return normalizeTemplate(json.template);
  } catch {
    return null;
  }
}

export async function saveTemplate(input: {
  name: string;
  description?: string;
  sourceProjectId: string;
}): Promise<ProjectTemplate | null> {
  try {
    const resp = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        ...input,
        source_project_id: input.sourceProjectId,
      }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { template: any };
    if (!json.template) return null;
    return normalizeTemplate(json.template);
  } catch {
    return null;
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function patchProject(
  id: string,
  patch: Partial<Project>,
): Promise<Project | null> {
  try {
    const body: Record<string, unknown> = { ...patch };
    if (patch.pendingPrompt !== undefined) {
      body.pending_prompt = patch.pendingPrompt;
    }
    if (patch.updatedAt !== undefined) {
      body.updated_at = patch.updatedAt;
    }
    if (patch.metadata !== undefined) {
      body.metadata = patch.metadata;
    }
    const resp = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { project: any };
    if (!json.project) return null;
    return normalizeProject(json.project);
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------- conversations ----------

export async function listConversations(
  projectId: string,
): Promise<Conversation[]> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
      { headers: await authHeaders() },
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { conversations: Conversation[] };
    return json.conversations ?? [];
  } catch {
    return [];
  }
}

export async function createConversation(
  projectId: string,
  title?: string,
): Promise<Conversation | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ title }),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { conversation: Conversation };
    return json.conversation;
  } catch {
    return null;
  }
}

export async function patchConversation(
  projectId: string,
  conversationId: string,
  patch: Partial<Conversation>,
): Promise<Conversation | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(patch),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { conversation: Conversation };
    return json.conversation;
  } catch {
    return null;
  }
}

export async function deleteConversation(
  projectId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE', headers: await authHeaders() },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------- messages ----------

export async function listMessages(
  projectId: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { messages: ChatMessage[] };
    return json.messages ?? [];
  } catch {
    return [];
  }
}

export async function saveMessage(
  projectId: string,
  conversationId: string,
  message: ChatMessage,
): Promise<void> {
  try {
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
  } catch {
    // best-effort persistence — UI keeps the message in-memory either way
  }
}

// ---------- tabs ----------

export async function loadTabs(projectId: string): Promise<OpenTabsState> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/tabs`,
    );
    if (!resp.ok) return { tabs: [], active: null };
    return (await resp.json()) as OpenTabsState;
  } catch {
    return { tabs: [], active: null };
  }
}

export async function saveTabs(
  projectId: string,
  state: OpenTabsState,
): Promise<void> {
  try {
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  } catch {
    // best-effort
  }
}
