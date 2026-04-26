/**
 * CraftController — orchestrates the /craft command flow.
 *
 * This is a state machine with sequential LLM calls, NOT a ReAct agent.
 * Each phase makes 1-2 targeted LLM calls with specific prompts and
 * structured output schemas via Zod.
 */

import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { callLlm } from '../model/llm.js';
import { getToolRegistry } from '../tools/registry.js';
import { listProfiles, getCurrentProfileId } from '../profile/current.js';
import { clearProfileCache, getProfileById } from '../profile/registry.js';
import { clearSkillCache } from '../skills/registry.js';
import { logger } from '../utils/index.js';
import type {
  CraftState,
  CraftInput,
  CraftSession,
  CraftResult,
  CraftEvent,
  ToolAuditResult,
  ApiCandidate,
  ApiDiscoveryResult,
  GeneratedToolFile,
  SmokeTestResult,
  SearchRankingConfig,
  BehaviorResult,
  BrandConfig,
  SkillFile,
  StarterPrompts,
  CollisionResult,
  RollbackTransaction,
  RefineSuggestions,
} from './craft-types.js';
import type { AppProfile, ProfileGuidedQaWorkflow } from '../profile/types.js';

// ============================================================================
// Constants
// ============================================================================

const CORE_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'heartbeat',
  'memory_search', 'memory_get', 'memory_update',
  'web_fetch', 'browser', 'web_search', 'skill',
];

/**
 * Collect all palette primary colors from currently loaded profiles.
 * Used to avoid color collisions when generating new profile branding.
 */
function getExistingPalettePrimaries(): string[] {
  return listProfiles().map(p => p.brand.palette.primary.toLowerCase());
}

const DEFAULT_CRAFT_MODEL = 'gpt-5.4';

const SMOKE_TEST_TIMEOUT_MS = 10_000;
const OPEN_DATA_DIR = 'src/tools/open-data';
const OPEN_DATA_INDEX = `${OPEN_DATA_DIR}/index.ts`;
const REGISTRY_PATH = 'src/tools/registry.ts';

/**
 * Recursively convert null values to undefined in LLM structured output.
 * OpenAI structured output requires all fields in `required`, so we use
 * `.nullable()` in Zod schemas. But our AppProfile types use `optional`.
 * This bridge converts nulls back to undefineds after parsing.
 */
function stripNulls<T>(obj: T): T {
  if (obj === null) return undefined as unknown as T;
  if (Array.isArray(obj)) return obj.map(stripNulls) as unknown as T;
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = value === null ? undefined : stripNulls(value);
    }
    return result as T;
  }
  return obj;
}

// ============================================================================
// CraftController
// ============================================================================

export class CraftController {
  private _state: CraftState = 'idle';
  private session: CraftSession | null = null;
  private rollback: RollbackTransaction = { entries: [] };
  private abortController: AbortController | null = null;
  private readonly onEvent: (event: CraftEvent) => void;

  constructor(onEvent: (event: CraftEvent) => void) {
    this.onEvent = onEvent;
  }

  get state(): CraftState {
    return this._state;
  }

  get currentSession(): CraftSession | null {
    return this.session;
  }

  isActive(): boolean {
    return this._state !== 'idle' && this._state !== 'done' && this._state !== 'failed';
  }

  // ==========================================================================
  // State transitions
  // ==========================================================================

  private setState(newState: CraftState, message: string): void {
    this._state = newState;
    this.emit('state_change', message);
  }

  private emit(kind: CraftEvent['kind'], message: string, extra?: Partial<CraftEvent>): void {
    this.onEvent({
      kind,
      message,
      state: this._state,
      ...extra,
    });
  }

  // ==========================================================================
  // /craft new
  // ==========================================================================

  async startNew(input: CraftInput): Promise<CraftResult> {
    this.session = { command: 'new', input };
    this.rollback = { entries: [] };
    this.abortController = new AbortController();

    try {
      // Input phase
      this.setState('input', `Crafting a **${input.domain}** agent...`);

      // Generate IDs (auto-suffixed if collision detected)
      const proposedId = this.generateProfileId(input.domain);
      const proposedBrandId = this.generateBrandId(input.domain);

      // Analysis phase
      this.setState('analyzing', '');
      const totalPhases = 8;
      let phase = 0;

      const progress = (label: string) => {
        phase++;
        const filled = Math.min(phase, totalPhases);
        const remaining = Math.max(totalPhases - filled, 0);
        const bar = '█'.repeat(filled) + '░'.repeat(remaining);
        return `\`[${bar}]\` **${Math.min(phase, totalPhases)}/${totalPhases}** ${label}`;
      };

      // Phase 1: Tool audit
      this.emit('phase_start', progress('Auditing tools for your domain...'), { phase: 'tool_audit' });
      const toolAudit = await this.analyzeTools(input.domain, input.role);
      this.session.toolAudit = toolAudit;
      this.emit('phase_complete', `  Found **${toolAudit.primaryTools.length}** primary tools, **${toolAudit.supportingTools.length}** supporting`, { phase: 'tool_audit' });

      // Phase 1b: API discovery & tool generation
      this.emit('phase_start', progress('Discovering free APIs for your domain...'), { phase: 'api_discovery' });
      const apiDiscovery = await this.discoverApis(input.domain, input.role, toolAudit.primaryTools);
      this.session.apiDiscovery = apiDiscovery;

      const generatedTools: GeneratedToolFile[] = [];
      if (apiDiscovery.recommended.length > 0) {
        const validated: Array<{ api: ApiCandidate; responseSample: string }> = [];
        for (const api of apiDiscovery.recommended) {
          const testResult = await this.smokeTestApi(api);
          if (testResult.ok && testResult.responseSample) {
            api.validated = true;
            validated.push({ api, responseSample: testResult.responseSample });
            this.emit('phase_start', `  Validated: **${api.name}**`, { phase: 'api_discovery' });
          } else {
            this.emit('phase_start', `  Skipped: ${api.name} (${testResult.error ?? 'endpoint unreachable'})`, { phase: 'api_discovery' });
          }
        }

        for (const { api, responseSample } of validated) {
          const toolFile = await this.generateToolCode(api, responseSample, input.domain);
          if (toolFile) {
            generatedTools.push(toolFile);
          }
        }
      }
      this.session.generatedTools = generatedTools;
      const gapCount = apiDiscovery.gaps.length;
      if (generatedTools.length > 0) {
        this.emit('phase_complete', `  Generated **${generatedTools.length}** new tool(s)${gapCount > 0 ? ` | ${gapCount} gap(s) noted` : ''}`, { phase: 'api_discovery' });
      } else {
        this.emit('phase_complete', `  No new APIs discovered${gapCount > 0 ? ` | ${gapCount} gap(s) noted` : ''}`, { phase: 'api_discovery' });
      }

      // Phase 2: Source authority mapping
      const allPrimaryTools = [
        ...toolAudit.primaryTools,
        ...generatedTools.map(t => t.toolName),
      ];
      this.emit('phase_start', progress('Mapping authoritative sources...'), { phase: 'source_mapping' });
      const searchRanking = await this.mapSources(input.domain, allPrimaryTools);
      this.session.searchRanking = searchRanking;
      this.emit('phase_complete', `  **${searchRanking.primaryDomains?.length ?? 0}** primary domains, **${searchRanking.intentBoosts?.length ?? 0}** intent boosts`, { phase: 'source_mapping' });

      // Phase 3: Workflow generation
      this.emit('phase_start', progress('Building practitioner workflows...'), { phase: 'workflows' });
      const workflows = await this.generateWorkflows(input.domain, input.role);
      this.session.workflows = workflows;
      this.emit('phase_complete', `  **${workflows.length}** domain workflow(s): ${workflows.map(w => w.label).join(', ')}`, { phase: 'workflows' });

      // Phase 4: Behavioral directives
      this.emit('phase_start', progress('Crafting behavioral directives...'), { phase: 'behavior' });
      const behavior = await this.generateBehavior(input.domain, input.role, allPrimaryTools);
      this.session.behavior = behavior;
      this.emit('phase_complete', `  **${behavior.sourcePolicy.length}** source policies, **${behavior.toolUsagePolicy.length}** tool policies`, { phase: 'behavior' });

      // Phase 5: SOUL.md
      this.emit('phase_start', progress('Writing agent identity...'), { phase: 'soul' });
      const brandName = this.generateBrandName(input.domain);
      const soulMd = await this.generateSoul(input.domain, input.role, brandName);
      this.session.soulMd = soulMd;
      this.emit('phase_complete', `  Identity document ready`, { phase: 'soul' });

      // Phase 6: Skills
      this.emit('phase_start', progress('Generating reusable skills...'), { phase: 'skills' });
      const skills = await this.generateSkills(input.domain, input.role, proposedId, workflows);
      this.session.skills = skills;
      this.emit('phase_complete', skills.length > 0
        ? `  **${skills.length}** skill(s): ${skills.map(s => s.name).join(', ')}`
        : `  No domain skills needed`, { phase: 'skills' });

      // Phase 7: Branding
      this.emit('phase_start', progress('Designing brand identity...'), { phase: 'branding' });
      let brand = await this.generateBranding(input.domain, brandName);

      const paletteCheck = this.checkCollisions(proposedId, proposedBrandId, brand.palette.primary);
      if (paletteCheck.paletteCollision) {
        brand = await this.generateBranding(input.domain, brandName);
      }

      this.session.brand = brand;
      this.emit('phase_complete', `  **${brand.name}** | palette: ${brand.palette.primary}`, { phase: 'branding' });

      // Phase 8: Starter prompts
      this.emit('phase_start', progress('Calibrating starter prompts...'), { phase: 'starters' });
      const starters = await this.generateStarterPrompts(input.domain, input.role, allPrimaryTools);
      this.session.starterPrompts = starters;
      this.emit('phase_complete', `  **${starters.ready.length}** ready prompts, **${starters.setup.length}** setup prompts`, { phase: 'starters' });

      // Assemble the profile
      const enabledTools = [
        ...CORE_TOOLS,
        ...toolAudit.primaryTools,
        ...generatedTools.map(t => t.toolName),
      ];

      const assembledProfile: AppProfile = {
        id: proposedId,
        assistantName: brand.name,
        brand: {
          id: brand.id,
          name: brand.name,
          storageDir: `.agents/${brand.id}`,
          palette: brand.palette,
          intro: brand.intro,
        },
        vertical: {
          id: proposedId,
          label: brand.name,
          description: `${brand.name} — ${input.domain} agent`,
          assistantDescription: behavior.assistantDescription,
          starterPrompts: starters,
          enabledTools,
          guidedQa: {
            enabled: workflows.length > 0,
            workflows,
          },
          features: {
            slashCommandFamilies: { shariah: false },
            searchRanking,
          },
          sourcePolicy: behavior.sourcePolicy,
          toolUsagePolicy: behavior.toolUsagePolicy,
        },
      };

      this.session.assembledProfile = assembledProfile;

      // Review phase
      this.setState('reviewing', 'Profile assembled — ready for review');
      this.emit('review_ready', this.buildReviewSummary(assembledProfile));

      return { success: true, profileId: proposedId, profileName: brand.name };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(message);
    }
  }

  /**
   * Apply the assembled profile to disk.
   * Called after user approves during review phase.
   */
  async applyProfile(): Promise<CraftResult> {
    if (!this.session?.assembledProfile) {
      return this.fail('No assembled profile to apply');
    }

    const profile = this.session.assembledProfile;
    this.setState('applying', 'Writing profile files...');

    try {
      const profileDir = join(process.cwd(), '.agents', 'profiles', profile.id);
      const runtimeDir = join(process.cwd(), profile.brand.storageDir);

      // Create directories
      this.createDir(profileDir);
      this.createDir(runtimeDir);

      // Write profile.json
      const profileJsonPath = join(profileDir, 'profile.json');
      this.writeFile(profileJsonPath, JSON.stringify(profile, null, 2));
      this.emit('apply_progress', `Written: profile.json`, { progress: 30 });

      // Write SOUL.md
      if (this.session.soulMd) {
        const soulPath = join(profileDir, 'SOUL.md');
        this.writeFile(soulPath, this.session.soulMd);

        // Also copy to runtime dir for loadSoulDocument() resolution
        const runtimeSoulPath = join(runtimeDir, 'SOUL.md');
        this.writeFile(runtimeSoulPath, this.session.soulMd);
        this.emit('apply_progress', `Written: SOUL.md`, { progress: 50 });
      }

      // Write skills
      if (this.session.skills && this.session.skills.length > 0) {
        const skillsDir = join(profileDir, 'skills');
        this.createDir(skillsDir);

        for (const skill of this.session.skills) {
          const skillDir = join(skillsDir, skill.name);
          this.createDir(skillDir);

          const frontmatter = [
            '---',
            `name: ${skill.name}`,
            `description: >`,
            `  ${skill.description}`,
            `profiles: [${skill.profiles.join(', ')}]`,
            '---',
          ].join('\n');

          const skillContent = `${frontmatter}\n\n${skill.instructions}`;
          this.writeFile(join(skillDir, 'SKILL.md'), skillContent);
        }
        this.emit('apply_progress', `Written: ${this.session.skills.length} skill(s)`, { progress: 70 });
      }

      // Write generated tool files and register them
      if (this.session.generatedTools && this.session.generatedTools.length > 0) {
        const openDataDir = resolve(process.cwd(), OPEN_DATA_DIR);
        this.createDir(openDataDir);

        for (const gt of this.session.generatedTools) {
          const toolFilePath = join(openDataDir, `${gt.fileName}.ts`);
          this.writeFile(toolFilePath, gt.sourceCode);
        }
        this.emit('apply_progress', `Written: ${this.session.generatedTools.length} tool file(s)`, { progress: 75 });

        // Register in open-data/index.ts and registry.ts
        this.registerGeneratedTools(this.session.generatedTools);
        this.emit('apply_progress', 'Tools registered in index and registry', { progress: 85 });

        // Validate generated code compiles
        const valid = this.validateGeneratedTools();
        if (!valid) {
          throw new Error('Generated tool code failed typecheck — rolling back');
        }
        this.emit('apply_progress', 'Typecheck passed', { progress: 90 });
      }

      // Clear caches so the new profile is discoverable
      clearProfileCache();
      clearSkillCache();

      this.emit('apply_progress', 'Profile applied successfully', { progress: 100 });

      const writtenFiles = this.rollback.entries
        .filter(e => e.type === 'file_created')
        .map(e => e.path);

      this.setState('done', `Profile "${profile.brand.name}" created successfully`);
      this.emit('done', `Profile ${profile.id} is ready. Switch with /profile.`);

      return {
        success: true,
        profileId: profile.id,
        profileName: profile.brand.name,
        writtenFiles,
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.performRollback();
      return this.fail(`Apply failed (rolled back): ${message}`);
    }
  }

  // ==========================================================================
  // /craft refine
  // ==========================================================================

  async startRefine(profileId: string, direction?: string): Promise<CraftResult> {
    const profile = getProfileById(profileId);
    if (!profile) {
      return this.fail(`Profile "${profileId}" not found`);
    }

    this.session = {
      command: 'refine',
      input: {
        domain: profile.vertical.description,
        role: profile.vertical.assistantDescription,
      },
      targetProfileId: profileId,
      existingProfile: profile,
    };
    this.rollback = { entries: [] };
    this.abortController = new AbortController();

    try {
      this.setState('analyzing', `Auditing profile "${profileId}"...`);

      // Phase 1: Profile health check (5-layer audit)
      this.emit('phase_start', 'Running profile health check...', { phase: 'health_check' });
      const healthReport = await this.auditProfileHealth(profile);
      this.emit('phase_complete', 'Health check complete', { phase: 'health_check' });

      // Phase 2: Enrichment scan
      this.emit('phase_start', 'Scanning for enrichment opportunities...', { phase: 'enrichment' });
      const enrichmentReport = await this.enrichmentScan(profile, direction);
      this.emit('phase_complete', 'Enrichment scan complete', { phase: 'enrichment' });

      // Phase 3: Generate refinement suggestions
      this.emit('phase_start', 'Generating refinement suggestions...', { phase: 'suggestions' });
      const suggestions = await this.generateRefinements(profile, healthReport, enrichmentReport, direction);
      this.emit('phase_complete', `${suggestions.items.length} refinements suggested`, { phase: 'suggestions' });

      // Build review summary
      this.setState('reviewing', 'Refinements ready for review');
      const summary = this.buildRefineReviewSummary(profile, healthReport, enrichmentReport, suggestions);
      this.emit('review_ready', summary);

      // Store suggestions for applyRefinements()
      this.session.refineSuggestions = suggestions;

      return { success: true, profileId, profileName: profile.brand.name };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(message);
    }
  }

  /**
   * Apply selected refinements from a /craft refine session.
   * @param selectedIndices - indices of suggestions to apply (1-based), or 'all'
   */
  async applyRefinements(selectedIndices: number[] | 'all'): Promise<CraftResult> {
    if (!this.session?.existingProfile || !this.session.refineSuggestions) {
      return this.fail('No refinement session active');
    }

    const profile = this.session.existingProfile;
    const suggestions = this.session.refineSuggestions;
    const items = selectedIndices === 'all'
      ? suggestions.items
      : suggestions.items.filter((_, i) => selectedIndices.includes(i + 1));

    if (items.length === 0) {
      return this.fail('No refinements selected');
    }

    this.setState('applying', `Applying ${items.length} refinements...`);

    try {
      // Build the refined profile by applying selected changes
      const refined = structuredClone(profile);

      for (const item of items) {
        switch (item.category) {
          case 'tools':
            if (item.action === 'add' && item.toolName) {
              refined.vertical.enabledTools = [...(refined.vertical.enabledTools ?? []), item.toolName];
            }
            break;
          case 'search_ranking':
            if (item.searchRankingPatch) {
              refined.vertical.features.searchRanking = {
                ...refined.vertical.features.searchRanking,
                ...item.searchRankingPatch,
              };
            }
            break;
          case 'workflows':
            if (item.workflow) {
              refined.vertical.guidedQa = refined.vertical.guidedQa ?? { enabled: true, workflows: [] };
              refined.vertical.guidedQa.workflows.push(item.workflow);
            }
            break;
          case 'source_policy':
            if (item.directive) {
              refined.vertical.sourcePolicy = [...(refined.vertical.sourcePolicy ?? []), item.directive];
            }
            break;
          case 'tool_usage_policy':
            if (item.directive) {
              refined.vertical.toolUsagePolicy = [...(refined.vertical.toolUsagePolicy ?? []), item.directive];
            }
            break;
          case 'search_domains':
            if (item.domains) {
              const sr = refined.vertical.features.searchRanking ?? {};
              if (item.action === 'add_preferred') {
                sr.preferredDomains = [...(sr.preferredDomains ?? []), ...item.domains];
              } else if (item.action === 'add_primary') {
                sr.primaryDomains = [...(sr.primaryDomains ?? []), ...item.domains];
              }
              refined.vertical.features.searchRanking = sr;
            }
            break;
          case 'intent_boost':
            if (item.intentBoost) {
              const sr = refined.vertical.features.searchRanking ?? {};
              sr.intentBoosts = [...(sr.intentBoosts ?? []), item.intentBoost];
              refined.vertical.features.searchRanking = sr;
            }
            break;
        }
      }

      // Write as external profile overlay (works for both builtin and crafted)
      const profileDir = join(process.cwd(), '.agents', 'profiles', profile.id);
      this.createDir(profileDir);

      const profileJsonPath = join(profileDir, 'profile.json');
      this.writeFile(profileJsonPath, JSON.stringify(refined, null, 2));

      clearProfileCache();
      clearSkillCache();

      const writtenFiles = this.rollback.entries
        .filter(e => e.type === 'file_created')
        .map(e => e.path);

      this.setState('done', `${items.length} refinements applied to "${profile.id}"`);
      this.emit('done', `Profile "${profile.id}" refined. Changes saved as external overlay.`);

      return {
        success: true,
        profileId: profile.id,
        profileName: profile.brand.name,
        writtenFiles,
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.performRollback();
      return this.fail(`Refinement failed (rolled back): ${message}`);
    }
  }

  // ==========================================================================
  // Refine Phase Implementations
  // ==========================================================================

  private async auditProfileHealth(profile: AppProfile): Promise<string> {
    const enabledTools = profile.vertical.enabledTools ?? [];
    const workflows = profile.vertical.guidedQa?.workflows ?? [];
    const sourcePolicy = profile.vertical.sourcePolicy ?? [];
    const searchRanking = profile.vertical.features.searchRanking;

    const result = await callLlm(
      `Profile: ${profile.id} (${profile.vertical.label})
Description: ${profile.vertical.assistantDescription}
Enabled tools: ${enabledTools.join(', ')}
Workflows: ${workflows.map(w => w.label).join(', ') || 'none'}
Source policy directives: ${sourcePolicy.length}
Search ranking primary domains: ${searchRanking?.primaryDomains?.join(', ') || 'none'}
Intent boosts: ${searchRanking?.intentBoosts?.length ?? 0}

Audit this profile across 5 layers:
A. Tool audit — are all enabled tools relevant? Any missing tools?
B. Source ranking audit — are primary/preferred domains complete? Any missing intent boosts?
C. Workflow audit — are the workflows comprehensive for this domain? Any gaps?
D. Skill audit — what skills would enhance this profile?
E. Behavioral directive audit — are source/tool usage policies complete?

For each layer, report: what's good (✓), what's missing (⚠), and what's wrong (✗).`,
      {
        systemPrompt: 'You are a profile quality auditor. Produce a structured health report with specific, actionable findings. Use ✓/⚠/✗ markers.',
        signal: this.abortController?.signal,
      },
    );

    return typeof result.response === 'string' ? result.response : String(result.response);
  }

  private async enrichmentScan(profile: AppProfile, direction?: string): Promise<string> {
    const result = await callLlm(
      `Profile: ${profile.id} — ${profile.vertical.description}
Current tools: ${(profile.vertical.enabledTools ?? []).join(', ')}
${direction ? `User direction: ${direction}` : ''}

Scan for enrichment opportunities:
1. Free public APIs relevant to this domain that the profile doesn't use yet
2. Dormant keyed tools (enabled but likely missing API key)
3. Tool chain gaps (tools that would work better together)
4. New intent boost keyword groups

Focus on concrete, actionable items. For each API, include the endpoint URL.`,
      {
        systemPrompt: 'You are a domain enrichment scanner. Find concrete data sources and tool improvements. Be specific about APIs and endpoints.',
        signal: this.abortController?.signal,
      },
    );

    return typeof result.response === 'string' ? result.response : String(result.response);
  }

  private async generateRefinements(
    profile: AppProfile,
    healthReport: string,
    enrichmentReport: string,
    direction?: string,
  ): Promise<RefineSuggestions> {
    const schema = z.object({
      items: z.array(z.object({
        index: z.number(),
        category: z.enum([
          'tools', 'search_ranking', 'workflows', 'source_policy',
          'tool_usage_policy', 'search_domains', 'intent_boost',
        ]),
        label: z.string(),
        description: z.string(),
        action: z.string().nullable(),
        toolName: z.string().nullable(),
        directive: z.string().nullable(),
        domains: z.array(z.string()).nullable(),
      })),
    });

    const directionBlock = direction
      ? `\n\nIMPORTANT — User direction: "${direction}"\nPrioritize suggestions that directly address this direction. Place direction-relevant suggestions first. At least half of all suggestions must relate to the user's stated direction. Generic audit-based suggestions should come after direction-relevant ones.`
      : '';

    const result = await callLlm(
      `Profile: ${profile.id}
Health report:
${healthReport}

Enrichment scan:
${enrichmentReport}${directionBlock}

Generate a numbered list of specific refinement suggestions. Each item should have:
- category: what aspect it changes (tools, search_ranking, workflows, source_policy, tool_usage_policy, search_domains, intent_boost)
- label: short title
- description: what it does and why
- action: specific action (add, remove, modify)
- toolName: tool name if adding a tool
- directive: text if adding a policy directive
- domains: domain list if adding search domains

Order by impact (most impactful first). Max 12 items.`,
      {
        systemPrompt: 'Generate actionable profile refinement suggestions. Each must be specific and self-contained. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    return stripNulls(result.response) as unknown as RefineSuggestions;
  }

  private buildRefineReviewSummary(
    profile: AppProfile,
    _healthReport: string,
    _enrichmentReport: string,
    suggestions: RefineSuggestions,
  ): string {
    const l: string[] = [];

    l.push(`## Audit: ${profile.brand.name}`);
    l.push('');

    // Group suggestions by category for cleaner display
    const categories: Record<string, typeof suggestions.items> = {};
    for (const item of suggestions.items) {
      const cat = item.category;
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(item);
    }

    const categoryLabels: Record<string, string> = {
      tools: 'Tools & Data',
      search_ranking: 'Search Ranking',
      search_domains: 'Search Domains',
      intent_boost: 'Intent Boosts',
      workflows: 'Workflows',
      source_policy: 'Source Policy',
      tool_usage_policy: 'Tool Usage Policy',
    };

    for (const [cat, items] of Object.entries(categories)) {
      l.push(`**${categoryLabels[cat] ?? cat}**`);
      for (const item of items) {
        l.push(`  **[${item.index}]** ${item.label}`);
        l.push(`  ${item.description}`);
      }
      l.push('');
    }

    l.push('---');
    l.push('');
    l.push('**What next?**');
    l.push('- Type numbers to apply specific refinements: **1, 3, 5**');
    l.push('- Type **all** to apply everything');
    l.push('- Type **cancel** to discard');
    l.push('- Or describe what you want: *"focus more on cloud security"*');

    return l.join('\n');
  }

  // ==========================================================================
  // /craft delete
  // ==========================================================================

  async deleteProfile(profileId: string): Promise<CraftResult> {
    const profiles = listProfiles();
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) {
      return this.fail(`Profile "${profileId}" not found`);
    }

    // Check if it's a crafted (external) profile
    const profileDir = join(process.cwd(), '.agents', 'profiles', profileId);
    if (!existsSync(profileDir)) {
      return this.fail(`Cannot delete builtin profile "${profileId}". Only crafted profiles can be deleted.`);
    }

    // If it's the currently active profile, warn
    if (getCurrentProfileId() === profileId) {
      this.emit('state_change', 'Warning: deleting the currently active profile. Will revert to default.');
    }

    this.setState('applying', `Deleting profile "${profileId}"...`);

    try {
      // Find generated tools that belong exclusively to this profile
      const orphanedTools = this.findOrphanedTools(profile, profiles);
      if (orphanedTools.length > 0) {
        this.emit('state_change', `Cleaning up ${orphanedTools.length} generated tool(s) exclusive to this profile...`);
        this.removeGeneratedTools(orphanedTools);
      }

      // Remove profile definition directory
      rmSync(profileDir, { recursive: true, force: true });

      // Remove runtime directory if it exists
      const runtimeDir = join(process.cwd(), profile.brand.storageDir);
      if (existsSync(runtimeDir)) {
        rmSync(runtimeDir, { recursive: true, force: true });
      }

      clearProfileCache();
      clearSkillCache();

      const deletedToolNames = orphanedTools.length > 0
        ? ` Removed ${orphanedTools.length} orphaned tool(s): ${orphanedTools.join(', ')}.`
        : '';
      this.setState('done', `Profile "${profileId}" deleted.${deletedToolNames}`);
      return { success: true, profileId };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(`Delete failed: ${message}`);
    }
  }

  /**
   * Find tools in this profile's enabledTools that are generated (exist in open-data dir
   * with the crafted marker comment) and not used by any other profile.
   */
  private findOrphanedTools(profile: AppProfile, allProfiles: AppProfile[]): string[] {
    const profileTools = new Set(profile.vertical.enabledTools ?? []);
    const otherProfiles = allProfiles.filter(p => p.id !== profile.id);
    const otherTools = new Set(otherProfiles.flatMap(p => p.vertical.enabledTools ?? []));
    const cwd = process.cwd();

    const orphaned: string[] = [];
    for (const toolName of profileTools) {
      // Skip if another profile uses this tool
      if (otherTools.has(toolName)) continue;

      // Check if this is a generated tool (file exists in open-data dir with crafted marker)
      const fileName = toolName.replace(/_/g, '-');
      const toolFilePath = join(cwd, OPEN_DATA_DIR, `${fileName}.ts`);
      if (!existsSync(toolFilePath)) continue;

      const content = readFileSync(toolFilePath, 'utf-8');
      if (content.includes('// Generated by /craft')) {
        orphaned.push(toolName);
      }
    }
    return orphaned;
  }

  /**
   * Remove generated tool files and their registry entries.
   */
  private removeGeneratedTools(toolNames: string[]): void {
    const cwd = process.cwd();

    // Remove tool files
    for (const toolName of toolNames) {
      const fileName = toolName.replace(/_/g, '-');
      const toolFilePath = join(cwd, OPEN_DATA_DIR, `${fileName}.ts`);
      if (existsSync(toolFilePath)) {
        rmSync(toolFilePath);
      }
    }

    // Clean open-data/index.ts — remove export lines for these tools
    const indexPath = resolve(cwd, OPEN_DATA_INDEX);
    if (existsSync(indexPath)) {
      let indexContent = readFileSync(indexPath, 'utf-8');
      for (const toolName of toolNames) {
        const fileName = toolName.replace(/_/g, '-');
        // Remove export block for this tool
        const exportPattern = new RegExp(
          `export \\{[^}]*\\} from '\\.\\/${fileName}\\.js';\\n?`,
          'g',
        );
        indexContent = indexContent.replace(exportPattern, '');
      }
      writeFileSync(indexPath, indexContent, 'utf-8');
    }

    // Clean registry.ts — remove tool push blocks and imports
    const registryPath = resolve(cwd, REGISTRY_PATH);
    if (existsSync(registryPath)) {
      let registryContent = readFileSync(registryPath, 'utf-8');
      for (const toolName of toolNames) {
        // Remove tools.push block for this tool
        const pushPattern = new RegExp(
          `\\s*tools\\.push\\(\\{[^}]*name: '${toolName}'[^}]*\\}\\);`,
          'g',
        );
        registryContent = registryContent.replace(pushPattern, '');
      }
      writeFileSync(registryPath, registryContent, 'utf-8');
    }
  }

  // ==========================================================================
  // Abort
  // ==========================================================================

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.session = null;
    this._state = 'idle';
  }

  // ==========================================================================
  // LLM Phase Implementations
  // ==========================================================================

  private async analyzeTools(domain: string, role: string): Promise<ToolAuditResult> {
    const toolInventory = getToolRegistry(DEFAULT_CRAFT_MODEL).map(t => ({
      name: t.name,
      description: t.description.slice(0, 200),
    }));

    const schema = z.object({
      tools: z.array(z.object({
        name: z.string(),
        classification: z.enum(['primary', 'supporting', 'irrelevant']),
        reason: z.string(),
      })),
    });

    const result = await callLlm(
      `Domain: ${domain}\nRole: ${role}\n\nAvailable tools:\n${JSON.stringify(toolInventory, null, 2)}\n\nClassify each tool as "primary" (directly serves this domain), "supporting" (useful core infrastructure), or "irrelevant" (doesn't apply to this domain). Be selective — only mark tools as "primary" if they directly serve the domain's core data needs.`,
      {
        systemPrompt: 'You are a tool classification expert. Classify each tool based on its relevance to the given domain and role. Return a JSON object with a "tools" array.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    const parsed = stripNulls(result.response) as unknown as z.infer<typeof schema>;
    const primaryTools = parsed.tools
      .filter(t => t.classification === 'primary')
      .map(t => t.name);
    const supportingTools = parsed.tools
      .filter(t => t.classification === 'supporting')
      .map(t => t.name);

    return { tools: parsed.tools, primaryTools, supportingTools };
  }

  private async mapSources(domain: string, primaryTools: string[]): Promise<SearchRankingConfig> {
    const schema = z.object({
      providerWeights: z.object({
        exa: z.number().nullable(),
        perplexity: z.number().nullable(),
        tavily: z.number().nullable(),
        brave: z.number().nullable(),
      }).nullable(),
      preferredDomains: z.array(z.string()),
      primaryDomains: z.array(z.string()),
      intentBoosts: z.array(z.object({
        keywords: z.array(z.string()),
        domains: z.array(z.string()).nullable(),
        providers: z.object({
          exa: z.number().nullable(),
          perplexity: z.number().nullable(),
          tavily: z.number().nullable(),
          brave: z.number().nullable(),
        }).nullable(),
        boost: z.number().nullable(),
      })),
    });

    const result = await callLlm(
      `Domain: ${domain}\nPrimary tools: ${primaryTools.join(', ')}\n\nGenerate a search ranking configuration for this domain. Include:\n1. Provider weights (exa for structured gov/academic data, perplexity for synthesis, tavily as baseline 1.0, brave for forums)\n2. preferredDomains: 8-15 authoritative websites for this domain\n3. primaryDomains: 3-6 most authoritative sources\n4. intentBoosts: 2-4 keyword groups with domain-specific boost values (5-15)`,
      {
        systemPrompt: 'You are a search ranking expert. Generate a domain-specific search configuration that prioritizes authoritative sources. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    return stripNulls(result.response) as unknown as SearchRankingConfig;
  }

  private async generateWorkflows(domain: string, role: string): Promise<ProfileGuidedQaWorkflow[]> {
    const schema = z.object({
      workflows: z.array(z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
        triggerKeywords: z.array(z.string()).nullable(),
        autoTrigger: z.enum(['never', 'broad-only', 'always']).nullable(),
        questions: z.array(z.object({
          id: z.string(),
          title: z.string(),
          prompt: z.string(),
          kind: z.enum(['single', 'multi', 'text']),
          options: z.array(z.object({
            value: z.string(),
            label: z.string(),
            description: z.string().nullable(),
          })).nullable(),
          allowSkip: z.boolean().nullable(),
          placeholder: z.string().nullable(),
          summaryLabel: z.string().nullable(),
          prefillFrom: z.enum(['query']).nullable(),
          when: z.object({
            field: z.string(),
            equals: z.union([z.string(), z.array(z.string())]).nullable(),
            notEquals: z.union([z.string(), z.array(z.string())]).nullable(),
          }).nullable(),
        })),
      })),
    });

    const result = await callLlm(
      `Domain: ${domain}\nRole: ${role}\n\nGenerate 3-5 domain-native guided Q&A workflows that reflect how real practitioners in this domain work. Rules:\n- At most 1 workflow uses autoTrigger: "always"\n- 2-3 should use "broad-only"\n- Each workflow should have 2-4 questions\n- Use conditional "when" fields where questions depend on prior answers\n- Use "single" kind for categorical choices, "text" for open-ended, "multi" for multi-select\n- Include summaryLabel for each question\n- triggerKeywords should be domain-specific terms`,
      {
        systemPrompt: 'You are a domain workflow expert. Generate practitioner-native workflows, not generic templates. Each workflow should reflect real professional processes in this domain. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    const parsed = result.response as unknown as z.infer<typeof schema>;
    return stripNulls(parsed.workflows) as unknown as ProfileGuidedQaWorkflow[];
  }

  private async generateBehavior(domain: string, role: string, primaryTools: string[]): Promise<BehaviorResult> {
    const schema = z.object({
      sourcePolicy: z.array(z.string()),
      toolUsagePolicy: z.array(z.string()),
      assistantDescription: z.string(),
    });

    const result = await callLlm(
      `Domain: ${domain}\nRole: ${role}\nPrimary tools: ${primaryTools.join(', ')}\n\nGenerate behavioral directives:\n1. sourcePolicy (4-8 directives): Which sources to prefer, citation requirements, jurisdiction/authority distinctions\n2. toolUsagePolicy (3-6 directives): How to chain tools, when to use specific tools vs web_search, tool-specific guidance\n3. assistantDescription: One paragraph describing the assistant's capabilities and approach\n\nEvery tool referenced must be in the primary tools list or core tools (web_search, web_fetch, browser, read_file, write_file).`,
      {
        systemPrompt: 'You are a behavioral directive specialist. Generate domain-specific guidance that shapes how an AI assistant thinks and acts in this domain. Be specific, not generic. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    return stripNulls(result.response) as unknown as BehaviorResult;
  }

  private async generateSoul(domain: string, role: string, name: string): Promise<string> {
    const result = await callLlm(
      `Domain: ${domain}\nRole: ${role}\nAgent name: ${name}\n\nWrite a SOUL.md identity document for this agent. Include:\n1. "Who I Am" — 2-3 sentences establishing identity and purpose\n2. "How I Think About [Domain]" — 4-6 bullet points on methodology\n3. "What I Value" — 3-4 bullet points on professional values\n\nWrite in first person. Be specific to the domain, not generic. Keep it concise (under 300 words).`,
      {
        systemPrompt: `Write a SOUL.md identity document. Use markdown format with ## headings. Write in the agent's voice — confident, domain-expert, professional.`,
        signal: this.abortController?.signal,
      },
    );

    return typeof result.response === 'string'
      ? result.response
      : String(result.response);
  }

  private async generateSkills(
    domain: string,
    role: string,
    profileId: string,
    workflows: ProfileGuidedQaWorkflow[],
  ): Promise<SkillFile[]> {
    const schema = z.object({
      skills: z.array(z.object({
        name: z.string(),
        description: z.string(),
        instructions: z.string(),
      })),
    });

    const workflowNames = workflows.map(w => w.label).join(', ');

    const result = await callLlm(
      `Domain: ${domain}\nRole: ${role}\nExisting workflows: ${workflowNames}\n\nGenerate 1-2 SKILL.md files for this domain. Each skill should:\n- Address a complex multi-step task common in this domain\n- Include a step-by-step workflow with checkboxes\n- Reference specific tools or data sources to use at each step\n- NOT duplicate the guided Q&A workflows (those handle simple clarifications)\n\nReturn the skill name, description, and full instructions (markdown body).`,
      {
        systemPrompt: 'You are a skill designer. Create actionable, step-by-step skill instructions for domain-specific complex tasks. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    const parsed = stripNulls(result.response) as unknown as z.infer<typeof schema>;
    return parsed.skills.map(s => ({
      ...s,
      profiles: [profileId],
    }));
  }

  private async generateBranding(domain: string, name: string): Promise<BrandConfig> {
    const schema = z.object({
      id: z.string(),
      name: z.string(),
      palette: z.object({
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
      }),
      intro: z.object({
        welcome: z.string(),
        title: z.string(),
        subtitle: z.string(),
        logoAscii: z.string(),
      }),
    });

    const result = await callLlm(
      `Domain: ${domain}\nAgent name: ${name}\nExisting palette primaries to avoid: ${getExistingPalettePrimaries().join(', ')}\n\nGenerate branding for this agent:\n1. id: kebab-case short name (e.g., "lexis")\n2. name: display name\n3. palette: full 12-color palette with a unique primary color (hex format)\n4. intro: welcome message, title, subtitle, and ASCII art logo using block characters (██╗ style)\n\nThe primary color must NOT match any existing palette primary.`,
      {
        systemPrompt: 'You are a brand designer for terminal UI agents. Generate a cohesive brand identity with a unique color palette. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    return stripNulls(result.response) as unknown as BrandConfig;
  }

  private async generateStarterPrompts(domain: string, role: string, primaryTools: string[]): Promise<StarterPrompts> {
    const schema = z.object({
      ready: z.array(z.string()),
      setup: z.array(z.string()),
    });

    const result = await callLlm(
      `Domain: ${domain}\nRole: ${role}\nPrimary tools: ${primaryTools.join(', ')}\n\nGenerate starter prompts:\n1. "ready" (6 prompts): Questions the agent can answer well using its tools. Be specific — reference real data sources, entities, or processes in this domain.\n2. "setup" (6 prompts): Onboarding questions for new users to learn the agent's capabilities.\n\nEvery "ready" prompt must be answerable with the available tools.`,
      {
        systemPrompt: 'Generate domain-specific starter prompts that showcase real capabilities. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    return stripNulls(result.response) as unknown as StarterPrompts;
  }

  // ==========================================================================
  // Tool Generation Phase Methods
  // ==========================================================================

  /**
   * Phase 1b-1: Discover candidate APIs for the domain using LLM knowledge.
   * Finds free/freemium JSON APIs relevant to the domain.
   */
  private async discoverApis(
    domain: string,
    role: string,
    existingPrimaryTools: string[],
  ): Promise<ApiDiscoveryResult> {
    const schema = z.object({
      recommended: z.array(z.object({
        name: z.string().describe('Human-readable API name'),
        endpoint: z.string().describe('Full base URL for the API (must be a real, working URL)'),
        description: z.string().describe('What this API provides'),
        auth: z.enum(['none', 'free-key', 'paid']),
        recommended: z.boolean(),
        toolName: z.string().describe('Tool name in snake_case (e.g., "uscis_case_search")'),
      })),
      gaps: z.array(z.object({
        name: z.string(),
        reason: z.string(),
        workaround: z.string().describe('Workaround using existing tools, or empty string if none'),
      })),
      keyedUpgrades: z.array(z.object({
        name: z.string(),
        endpoint: z.string(),
        description: z.string(),
        auth: z.enum(['none', 'free-key', 'paid']),
        recommended: z.boolean(),
        toolName: z.string().describe('Tool name in snake_case, or empty string if not applicable'),
      })),
    });

    // Get existing tool names to avoid duplicates
    const existingToolNames = getToolRegistry(DEFAULT_CRAFT_MODEL).map(t => t.name);

    const result = await callLlm(
      `Domain: ${domain}
Role: ${role}
Existing tools already available: ${existingPrimaryTools.join(', ')}
All registered tool names (to avoid conflicts): ${existingToolNames.join(', ')}

Discover ALL relevant FREE public APIs that would add domain-specific data capabilities. Be thorough — scan government open-data portals, international organizations, academic databases, industry registries, and established open-data platforms.

Requirements for each API:
- Must be free or have a usable free tier (no paid-only APIs)
- Must return JSON responses
- Prefer government (.gov), intergovernmental (.org), and established open-data platforms
- No OAuth flows — simple API key or no auth only
- Tool names must be snake_case and NOT conflict with existing tool names
- Only recommend APIs you are confident actually exist and work
- Provide the actual base endpoint URL with example query parameters filled in

Be exhaustive — recommend up to 10 APIs if the domain has that many quality free sources. Every relevant public dataset that has a JSON API should be listed.

Also report:
- "gaps": important data sources for this domain that have no free API (include the data source name and why it matters)
- "keyedUpgrades": paid/freemium APIs that would significantly enhance the profile (for future upgrade consideration)`,
      {
        systemPrompt: 'You are an API discovery specialist with deep knowledge of government open-data portals, international organization APIs, academic databases, and public registries. Be thorough — find every relevant free JSON API for the domain. Only recommend APIs you are certain exist with working endpoints. Verify endpoint URL patterns are correct. Return JSON.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    const parsed = stripNulls(result.response) as unknown as ApiDiscoveryResult;

    // Filter out any tools that would conflict with existing names
    parsed.recommended = parsed.recommended.filter(api => {
      if (!api.toolName || existingToolNames.includes(api.toolName)) {
        parsed.gaps.push({
          name: api.name,
          reason: `Tool name "${api.toolName}" conflicts with existing tool`,
        });
        return false;
      }
      return true;
    });

    return parsed;
  }

  /**
   * Phase 1b-2: Smoke test a candidate API with a real HTTP request.
   */
  private async smokeTestApi(api: ApiCandidate): Promise<SmokeTestResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SMOKE_TEST_TIMEOUT_MS);

      const response = await fetch(api.endpoint, {
        headers: {
          'User-Agent': 'Yassir/2026 open-data tool',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          api,
          ok: false,
          statusCode: response.status,
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { api, ok: false, error: 'Response is not valid JSON' };
      }

      // Verify it has some array-like structure
      const hasArray = this.hasArrayStructure(json);
      if (!hasArray) {
        return { api, ok: false, error: 'Response does not contain an array-like data structure' };
      }

      // Truncate response sample for code generation context
      const responseSample = text.length > 2000 ? text.slice(0, 2000) + '...' : text;

      return { api, ok: true, statusCode: response.status, responseSample };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { api, ok: false, error: message };
    }
  }

  /**
   * Check if a JSON value contains an array-like structure at any level.
   */
  private hasArrayStructure(value: unknown, depth = 0): boolean {
    if (depth > 3) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some(
        v => this.hasArrayStructure(v, depth + 1),
      );
    }
    return false;
  }

  /**
   * Phase 1b-3: Generate TypeScript tool code from a validated API.
   */
  private async generateToolCode(
    api: ApiCandidate,
    responseSample: string,
    domain: string,
  ): Promise<GeneratedToolFile | null> {
    const toolName = api.toolName!;
    const fileName = toolName.replace(/_/g, '-');
    const varName = toolName.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) + 'Tool';
    const descVarName = toolName.toUpperCase() + '_DESCRIPTION';

    const schema = z.object({
      sourceCode: z.string().describe('Complete TypeScript source code for the tool file'),
    });

    const result = await callLlm(
      `Generate a Yassir open-data tool for: ${api.name}
API endpoint: ${api.endpoint}
Description: ${api.description}
Auth: ${api.auth}
Domain: ${domain}

Sample API response (truncated):
${responseSample}

Requirements:
- Export a description constant named "${descVarName}" (template literal, trimmed)
- Export a DynamicStructuredTool named "${varName}"
- Tool name property must be exactly "${toolName}"
- Import from: '@langchain/core/tools' (DynamicStructuredTool), 'zod' (z), './common.js' (fetchJson, finalizeOpenDataResult)
- Schema: at minimum a \`query\` string param and optional \`limit\` number (1-10, default 5)
- Use fetchJson<T>() with a typed response interface
- Transform results into a clean, flat array of objects
- Return via finalizeOpenDataResult(data, [url])
- Handle empty results gracefully (return empty array)
- ${api.auth === 'free-key' ? 'Wrap the API key in process.env.' + toolName.toUpperCase() + '_API_KEY' : 'No API key needed'}

Follow this exact pattern from an existing tool:
\`\`\`typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchJson, finalizeOpenDataResult } from './common.js';

export const ${descVarName} = \`
Description here.

When to use: specific use cases.
\`.trim();

interface ResponseType {
  // typed from sample
}

export const ${varName} = new DynamicStructuredTool({
  name: '${toolName}',
  description: ${descVarName},
  schema: z.object({
    query: z.string().describe('...'),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  func: async (input) => {
    const limit = input.limit ?? 5;
    const url = \`...\`;
    const response = await fetchJson<ResponseType>(url);
    const results = ...;
    return finalizeOpenDataResult({ query: input.query, results }, [url]);
  },
});
\`\`\`

Return ONLY the complete TypeScript source code. No markdown fences, no explanations.`,
      {
        systemPrompt: 'You are a TypeScript code generator. Generate clean, production-ready tool code following the exact pattern provided. Return only the source code as a JSON object with a "sourceCode" field.',
        outputSchema: schema,
        signal: this.abortController?.signal,
      },
    );

    const parsed = stripNulls(result.response) as unknown as z.infer<typeof schema>;
    let sourceCode = parsed.sourceCode;

    // Strip markdown fences if the LLM included them
    sourceCode = sourceCode
      .replace(/^```(?:typescript|ts)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    // Add marker so /craft delete can identify generated tools
    if (!sourceCode.startsWith('// Generated by /craft')) {
      sourceCode = `// Generated by /craft — do not edit manually\n\n${sourceCode}`;
    }

    return {
      toolName,
      fileName,
      varName,
      descriptionVarName: descVarName,
      sourceCode,
      api,
    };
  }

  /**
   * Phase 1b-4: Register generated tools in open-data/index.ts and registry.ts.
   * Uses pattern-based insertion (append to known locations).
   */
  private registerGeneratedTools(tools: GeneratedToolFile[]): void {
    if (tools.length === 0) return;

    const cwd = process.cwd();

    // 1. Append exports to open-data/index.ts
    const indexPath = resolve(cwd, OPEN_DATA_INDEX);
    const indexContent = readFileSync(indexPath, 'utf-8');

    const newExports = tools.map(t =>
      `export {\n  ${t.varName},\n  ${t.descriptionVarName},\n} from './${t.fileName}.js';`,
    ).join('\n');

    this.writeFile(indexPath, indexContent.trimEnd() + '\n' + newExports + '\n');

    // 2. Modify registry.ts — add imports and tool registrations
    const registryPath = resolve(cwd, REGISTRY_PATH);
    const registryContent = readFileSync(registryPath, 'utf-8');

    // Extend the existing open-data import block with new tool names
    const existingImportMatch = registryContent.match(
      /import \{([^}]+)\} from '\.\/open-data\/index\.js';/s,
    );

    let updatedRegistry = registryContent;

    if (existingImportMatch) {
      // Parse existing import names, preserving formatting
      const existingLines = existingImportMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l !== ',');

      const newLines = tools.flatMap(t => [
        `${t.varName},`,
        `${t.descriptionVarName},`,
      ]);

      const allLines = [...existingLines, ...newLines].map(l => `  ${l}`);
      const extendedImport = `import {\n${allLines.join('\n')}\n} from './open-data/index.js';`;
      updatedRegistry = updatedRegistry.replace(existingImportMatch[0], extendedImport);
    }

    // Add tool registrations before the return line (regex for whitespace tolerance)
    const returnPattern = /(\s*return\s+allowedTools\s*\?\s*tools\.filter\([^)]*\)\s*:\s*tools;)/;
    const returnMatch = updatedRegistry.match(returnPattern);
    if (!returnMatch) {
      throw new Error('Could not find return statement in registry.ts — format may have changed');
    }

    const toolRegistrations = tools.map(t =>
      `  tools.push({\n    name: '${t.toolName}',\n    tool: ${t.varName},\n    description: ${t.descriptionVarName},\n  });`,
    ).join('\n\n');

    updatedRegistry = updatedRegistry.replace(
      returnMatch[1],
      `  // Generated tools (crafted)\n${toolRegistrations}\n\n${returnMatch[1]}`,
    );

    this.writeFile(registryPath, updatedRegistry);
  }

  /**
   * Phase 1b-5: Validate generated tools by running typecheck.
   */
  private validateGeneratedTools(): boolean {
    try {
      execSync('bun run typecheck', {
        cwd: process.cwd(),
        timeout: 30_000,
        stdio: 'pipe',
      });
      return true;
    } catch (err) {
      const stderr = err instanceof Error && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr)
        : String(err);
      logger.warn(`Tool generation typecheck failed: ${stderr.slice(0, 500)}`);
      return false;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private generateProfileId(domain: string): string {
    let base = domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (base.length > 30) base = base.slice(0, 30);

    // Auto-suffix if the base ID already exists
    const existing = listProfiles();
    const existingIds = new Set(existing.map(p => p.id));
    if (!existingIds.has(base)) return base;

    let i = 2;
    while (existingIds.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  private generateBrandId(domain: string): string {
    const words = domain.toLowerCase().split(/\s+/);
    return words[0]?.replace(/[^a-z0-9]/g, '') ?? 'agent';
  }

  private generateBrandName(domain: string): string {
    // Use first word, capitalized
    const words = domain.split(/\s+/);
    const first = words[0] ?? 'Agent';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  private checkCollisions(proposedId: string, proposedBrandId: string, proposedPalettePrimary?: string): CollisionResult {
    const existing = listProfiles();
    const palettePrimaries = getExistingPalettePrimaries();
    return {
      idCollision: existing.some(p => p.id === proposedId),
      brandIdCollision: existing.some(p => p.brand.id === proposedBrandId),
      paletteCollision: proposedPalettePrimary
        ? palettePrimaries.includes(proposedPalettePrimary.toLowerCase())
        : false,
    };
  }

  private buildReviewSummary(profile: AppProfile): string {
    const s = this.session;
    const l: string[] = [];

    // Header
    l.push(`## ${profile.brand.name}`);
    l.push('');
    l.push(`*${profile.vertical.assistantDescription}*`);
    l.push('');

    // Tools
    const toolCount = profile.vertical.enabledTools?.length ?? 0;
    const genCount = s?.generatedTools?.length ?? 0;
    l.push(`**Tools** — ${toolCount} enabled${genCount > 0 ? ` (${genCount} new)` : ''}`);
    if (s?.toolAudit?.primaryTools.length) {
      l.push(`  Domain-specific: ${s.toolAudit.primaryTools.map(t => `\`${t}\``).join(', ')}`);
    }
    if (s?.generatedTools?.length) {
      for (const gt of s.generatedTools) {
        l.push(`  **NEW** \`${gt.toolName}\` — ${gt.api.description.slice(0, 80)}`);
      }
    }
    l.push('');

    // Search ranking
    const sr = profile.vertical.features.searchRanking;
    if (sr) {
      l.push(`**Search Ranking** — ${sr.primaryDomains?.length ?? 0} primary sources, ${sr.intentBoosts?.length ?? 0} intent boosts`);
      if (sr.primaryDomains?.length) {
        l.push(`  Primary: ${sr.primaryDomains.slice(0, 5).join(', ')}${(sr.primaryDomains.length > 5) ? '...' : ''}`);
      }
      l.push('');
    }

    // Workflows
    const wfs = profile.vertical.guidedQa?.workflows ?? [];
    if (wfs.length > 0) {
      l.push(`**Workflows** — ${wfs.length} domain-native`);
      for (const wf of wfs) {
        const trigger = wf.autoTrigger === 'always' ? ' (auto)' : wf.autoTrigger === 'broad-only' ? ' (broad)' : '';
        l.push(`  - **${wf.label}**${trigger} — ${wf.description.slice(0, 60)}`);
      }
      l.push('');
    }

    // Skills
    if (s?.skills?.length) {
      l.push(`**Skills** — ${s.skills.length} reusable`);
      for (const sk of s.skills) {
        l.push(`  - **${sk.name}** — ${sk.description.slice(0, 60)}`);
      }
      l.push('');
    }

    // Behavioral directives
    const spCount = profile.vertical.sourcePolicy?.length ?? 0;
    const tpCount = profile.vertical.toolUsagePolicy?.length ?? 0;
    if (spCount > 0 || tpCount > 0) {
      l.push(`**Behavioral Directives** — ${spCount} source policies, ${tpCount} tool policies`);
      l.push('');
    }

    // Brand
    l.push(`**Identity** — ${profile.brand.name} | ${profile.brand.palette.primary} | ${profile.vertical.starterPrompts.ready.length} starter prompts`);
    l.push('');

    // Gaps
    if (s?.apiDiscovery?.gaps?.length) {
      l.push(`**Gaps** (no API available)`);
      for (const gap of s.apiDiscovery.gaps) {
        l.push(`  - ${gap.name}: ${gap.reason}${gap.workaround ? ` — *${gap.workaround}*` : ''}`);
      }
      l.push('');
    }

    // Next steps
    l.push('---');
    l.push('');
    l.push('**What next?**');
    l.push('- Type **apply** to create the profile');
    l.push('- Type **cancel** to discard');
    l.push('- Or describe changes: *"add more focus on X"*, *"remove tool Y"*, *"make the SOUL.md more formal"*');

    return l.join('\n');
  }

  // ==========================================================================
  // File operations with rollback tracking
  // ==========================================================================

  private createDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      this.rollback.entries.push({ type: 'dir_created', path: dirPath });
    }
  }

  private writeFile(filePath: string, content: string): void {
    const existed = existsSync(filePath);
    const original = existed ? readFileSync(filePath, 'utf-8') : undefined;

    writeFileSync(filePath, content, 'utf-8');

    this.rollback.entries.push({
      type: existed ? 'file_modified' : 'file_created',
      path: filePath,
      originalContent: original,
    });
  }

  private performRollback(): void {
    // Process in reverse order
    for (const entry of [...this.rollback.entries].reverse()) {
      try {
        switch (entry.type) {
          case 'file_created':
            if (existsSync(entry.path)) {
              rmSync(entry.path);
            }
            break;
          case 'file_modified':
            if (entry.originalContent !== undefined) {
              writeFileSync(entry.path, entry.originalContent, 'utf-8');
            }
            break;
          case 'dir_created':
            if (existsSync(entry.path)) {
              rmSync(entry.path, { recursive: true, force: true });
            }
            break;
        }
      } catch (rollbackErr) {
        logger.warn(`Rollback failed for ${entry.path}: ${rollbackErr}`);
      }
    }
    this.rollback = { entries: [] };
  }

  private fail(message: string): CraftResult {
    this.setState('failed', message);
    this.emit('error', message);
    return { success: false, error: message };
  }
}
