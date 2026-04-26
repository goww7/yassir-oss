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

export interface ProfileBackendSetup {
  kind: 'generated-key-via-email';
  generateUrl: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmFooter: string;
  emailTitle: string;
  emailDescription: string;
  emailFooter: string;
  generatingMessage: string;
  successMessage: string;
}

export interface ProfileBackend {
  label: string;
  envVar: string;
  statusLabel: string;
  readyDescription: string;
  missingDescription: string;
  doctorRecommendation: string;
  setup?: ProfileBackendSetup;
  runtimeSuggestionsBaseUrl?: string;
}

export interface ProfileIntro {
  welcome: string;
  title: string;
  subtitle: string;
  logoAscii: string;
}

export interface ProfileBrand {
  id: string;
  name: string;
  storageDir: string;
  palette: ProfilePalette;
  intro: ProfileIntro;
}

export interface ProfileFeatures {
  slashCommandFamilies: Record<string, boolean>;
  searchRanking?: {
    providerWeights?: Partial<Record<'exa' | 'perplexity' | 'tavily' | 'brave', number>>;
    preferredDomains?: string[];
    primaryDomains?: string[];
    intentBoosts?: Array<{
      keywords: string[];
      domains?: string[];
      providers?: Partial<Record<'exa' | 'perplexity' | 'tavily' | 'brave', number>>;
      boost?: number;
    }>;
  };
}

export interface ProfileGuidedQaCondition {
  field: string;
  equals?: string | string[];
  notEquals?: string | string[];
}

export interface ProfileGuidedQaOption {
  value: string;
  label: string;
  description?: string;
}

export interface ProfileGuidedQaQuestion {
  id: string;
  title: string;
  prompt: string;
  kind: 'single' | 'multi' | 'text';
  options?: ProfileGuidedQaOption[];
  allowSkip?: boolean;
  placeholder?: string;
  defaultValue?: string | string[];
  summaryLabel?: string;
  prefillFrom?: 'query';
  when?: ProfileGuidedQaCondition;
}

export interface ProfileGuidedQaWorkflow {
  id: string;
  label: string;
  description: string;
  triggerKeywords?: string[];
  autoTrigger?: 'never' | 'broad-only' | 'always';
  executionHint?: string;
  outputSections?: string[];
  questions: ProfileGuidedQaQuestion[];
}

export interface ProfileGuidedQaConfig {
  enabled: boolean;
  workflows: ProfileGuidedQaWorkflow[];
}

export interface ProfileVertical {
  id: string;
  label: string;
  description: string;
  assistantDescription: string;
  starterPrompts: {
    ready: string[];
    setup: string[];
  };
  backend?: ProfileBackend;
  enabledTools?: string[];
  guidedQa?: ProfileGuidedQaConfig;
  features: ProfileFeatures;
  /** Per-profile source selection directives (injected into Source Selection Policy) */
  sourcePolicy?: string[];
  /** Per-profile tool usage guidance (injected after generic tool usage policy) */
  toolUsagePolicy?: string[];
}

export interface AppProfile {
  id: string;
  assistantName: string;
  brand: ProfileBrand;
  vertical: ProfileVertical;
}
