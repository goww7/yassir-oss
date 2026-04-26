/**
 * Types for the Profile Crafter (/craft command).
 *
 * The CraftController is a state machine with sequential LLM calls,
 * NOT a ReAct agent. Each phase makes 1-2 targeted LLM calls with
 * structured output schemas.
 */

import type { AppProfile, ProfileGuidedQaWorkflow } from '../profile/types.js';

// ============================================================================
// State Machine
// ============================================================================

export type CraftState =
  | 'idle'
  | 'input'
  | 'analyzing'
  | 'reviewing'
  | 'applying'
  | 'done'
  | 'failed';

export type CraftCommand = 'new' | 'refine' | 'delete';

// ============================================================================
// Input Phase
// ============================================================================

export interface CraftInput {
  /** The domain for the new profile (e.g., "immigration law") */
  domain: string;
  /** The user's role in the domain (e.g., "I evaluate visa petitions") */
  role: string;
  /** Example queries the user would ask (optional) */
  exampleQueries?: string[];
}

// ============================================================================
// Analysis Phase Results
// ============================================================================

export type ToolClassification = 'primary' | 'supporting' | 'irrelevant';

export interface ToolAuditEntry {
  name: string;
  classification: ToolClassification;
  reason: string;
}

export interface ToolAuditResult {
  tools: ToolAuditEntry[];
  /** Tools classified as primary (domain-specific) */
  primaryTools: string[];
  /** Tools classified as supporting (always included) */
  supportingTools: string[];
}

export interface ApiCandidate {
  name: string;
  endpoint: string;
  description: string;
  auth: 'none' | 'free-key' | 'paid';
  recommended: boolean;
  toolName?: string;
  /** Whether the smoke test passed */
  validated?: boolean;
}

export interface ApiDiscoveryResult {
  recommended: ApiCandidate[];
  gaps: Array<{ name: string; reason: string; workaround?: string }>;
  keyedUpgrades: ApiCandidate[];
}

export interface SearchRankingConfig {
  providerWeights?: Partial<Record<'exa' | 'perplexity' | 'tavily' | 'brave', number>>;
  preferredDomains?: string[];
  primaryDomains?: string[];
  intentBoosts?: Array<{
    keywords: string[];
    domains?: string[];
    providers?: Partial<Record<'exa' | 'perplexity' | 'tavily' | 'brave', number>>;
    boost?: number;
  }>;
}

export interface BehaviorResult {
  sourcePolicy: string[];
  toolUsagePolicy: string[];
  assistantDescription: string;
}

export interface BrandConfig {
  id: string;
  name: string;
  palette: {
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
  };
  intro: {
    welcome: string;
    title: string;
    subtitle: string;
    logoAscii: string;
  };
}

// ============================================================================
// Tool Generation (Phase 1b: API discovery → smoke test → code gen)
// ============================================================================

export interface GeneratedToolFile {
  /** Tool name in snake_case (e.g., "uscis_case_search") */
  toolName: string;
  /** File name without extension (e.g., "uscis-case-search") */
  fileName: string;
  /** Variable name for the tool instance (e.g., "uscisCaseSearchTool") */
  varName: string;
  /** Variable name for the description constant (e.g., "USCIS_CASE_SEARCH_DESCRIPTION") */
  descriptionVarName: string;
  /** Full TypeScript source code for the tool file */
  sourceCode: string;
  /** The API that was validated */
  api: ApiCandidate;
}

export interface SmokeTestResult {
  api: ApiCandidate;
  ok: boolean;
  statusCode?: number;
  /** Sample of the response shape (for code generation) */
  responseSample?: string;
  error?: string;
}

export interface SkillFile {
  name: string;
  description: string;
  profiles: string[];
  instructions: string;
}

export interface StarterPrompts {
  ready: string[];
  setup: string[];
}

// ============================================================================
// Refine Suggestions
// ============================================================================

export interface RefineSuggestionItem {
  index: number;
  category: 'tools' | 'search_ranking' | 'workflows' | 'source_policy'
    | 'tool_usage_policy' | 'search_domains' | 'intent_boost';
  label: string;
  description: string;
  action?: string;
  toolName?: string;
  directive?: string;
  domains?: string[];
  searchRankingPatch?: Partial<SearchRankingConfig>;
  workflow?: ProfileGuidedQaWorkflow;
  intentBoost?: {
    keywords: string[];
    domains?: string[];
    providers?: Partial<Record<'exa' | 'perplexity' | 'tavily' | 'brave', number>>;
    boost?: number;
  };
}

export interface RefineSuggestions {
  items: RefineSuggestionItem[];
}

// ============================================================================
// Craft Session — accumulates results across phases
// ============================================================================

export interface CraftSession {
  command: CraftCommand;
  input: CraftInput;

  /** Profile ID being refined/deleted (for refine/delete commands) */
  targetProfileId?: string;
  /** Existing profile loaded for refine */
  existingProfile?: AppProfile;

  /** Phase results (populated as analysis progresses) */
  toolAudit?: ToolAuditResult;
  apiDiscovery?: ApiDiscoveryResult;
  generatedTools?: GeneratedToolFile[];
  searchRanking?: SearchRankingConfig;
  workflows?: ProfileGuidedQaWorkflow[];
  behavior?: BehaviorResult;
  soulMd?: string;
  skills?: SkillFile[];
  brand?: BrandConfig;
  starterPrompts?: StarterPrompts;

  /** The assembled profile (built during review phase) */
  assembledProfile?: AppProfile;

  /** Refinement suggestions (for /craft refine) */
  refineSuggestions?: RefineSuggestions;

  /** User feedback during review iteration */
  reviewFeedback?: string[];
}

// ============================================================================
// Craft Result
// ============================================================================

export interface CraftResult {
  success: boolean;
  profileId?: string;
  profileName?: string;
  /** Files that were written during apply */
  writtenFiles?: string[];
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Rollback Transaction
// ============================================================================

export interface RollbackEntry {
  type: 'file_created' | 'file_modified' | 'dir_created';
  path: string;
  /** Original content (for file_modified) */
  originalContent?: string;
}

export interface RollbackTransaction {
  entries: RollbackEntry[];
}

// ============================================================================
// Collision Detection
// ============================================================================

export interface CollisionResult {
  idCollision: boolean;
  brandIdCollision: boolean;
  paletteCollision: boolean;
}

// ============================================================================
// Craft Events (emitted to the UI)
// ============================================================================

export type CraftEventKind =
  | 'state_change'
  | 'phase_start'
  | 'phase_complete'
  | 'review_ready'
  | 'apply_progress'
  | 'error'
  | 'done';

export interface CraftEvent {
  kind: CraftEventKind;
  message: string;
  state: CraftState;
  /** Phase name (e.g., "tool_audit", "source_mapping") */
  phase?: string;
  /** Progress percentage during apply */
  progress?: number;
}
