// ============================================================
// Social Dots Design Studio — Production Server
// Express backend: serves Vite static build + API
// Multi-user via Clerk, AI via Anthropic streaming SSE
// ============================================================

import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { Webhook } from 'svix';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// App init
// ---------------------------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Database (PostgreSQL)
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(
    process.env.DATABASE_URL || 'postgresql://localhost/social_dots_studio',
    process.env.SUPABASE_SERVICE_KEY || 'anonymous'
  );
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '4mb' }));

// Extract Clerk user ID from Authorization header (Bearer token)
// In production this would validate the Clerk JWT. For the simple API key
// model, we accept X-User-ID directly from the frontend.
function requireAuth(req, res, next) {
  // In full Clerk setup: verify JWT, set req.userId from Clerk token.
  // For simple deploy: accept X-User-ID header from the frontend.
  const userId = req.headers['x-user-id'];
  if (!userId) {
    // Fallback: allow unauthenticated health/skill calls
    return next();
  }
  req.userId = userId;
  next();
}

// Attach userId to requests (simple mode — swap for Clerk JWT validation)
app.use((req, _res, next) => {
  req.userId = req.headers['x-user-id'] || 'anon';
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: join(__dirname, 'uploads'),
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname.replace(/[^\w.\-]/g, '_')}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

mkdirSync(join(__dirname, 'uploads'), { recursive: true });
mkdirSync(join(__dirname, '.od', 'projects'), { recursive: true });

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '0.1.0' });
});

// ---------------------------------------------------------------------------
// Agents — fixed list for now (Claude Code, Codex, etc. available locally)
// ---------------------------------------------------------------------------

const AGENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Full Claude Code CLI with file tools, git, npm, and shell access.',
    available: true,
    streamFormat: 'claude-stream-json',
    model: 'sonnet',
    reasoning: null,
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI for code generation and file editing.',
    available: false,
    streamFormat: 'stdout',
    model: null,
    reasoning: null,
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    description: 'Direct Anthropic API — streaming text in simple format.',
    available: true,
    streamFormat: 'anthropic-stream',
    model: null,
    reasoning: null,
  },
];

app.get('/api/agents', (_req, res) => {
  res.json({ agents: AGENTS });
});

// ---------------------------------------------------------------------------
// Skills — serve from local skills/ directory
// ---------------------------------------------------------------------------

function serveSkillsDir(req, res, subPath = '') {
  const dir = join(__dirname, 'skills', subPath);
  if (!existsSync(dir)) return res.status(404).json({ error: 'not found' });

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const items = entries.map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? 'directory' : 'file',
      path: subPath ? `${subPath}/${e.name}` : e.name,
    }));
    res.json({ entries: items });
  } catch {
    res.status(500).json({ error: 'read error' });
  }
}

app.get('/api/skills', (_req, res) => {
  const skillsDir = join(__dirname, 'skills');
  if (!existsSync(skillsDir)) return res.json({ skills: [] });

  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const skills = dirs.map((id) => {
      const skillMd = join(skillsDir, id, 'SKILL.md');
      let title = id;
      let description = '';
      if (existsSync(skillMd)) {
        const content = readFileSync(skillMd, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        const descMatch = content.match(/^>\s+(.+)/m);
        if (titleMatch) title = titleMatch[1];
        if (descMatch) description = descMatch[1];
      }
      return { id, name: title, description };
    });

    res.json({ skills });
  } catch {
    res.json({ skills: [] });
  }
});

app.get('/api/skills/:id', (req, res) => {
  const { id } = req.params;
  const skillDir = join(__dirname, 'skills', id);
  if (!existsSync(skillDir)) return res.status(404).json({ error: 'skill not found' });

  const skillMd = join(skillDir, 'SKILL.md');
  const exampleHtml = join(skillDir, 'example.html');

  let skillContent = '';
  if (existsSync(skillMd)) skillContent = readFileSync(skillMd, 'utf8');

  let example = null;
  if (existsSync(exampleHtml)) {
    example = readFileSync(exampleHtml, 'utf8');
  }

  const skill = {
    id,
    content: skillContent,
    example,
    files: readdirSync(skillDir, { withFileTypes: true })
      .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' })),
  };

  res.json(skill);
});

app.get('/api/skills/:id/example', (req, res) => {
  const examplePath = join(__dirname, 'skills', req.params.id, 'example.html');
  if (!existsSync(examplePath)) return res.status(404).send();
  res.type('text/html').sendFile(examplePath);
});

// ---------------------------------------------------------------------------
// Design Systems — serve from local design-systems/ directory
// ---------------------------------------------------------------------------

app.get('/api/design-systems', (_req, res) => {
  const dir = join(__dirname, 'design-systems');
  if (!existsSync(dir)) return res.json({ designSystems: [] });

  try {
    const systems = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({
        id: d.name,
        name: d.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: '',
        previewUrl: `/api/design-systems/${d.name}/preview`,
      }));

    res.json({ designSystems: systems });
  } catch {
    res.json({ designSystems: [] });
  }
});

app.get('/api/design-systems/:id', (req, res) => {
  const dir = join(__dirname, 'design-systems', req.params.id);
  if (!existsSync(dir)) return res.status(404).json({ error: 'design system not found' });

  const metaPath = join(dir, 'meta.json');
  let meta = { id: req.params.id, name: req.params.id, description: '' };
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch {}
  }

  res.json(meta);
});

app.get('/api/design-systems/:id/preview', (req, res) => {
  const path = join(__dirname, 'design-systems', req.params.id, 'preview.html');
  if (!existsSync(path)) return res.status(404).send();
  res.type('text/html').sendFile(path);
});

app.get('/api/design-systems/:id/showcase', (req, res) => {
  const path = join(__dirname, 'design-systems', req.params.id, 'showcase.html');
  if (!existsSync(path)) return res.status(404).send();
  res.type('text/html').sendFile(path);
});

// ---------------------------------------------------------------------------
// Templates CRUD
// ---------------------------------------------------------------------------

app.get('/api/templates', async (_req, res) => {
  try {
    const { data } = await getSupabase()
      .from('templates')
      .select('*')
      .order('created_at', { ascending: false });
    res.json({ templates: data || [] });
  } catch {
    res.json({ templates: [] });
  }
});

app.get('/api/templates/:id', async (req, res) => {
  try {
    const { data } = await getSupabase()
      .from('templates')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ template: data });
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.post('/api/templates', requireAuth, async (req, res) => {
  const { name, description, source_project_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const { data } = await getSupabase()
      .from('templates')
      .insert({ id: randomUUID(), name, description, source_project_id, files_json: '{}' })
      .select()
      .single();
    res.status(201).json({ template: data });
  } catch {
    res.status(500).json({ error: 'insert failed' });
  }
});

app.delete('/api/templates/:id', requireAuth, async (req, res) => {
  try {
    await getSupabase().from('templates').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'delete failed' });
  }
});

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const { data } = await getSupabase()
      .from('projects')
      .select('*')
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false });
    res.json({ projects: data || [] });
  } catch (err) {
    console.error(err);
    res.json({ projects: [] });
  }
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const { data } = await getSupabase()
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ project: data });
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  const { id, name, skill_id, design_system_id, pending_prompt, metadata } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const now = new Date().toISOString();
  const projectId = id || randomUUID();

  try {
    const { data } = await getSupabase()
      .from('projects')
      .insert({
        id: projectId,
        user_id: req.userId,
        name,
        skill_id,
        design_system_id,
        pending_prompt,
        metadata_json: metadata ? JSON.stringify(metadata) : null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    // Also create a default conversation
    await getSupabase()
      .from('conversations')
      .insert({
        id: randomUUID(),
        project_id: projectId,
        title: 'Main',
        created_at: now,
        updated_at: now,
      });

    res.status(201).json({ project: data, conversationId: 'main' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'insert failed' });
  }
});

app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  const { name, pending_prompt, updated_at, metadata } = req.body;

  try {
    const patch = { updated_at: updated_at || new Date().toISOString() };
    if (name !== undefined) patch.name = name;
    if (pending_prompt !== undefined) patch.pending_prompt = pending_prompt;
    if (metadata !== undefined) patch.metadata_json = JSON.stringify(metadata);

    const { data } = await getSupabase()
      .from('projects')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ project: data });
  } catch {
    res.status(500).json({ error: 'update failed' });
  }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    await getSupabase()
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'delete failed' });
  }
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

app.get('/api/projects/:id/conversations', requireAuth, async (req, res) => {
  try {
    const { data } = await getSupabase()
      .from('conversations')
      .select('*')
      .eq('project_id', req.params.id)
      .order('updated_at', { ascending: false });
    res.json({ conversations: data || [] });
  } catch {
    res.json({ conversations: [] });
  }
});

app.post('/api/projects/:id/conversations', requireAuth, async (req, res) => {
  const { title } = req.body;
  const now = new Date().toISOString();

  try {
    const { data } = await getSupabase()
      .from('conversations')
      .insert({ id: randomUUID(), project_id: req.params.id, title: title || 'New chat', created_at: now, updated_at: now })
      .select()
      .single();
    res.status(201).json({ conversation: data });
  } catch {
    res.status(500).json({ error: 'insert failed' });
  }
});

app.patch('/api/projects/:id/conversations/:cid', requireAuth, async (req, res) => {
  const { title } = req.body;
  try {
    const { data } = await getSupabase()
      .from('conversations')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', req.params.cid)
      .eq('project_id', req.params.id)
      .select()
      .single();
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ conversation: data });
  } catch {
    res.status(500).json({ error: 'update failed' });
  }
});

app.delete('/api/projects/:id/conversations/:cid', requireAuth, async (req, res) => {
  try {
    await getSupabase()
      .from('conversations')
      .delete()
      .eq('id', req.params.cid)
      .eq('project_id', req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'delete failed' });
  }
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

app.get('/api/projects/:id/conversations/:cid/messages', requireAuth, async (req, res) => {
  try {
    const { data } = await getSupabase()
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.cid)
      .order('position', { ascending: true });
    res.json({ messages: data || [] });
  } catch {
    res.json({ messages: [] });
  }
});

app.put('/api/projects/:id/conversations/:cid/messages/:mid', requireAuth, async (req, res) => {
  const msg = req.body;
  if (!msg || !msg.role || !msg.content) return res.status(400).json({ error: 'role and content required' });

  const now = new Date().toISOString();
  try {
    const { data } = await getSupabase()
      .from('messages')
      .upsert({
        id: req.params.mid,
        conversation_id: req.params.cid,
        role: msg.role,
        content: msg.content,
        agent_id: msg.agentId || null,
        agent_name: msg.agentName || null,
        events_json: msg.events ? JSON.stringify(msg.events) : null,
        attachments_json: msg.attachments ? JSON.stringify(msg.attachments) : null,
        produced_files_json: msg.producedFiles ? JSON.stringify(msg.producedFiles) : null,
        started_at: msg.startedAt || null,
        ended_at: msg.endedAt || null,
        position: msg.position || 0,
        created_at: now,
      }, { onConflict: 'id' })
      .select()
      .single();
    res.json({ message: data });
  } catch {
    res.status(500).json({ error: 'save failed' });
  }
});

// ---------------------------------------------------------------------------
// Project Files (local filesystem)
// ---------------------------------------------------------------------------

const PROJECTS_DIR = join(__dirname, '.od', 'projects');

function getProjectDir(projectId) {
  return join(PROJECTS_DIR, projectId);
}

app.get('/api/projects/:id/files', requireAuth, async (req, res) => {
  const dir = getProjectDir(req.params.id);
  if (!existsSync(dir)) return res.json({ files: [] });

  try {
    const files = readdirSync(dir).map((name) => ({
      name,
      path: name,
      size: 0,
    }));
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

app.post('/api/projects/:id/files', requireAuth, async (req, res) => {
  const dir = getProjectDir(req.params.id);
  mkdirSync(dir, { recursive: true });

  const { name, content } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const safeName = name.replace(/[^a-zA-Z0-9._\-/]/g, '_');
  const filePath = join(dir, safeName);

  try {
    writeFileSync(filePath, content || '', 'utf8');
    res.status(201).json({ file: { name: safeName, path: safeName } });
  } catch {
    res.status(500).json({ error: 'write failed' });
  }
});

app.delete('/api/projects/:id/raw/:file(*)', requireAuth, async (req, res) => {
  const filePath = join(getProjectDir(req.params.id), req.params.file);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'delete failed' });
  }
});

app.get('/api/projects/:id/raw/:file(*)', requireAuth, async (req, res) => {
  const filePath = join(getProjectDir(req.params.id), req.params.file);
  if (!existsSync(filePath)) return res.status(404).send('not found');
  res.sendFile(filePath);
});

// Multi-file upload
app.post('/api/projects/:id/upload', requireAuth, handleProjectUpload, async (req, res) => {
  const files = (req.files || []).map((f) => ({
    name: f.filename,
    path: f.filename,
    originalName: f.originalname,
    size: f.size,
  }));
  res.json({ files });
});

function handleProjectUpload(req, res, next) {
  const projectId = req.params.id;
  const dir = getProjectDir(projectId);
  mkdirSync(dir, { recursive: true });

  const projectUploadInstance = multer({
    storage: multer.diskStorage({
      destination: () => dir,
      filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
        cb(null, `${Date.now().toString(36)}-${safe}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  }).array('files', 12);

  projectUploadInstance(req, res, (err) => {
    if (err) {
      const statusByCode = { LIMIT_FILE_SIZE: 413, LIMIT_FILE_COUNT: 400 };
      const status = statusByCode[err.code] || 400;
      return res.status(status).json({ code: err.code || 'ERROR', error: err.message });
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

app.get('/api/projects/:id/tabs', requireAuth, async (req, res) => {
  try {
    const { data } = await getSupabase()
      .from('tabs')
      .select('*')
      .eq('project_id', req.params.id)
      .order('position', { ascending: true });

    const tabs = (data || []).map((r) => ({ name: r.name, position: r.position, isActive: !!r.is_active }));
    const active = tabs.find((t) => t.isActive)?.name || null;
    res.json({ tabs, active });
  } catch {
    res.json({ tabs: [], active: null });
  }
});

app.put('/api/projects/:id/tabs', requireAuth, async (req, res) => {
  const { tabs, active } = req.body;
  const projectId = req.params.id;

  try {
    await getSupabase().from('tabs').delete().eq('project_id', projectId);

    if (tabs && tabs.length > 0) {
      const rows = tabs.map((t, i) => ({
        project_id: projectId,
        name: t.name,
        position: i,
        is_active: t.name === active ? 1 : 0,
      }));
      await getSupabase().from('tabs').insert(rows);
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'save tabs failed' });
  }
});

// ---------------------------------------------------------------------------
// /api/chat — the main AI streaming endpoint
// Streams Anthropic responses as SSE in claude-stream-json format
// ---------------------------------------------------------------------------

app.post('/api/chat', requireAuth, async (req, res) => {
  const { agentId, systemPrompt, message, projectId, attachments } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function sendStdout(chunk) {
    res.write(`event: stdout\ndata: ${JSON.stringify({ chunk })}\n\n`);
  }

  function sendError(msg) {
    send('error', { message: msg });
    res.end();
  }

  // Extract HTML artifacts from message
  const artifactMatch = message.match(/<artifact[^>]*>([\s\S]*?)<\/artifact>/i);
  const hasArtifact = !!artifactMatch;

  // Determine model — use env override or pick based on agent
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  // Build system prompt
  const baseSystem = systemPrompt || 'You are a senior product designer. Generate high-quality HTML artifacts.';

  // If there's a skill/system prompt with brand tokens, pass it through
  let fullSystem = baseSystem;
  if (systemPrompt && systemPrompt.includes('BRAND')) {
    fullSystem = systemPrompt;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendError('ANTHROPIC_API_KEY not configured');
    return;
  }

  send('start', { bin: 'anthropic-api' });

  try {
    // Convert conversation history to Anthropic messages format
    let messages = [];
    try {
      messages = typeof message === 'string' && message.startsWith('## ')
        ? message.split('\n\n').reduce((acc, block) => {
            const roleMatch = block.match(/^##\s+(user|assistant)\n([\s\S]*)/);
            if (roleMatch) acc.push({ role: roleMatch[1], content: roleMatch[2].trim() });
            return acc;
          }, [])
        : [{ role: 'user', content: String(message) }];
    } catch {
      messages = [{ role: 'user', content: String(message) }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: fullSystem,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      sendError(`Anthropic API ${response.status}: ${err}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'message_start') {
            send('agent', {
              type: 'status',
              label: 'requesting',
              model: event.message?.model || model,
            });
            continue;
          }

          if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'thinking') {
              send('agent', { type: 'status', label: 'thinking' });
            }
            continue;
          }

          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'thinking_delta' && event.delta?.thinking) {
              send('agent', { type: 'thinking_delta', delta: event.delta.thinking });
            }
            if (event.delta?.type === 'text_delta' && event.delta?.text) {
              accumulatedText += event.delta.text;
              send('agent', { type: 'text_delta', delta: event.delta.text });
              sendStdout(event.delta.text);
            }
            continue;
          }

          if (event.type === 'content_block_stop') {
            continue;
          }

          if (event.type === 'message_delta') {
            const usage = event.usage || {};
            send('agent', {
              type: 'usage',
              usage: {
                input_tokens: usage.input_tokens || 0,
                output_tokens: usage.output_tokens || 0,
              },
            });
            continue;
          }

          if (event.type === 'message_stop') {
            send('end', { code: 0 });
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    // If no text was streamed (empty response), send what's accumulated
    if (!accumulatedText) {
      accumulatedText = buffer;
    }

    // Try to extract HTML artifact from the accumulated response
    const htmlMatch = accumulatedText.match(/<artifact[^>]*type="web"[^>]*>([\s\S]*?)<\/artifact>/i);
    if (htmlMatch) {
      const html = htmlMatch[1].trim();
      send('agent', {
        type: 'tool_use',
        id: 'artifact-1',
        name: 'Write',
        input: { file_path: 'design.html', content: html },
      });
      send('agent', {
        type: 'tool_result',
        toolUseId: 'artifact-1',
        content: `Saved design.html (${html.length} chars)`,
        isError: false,
      });
    }

    res.end();

  } catch (err) {
    sendError(String(err));
  }
});

// ---------------------------------------------------------------------------
// Claude Design ZIP Import
// ---------------------------------------------------------------------------

app.post('/api/import/claude-design', requireAuth, async (req, res) => {
  // Simple: create a new project with the import flag
  // Full implementation would parse the ZIP and extract files
  const { name = 'Imported Project' } = req.body || {};
  const projectId = randomUUID();
  const now = new Date().toISOString();

  try {
    const { data } = await getSupabase()
      .from('projects')
      .insert({
        id: projectId,
        user_id: req.userId,
        name,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    res.status(201).json({ project: data, conversationId: 'main' });
  } catch {
    res.status(500).json({ error: 'import failed' });
  }
});

// ---------------------------------------------------------------------------
// Stripe Webhooks
// ---------------------------------------------------------------------------

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2024-12-18.acacia',
});

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook Error: ' + err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    if (email) {
      await getSupabase()
        .from('users')
        .update({ stripe_customer_id: session.customer })
        .eq('email', email);
    }
  }

  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// Clerk Webhooks
// ---------------------------------------------------------------------------

app.post('/api/webhooks/clerk', async (req, res) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'No webhook secret' });

  try {
    const wh = new Webhook(secret);
    const evt = wh.verify(req.body, req.headers);
    const { type, data } = evt;

    if (type === 'user.created' || type === 'user.updated') {
      const meta = data.public_metadata || {};
      await getSupabase().from('users').upsert({
        clerk_id: data.id,
        email: (data.email_addresses && data.email_addresses[0] || {}).email_address || '',
        display_name: data.username || (data.email_addresses && data.email_addresses[0] || {}).email_address || data.id,
        avatar_url: data.image_url || null,
        plan: meta.plan || 'free',
      }, { onConflict: 'clerk_id' });
    }

    if (type === 'user.deleted') {
      await getSupabase().from('users').delete().eq('clerk_id', data.id);
    }

    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Invalid signature' });
  }
});

// ---------------------------------------------------------------------------
// Proxy to Next.js standalone server (handles all non-API routes)
// ---------------------------------------------------------------------------

const NEXTJS_PORT = process.env.NEXTJS_PORT || 3001;

function proxyToNextjs(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: NEXTJS_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, 'x-forwarded-for': req.ip },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      res.status(502).json({ error: 'Next.js server not ready', code: 'NEXTJS_DOWN' });
    } else {
      res.status(502).json({ error: 'Proxy error', details: err.message });
    }
  });

  req.pipe(proxyReq, { end: true });
}

// Catch-all: proxy everything except /api/* to Next.js for SSR
app.get('*', (req, res) => {
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  proxyToNextjs(req, res);
});

app.listen(PORT, () => {
  console.log(`Social Dots Design Studio running on port ${PORT}`);
  console.log(`Next.js standalone proxy on port ${NEXTJS_PORT}`);
});
