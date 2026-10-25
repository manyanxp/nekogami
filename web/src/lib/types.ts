// API のデータ型（portal/backend/portal_api/registry.py の形に合わせる）
export type Kind = 'orchestrator' | 'suborchestrator' | 'agent' | 'subagent';

export interface Runtime { type: 'builtin' | 'external' | 'docker'; url?: string; compose_file?: string; service?: string }
export interface Definition { kind: string; path: string }

export interface Entity {
  id: string; kind: Kind; name: string; parent_id: string | null; description: string; model: string;
  enabled: boolean; tags: string[]; runtime: Runtime; tool_ids: string[]; pos: { x: number; y: number } | null;
  protected?: boolean; definition?: Definition | null; icon?: string | null;
  /** 呼べる担当（担当 → 担当の接続。ADR 0043）と、足りないときの一時担当の自動作成を許すか（サブオーケストレーターのみ） */
  callee_ids?: string[]; auto_spawn?: boolean;
}
export type DirPerm = 'list' | 'read' | 'write' | 'delete' | 'exec';
export type DirPerms = Record<DirPerm, boolean>;
/** kind が directory のツールは、担当が読み書きできる作業領域内のディレクトリ（path と perms を持つ。ADR 0037） */
export interface Tool { id: string; name: string; kind: string; description?: string; pos: { x: number; y: number } | null; path?: string; perms?: Partial<DirPerms>;
  /** kind が llm のツールは、ローカル LLM（Ollama）のノード。model はその名前、prompt はシステムプロンプト（ADR 0040） */
  model?: string; prompt?: string; temperature?: number; max_tokens?: number;
  /** kind が python のツールは、関数のコード（func を呼ぶ）。params は型注釈から読んだ引数、input_ids はつないだ入力ノード（ADR 0041） */
  code?: string; func?: string; params?: PyParam[]; doc?: string; input_ids?: string[];
  /** body = コードは処理（関数の中身）だけで、引数は入力ノードから決まる（ADR 0045）。function = 旧形式（関数ごと書く）。source は実行する関数のソース */
  style?: 'body' | 'function'; source?: string;
  /** kind が input のツールは、Python ノードの引数の既定値（param = 引数名、dtype = データ型、value = 値の文字列） */
  param?: string; dtype?: PyType; value?: string }
export type PyType = 'str' | 'int' | 'float' | 'bool' | 'list' | 'dict' | 'tuple' | 'set';
export interface PyParam { name: string; type: PyType; required: boolean; default: unknown }

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
  /** ローカル LLM を使う委任先のモデル名（Claude のモデルではない）。ふつうの委任先は null */
  local_model?: string | null;
}
export interface Overview {
  admin: Entity | null; counts: { suborchestrator: number; agent: number; subagent: number }; tools: number;
  delegation: DelegationRow[]; misplaced: { name: string; path: string; expected: string }[]; missing: { name: string; path: string }[];
}

export interface Theme { mode: 'auto' | 'dark' | 'light'; accent: string | null; preset: string }
/** サブオーケストレーターの性格（定義の本文の「性格・話し方」の節。ADR 0044） */
export interface EntityPersonality { exists: boolean; file?: boolean; name?: string; first_person: string; address: string; tone: string; traits: string }
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
  /** 足りないときに自動作成された一時の担当の動き（ADR 0043） */
  auto?: boolean;
}
