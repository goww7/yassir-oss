export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface ToolStartEvent extends AgentEvent {
  type: 'tool_start';
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent extends AgentEvent {
  type: 'tool_end';
  tool: string;
  args: Record<string, unknown>;
  result: string;
  duration: number;
}

export interface ToolErrorEvent extends AgentEvent {
  type: 'tool_error';
  tool: string;
  error: string;
}

export interface ToolApprovalRequestEvent extends AgentEvent {
  type: 'tool_approval_request';
  tool: string;
  args: Record<string, unknown>;
}

export interface ThinkingEvent extends AgentEvent {
  type: 'thinking';
  message: string;
}

export interface DoneEvent extends AgentEvent {
  type: 'done';
  answer: string;
  iterations: number;
  totalTime: number;
  tokensPerSecond?: number;
}

export interface ErrorEvent extends AgentEvent {
  type: 'error';
  error: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  events: AgentEvent[];
  timestamp: number;
}

export interface ProfilePalette {
  primary: string;
  primaryLight: string;
  success: string;
  error: string;
  warning: string;
  muted: string;
  mutedDark: string;
  accent: string;
  white: string;
  info: string;
  queryBg: string;
  border: string;
}

export interface Profile {
  id: string;
  name: string;
  vertical: string;
  description: string;
  logo: string;
  title: string;
  subtitle: string;
  palette: ProfilePalette;
  starterPrompts: {
    ready: string[];
    setup: string[];
  };
  backend: {
    label: string;
    statusLabel: string;
    readyDescription: string;
    missingDescription: string;
  } | null;
}

export interface ProfilesResponse {
  profiles: Profile[];
  hasBackend: boolean;
  version: string;
  model: string;
}

export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny';
