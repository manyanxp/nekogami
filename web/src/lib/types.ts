// API のデータ型（portal/backend/portal_api/registry.py の形に合わせる）
export type Kind = 'orchestrator' | 'suborchestrator' | 'agent' | 'subagent';

export interface Runtime { type: 'builtin' | 'external' | 'docker'; url?: string; compose_file?: string; service?: string }
export interface Definition { kind: string; path: string }

export interface Entity {
  id: string; kind: Kind; name: string; parent_id: string | null; description: string; model: string;
  enabled: boolean; tags: string[]; runtime: Runtime; tool_ids: string[]; pos: { x: number; y: number } | null;
  protected?: boolean; definition?: Definition | null; icon?: string | null;
}
export type DirPerm = 'list' | 'read' | 'write' | 'delete';
export type DirPerms = Record<DirPerm, boolean>;
/** kind が directory のツールは、担当が読み書きできる作業領域内のディレクトリ（path と perms を持つ。ADR 0037） */
export interface Tool { id: string; name: string; kind: string; description?: string; pos: { x: number; y: number } | null; path?: string; perms?: Partial<DirPerms> }

export interface DockerStatus { state: string; detail?: string }
export type Role = 'admin' | 'user';
export interface Me { authEnabled: boolean; user: { username: string; role: Role } | null; setup: boolean }
export interface UserRow { id: string; username: string; role: Role; disabled?: boolean; created?: string }
export interface Health { ok: boolean; auth: boolean; docker: boolean; console: string }

export interface EntityDefinition { kind: string; path: string; prompt: string; model: string; tools: string[] | null; tools_other: string[] }

export interface DelegationRow {
  name: string; type: 'agent' | 'session'; agent?: string; dir?: string; description: string; registered: boolean; wired: boolean;
  entity: { id: string; description: string; model: string; enabled: boolean; has_definition: boolean; children: number } | null;
  target: { name: string; kind: Kind } | null;
}
export interface Overview {
  admin: Entity | null; counts: { suborchestrator: number; agent: number; subagent: number }; tools: number;
  delegation: DelegationRow[]; misplaced: { name: string; path: string; expected: string }[]; missing: { name: string; path: string }[];
}

export interface Theme { mode: 'auto' | 'dark' | 'light'; accent: string | null; preset: string }
export interface Personality { exists: boolean; imported: boolean; first_person: string; address: string; tone: string; traits: string }
export interface ChatCommand { name: string; kind: 'delegate' | 'agent'; type: string; how: string; description: string }
export interface ConsoleTarget { name: string; label: string; type: string }

/** 猫神さまのチャットの SSE（/api/chat/stream）のイベント */
export type ChatEvent =
  | { kind: 'hello'; running: boolean }
  | { kind: 'reset' }
  | { kind: 'chat'; agent: string; type: 'user' | 'delta' | 'assistant_full' | 'error'; text: string }
  | { kind: 'chat'; agent: string; type: 'busy' | 'idle' | 'message_start' }
  | { kind: 'chat'; agent: string; type: 'result'; isError?: boolean; subtype?: string; turns?: number; durationMs?: number; cost?: number }
  | TraceEvent;

export interface TraceEvent {
  kind: 'trace'; ts?: number; event: string; agentType?: string | null; agentId?: string | null; sessionId?: string;
  toolName?: string; toolUseId?: string; message?: string; prompt?: string; input?: string; replay?: boolean;
  route?: { to: string; via: 'agent' | 'session'; description?: string };
}
