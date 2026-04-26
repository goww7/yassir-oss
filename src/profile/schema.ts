/**
 * Zod schema for validating external (crafted) profile JSON files.
 * Used by loadExternalProfiles() to validate .agents/profiles/{id}/profile.json.
 */

import { z } from 'zod';

export const profilePaletteSchema = z.object({
  primary: z.string(),
  primaryLight: z.string(),
  success: z.string(),
  error: z.string(),
  warning: z.string(),
  muted: z.string(),
  mutedDark: z.string(),
  accent: z.string(),
  white: z.string(),
  info: z.string(),
  queryBg: z.string(),
  border: z.string(),
});

export const profileIntroSchema = z.object({
  welcome: z.string(),
  title: z.string(),
  subtitle: z.string(),
  logoAscii: z.string(),
});

export const profileBrandSchema = z.object({
  id: z.string(),
  name: z.string(),
  storageDir: z.string(),
  palette: profilePaletteSchema,
  intro: profileIntroSchema,
});

export const profileBackendSetupSchema = z.object({
  kind: z.literal('generated-key-via-email'),
  generateUrl: z.string(),
  confirmTitle: z.string(),
  confirmDescription: z.string(),
  confirmFooter: z.string(),
  emailTitle: z.string(),
  emailDescription: z.string(),
  emailFooter: z.string(),
  generatingMessage: z.string(),
  successMessage: z.string(),
});

export const profileBackendSchema = z.object({
  label: z.string(),
  envVar: z.string(),
  statusLabel: z.string(),
  readyDescription: z.string(),
  missingDescription: z.string(),
  doctorRecommendation: z.string(),
  setup: profileBackendSetupSchema.optional(),
  runtimeSuggestionsBaseUrl: z.string().optional(),
});

export const guidedQaConditionSchema = z.object({
  field: z.string(),
  equals: z.union([z.string(), z.array(z.string())]).optional(),
  notEquals: z.union([z.string(), z.array(z.string())]).optional(),
});

export const guidedQaOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export const guidedQaQuestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  kind: z.enum(['single', 'multi', 'text']),
  options: z.array(guidedQaOptionSchema).optional(),
  allowSkip: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  summaryLabel: z.string().optional(),
  prefillFrom: z.literal('query').optional(),
  when: guidedQaConditionSchema.optional(),
});

export const guidedQaWorkflowSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  triggerKeywords: z.array(z.string()).optional(),
  autoTrigger: z.enum(['never', 'broad-only', 'always']).optional(),
  executionHint: z.string().optional(),
  outputSections: z.array(z.string()).optional(),
  questions: z.array(guidedQaQuestionSchema),
});

export const profileFeaturesSchema = z.object({
  slashCommandFamilies: z.record(z.string(), z.boolean()),
  searchRanking: z.object({
    providerWeights: z.record(z.string(), z.number()).optional(),
    preferredDomains: z.array(z.string()).optional(),
    primaryDomains: z.array(z.string()).optional(),
    intentBoosts: z.array(z.object({
      keywords: z.array(z.string()),
      domains: z.array(z.string()).optional(),
      providers: z.record(z.string(), z.number()).optional(),
      boost: z.number().optional(),
    })).optional(),
  }).optional(),
});

export const profileVerticalSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  assistantDescription: z.string(),
  starterPrompts: z.object({
    ready: z.array(z.string()),
    setup: z.array(z.string()),
  }),
  backend: profileBackendSchema.optional(),
  enabledTools: z.array(z.string()).optional(),
  guidedQa: z.object({
    enabled: z.boolean(),
    workflows: z.array(guidedQaWorkflowSchema),
  }).optional(),
  features: profileFeaturesSchema,
  sourcePolicy: z.array(z.string()).optional(),
  toolUsagePolicy: z.array(z.string()).optional(),
});

export const appProfileSchema = z.object({
  id: z.string(),
  assistantName: z.string(),
  brand: profileBrandSchema,
  vertical: profileVerticalSchema,
});

export type ValidatedAppProfile = z.infer<typeof appProfileSchema>;
