import type { AgentEvent, ApprovalDecision, ProfilesResponse } from '../types';

export async function* streamChat(params: {
  sessionId: string;
  query: string;
  model?: string;
}): AsyncGenerator<AgentEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Chat failed (${res.status}): ${text || res.statusText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop()!;
    for (const chunk of chunks) {
      const dataMatch = chunk.match(/^data: (.+)$/m);
      if (dataMatch) {
        try { yield JSON.parse(dataMatch[1]) as AgentEvent; } catch { /* skip */ }
      }
    }
  }
}

export async function sendApproval(sessionId: string, decision: ApprovalDecision): Promise<void> {
  await fetch(`/api/chat/${sessionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
}

export async function abortChat(sessionId: string): Promise<void> {
  await fetch(`/api/chat/${sessionId}/abort`, { method: 'POST' });
}

export async function fetchProfiles(): Promise<ProfilesResponse> {
  const res = await fetch('/api/profiles');
  return res.json();
}

export async function executeSlashCommand(input: string): Promise<{
  kind: 'local' | 'run' | 'insert' | 'guide' | 'attach' | 'passthrough';
  answer?: string;
  query?: string;
  text?: string;
  workflowId?: string;
  seedQuery?: string;
}> {
  const res = await fetch('/api/slash-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`Slash command failed: ${res.status}`);
  return res.json();
}

export async function fetchModels(): Promise<{
  currentModel: string;
  currentProvider: string;
  providers: Array<{
    id: string;
    displayName: string;
    hasApiKey: boolean;
    models: Array<{ id: string; displayName: string }>;
  }>;
}> {
  const res = await fetch('/api/models');
  return res.json();
}

export async function switchModel(provider: string, modelId: string): Promise<void> {
  await fetch('/api/model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, modelId }),
  });
}
