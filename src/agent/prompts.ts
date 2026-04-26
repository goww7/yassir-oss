import { buildToolDescriptions } from '../tools/registry.js';
import { buildSkillMetadataSection, discoverSkills } from '../skills/index.js';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChannelProfile } from './channels.js';
import { getYassirDir, yassirPath } from '../utils/paths.js';
import { getCurrentProfile } from '../profile/current.js';
import { getActiveWorkspace } from '../workspace/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Prompt Injection Sanitization
// ============================================================================

/**
 * Sanitize user-controlled text before injecting it into prompts.
 * Strips characters and patterns that could break prompt structure
 * or inject instructions.
 */
function sanitizePromptContent(text: string): string {
  return text
    // Strip markdown heading markers that could create new prompt sections
    .replace(/^#{1,6}\s/gm, '')
    // Strip XML-like tags that could impersonate system tags
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    // Collapse multiple newlines to prevent large whitespace injections
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Returns the current date formatted for prompts.
 */
export function getCurrentDate(): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  return new Date().toLocaleDateString('en-US', options);
}

/**
 * Load SOUL.md content with profile-aware resolution:
 * 1. Profile-specific SOUL.md (in profile's storageDir)
 * 2. Global user override (.yassir/SOUL.md)
 * 3. Bundled fallback (../../SOUL.md)
 */
export async function loadSoulDocument(): Promise<string | null> {
  // 1. Profile-specific SOUL.md (e.g. .agents/lexis/SOUL.md)
  const currentProfile = getCurrentProfile();
  if (currentProfile.brand.storageDir) {
    const profileSoulPath = join(currentProfile.brand.storageDir, 'SOUL.md');
    try {
      return await readFile(profileSoulPath, 'utf-8');
    } catch {
      // No profile-specific SOUL.md, continue to global.
    }
  }

  // 2. Global user override
  const userSoulPath = yassirPath('SOUL.md');
  try {
    return await readFile(userSoulPath, 'utf-8');
  } catch {
    // Continue to bundled fallback when user override is missing/unreadable.
  }

  // 3. Bundled fallback
  const bundledSoulPath = join(__dirname, '../../SOUL.md');
  try {
    return await readFile(bundledSoulPath, 'utf-8');
  } catch {
    // SOUL.md is optional; keep prompt behavior unchanged when absent.
  }

  return null;
}

/**
 * Build the skills section for the system prompt.
 * Only includes skill metadata if skills are available.
 */
function buildSkillsSection(): string {
  const skills = discoverSkills();
  
  if (skills.length === 0) {
    return '';
  }

  const skillList = buildSkillMetadataSection();
  
  return `## Available Skills

${skillList}

## Skill Usage Policy

- Treat skills as specialist Shariah-investing workflows, not generic templates
- When a relevant skill matches the user request, invoke it IMMEDIATELY as your first action
- Prefer compliance, portfolio, purification, monitoring, and memo skills before ad hoc tool-chaining
- Do not invoke a skill that has already been invoked for the current query`;
}

function buildMemorySection(memoryFiles: string[]): string {
  const fileListSection = memoryFiles.length > 0
    ? `\nMemory files on disk: ${memoryFiles.join(', ')}`
    : '';

  return `## Memory

You have persistent memory stored as Markdown files in ${getYassirDir()}/memory/.${fileListSection}

### Recalling memories
Use memory_search to recall stored facts, preferences, or notes. The search covers all
memory files (long-term and daily logs). Follow up with memory_get to read full sections
when you need exact text.

### Storing and managing memories
Use **memory_update** to add, edit, or delete memories. Do NOT use write_file or
edit_file for memory files.
- To remember something, just pass content (defaults to appending to long-term memory).
- For daily notes, pass file="daily".
- For edits/deletes, pass action="edit" or action="delete" with old_text.
Before editing or deleting, use memory_get to verify the exact text to match.`;
}

function buildWorkspaceSection(): string {
  const workspace = getActiveWorkspace();

  if (!workspace) {
    return `## Workspace

No active portfolio research room is selected.

If the user wants portfolio-specific or document-grounded work, ask them to create or select a workspace first using:
- \`/workspace new <name>\`
- \`/workspace use <id>\`
- \`/workspace status\``;
  }

  return `## Workspace

You have an active portfolio research room:
- Name: ${workspace.name}
- Id: ${workspace.id}
- Root: ${workspace.rootDir}
- Inputs folder: ${workspace.inputsDir}
- Notes folder: ${workspace.notesDir}
- Outputs folder: ${workspace.outputsDir}

Use \`list_workspace_files\` to inspect available documents, \`search_workspace\` to locate relevant files, and \`read_document\` to extract text from PDFs, spreadsheets, Word docs, slide decks, and text files inside this workspace.

Prefer the workspace tools over generic file tools when the user is asking about holdings exports, screening snapshots, ETF material, filings, or research-room documents.`;
}

function buildProfileSourcePolicy(): string {
  const currentProfile = getCurrentProfile();
  const enabledTools = new Set(currentProfile.vertical.enabledTools ?? []);
  const lines: string[] = [
    '## Source Selection Policy',
    '',
    '- Treat HalalTerminal as the primary evidence source for Shariah compliance, purification, watchlists, ETF screening, and portfolio workflows',
    '- When both HalalTerminal API and MCP-backed capabilities are available, prefer the most authoritative structured result and reconcile overlaps before answering',
    '- Prefer structured finance/open-data sources before broad web_search whenever a relevant source exists',
    '- Use web_search only for supplementary context, recency, commentary, or to fill gaps after HalalTerminal and finance/open-data sources',
    '- If a primary source returns thin or partial coverage, continue with a lower-tier source and clearly label the confidence downgrade',
  ];

  // Profile-specific source directives (from profile definition, not hardcoded switch)
  if (currentProfile.vertical.sourcePolicy?.length) {
    lines.push(...currentProfile.vertical.sourcePolicy);
  }

  // Auto-append available open-data tool list
  const available = (tools: string[]) => tools.filter((tool) => enabledTools.has(tool));
  const openDataTools = available([
    'sec_company_facts',
    'sec_submissions',
  ]);

  if (openDataTools.length > 0) {
    lines.push(`- In this profile, the main profile-specific public-data tools are: ${openDataTools.map((tool) => `\`${tool}\``).join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Build the tool usage policy section, split into generic base + profile-specific.
 */
function buildToolUsagePolicy(): string {
  const currentProfile = getCurrentProfile();

  // Generic base (applies to all profiles)
  const lines: string[] = [
    '- Only use tools when the query actually requires external data',
    '- Prefer HalalTerminal and profile-specific structured/open-data tools before broad web search when they fit the question',
    '- For Shariah investing questions, determine the compliance answer first, then portfolio impact, then supporting financial evidence',
    '- If HalalTerminal returns a quota block on the primary Shariah workflow, stop the deep analysis path, tell the user the authoritative screen is blocked, and direct them to check dashboard access before rerunning',
    '- After a HalalTerminal quota block, do not continue with broad market-data or financial deep-dives unless the user explicitly asked for a provisional fallback view',
    '- If a tool returns auth/config failure, rate limiting, or no useful data, pivot to a different tool family rather than repeating the same failing path',
    '- When news headlines are returned, assess whether the titles and metadata already answer the user\'s question before fetching full articles with web_fetch (fetching is expensive). Only use web_fetch when the user needs details beyond what the headline conveys (e.g., quotes, specifics of a deal, earnings call takeaways)',
    '- For general web queries or questions without a better profile-specific source, use web_search',
    '- Only use browser when you need JavaScript rendering or interactive navigation (clicking links, filling forms, navigating SPAs)',
    '- For factual questions about entities (companies, people, organizations), use tools to verify current state',
    '- Only respond directly for: conceptual definitions, stable historical facts, or conversational queries',
    '- If the user query includes a "Clarification context" or "Guided Q&A context" block, treat it as explicit user-scoped instructions for deliverable shape, scope, priorities, and source emphasis',
    '- If one missing detail would materially change the work, you may ask exactly one clarification before proceeding by replying with `CLARIFICATION_NEEDED: <your question>`',
    '- Use a clarification only when genuinely necessary; skip it when the user is already specific enough',
    '- Never ask generic filler like "can you clarify?" or questions that do not change the plan, sources, or answer shape',
    '- For screening, portfolio audit, purification, and monitoring tasks, end with a concrete decision-ready summary rather than generic commentary',
    '- When evidence conflicts, explicitly separate authoritative findings from supporting or fallback evidence',
  ];

  // Profile-specific tool usage guidance
  if (currentProfile.vertical.toolUsagePolicy?.length) {
    lines.push(...currentProfile.vertical.toolUsagePolicy.map(line =>
      line.startsWith('- ') ? line : `- ${line}`,
    ));
  }

  return lines.join('\n');
}

// ============================================================================
// Default System Prompt (for backward compatibility)
// ============================================================================

/**
 * Default system prompt used when no specific prompt is provided.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant.

Current date: ${getCurrentDate()}

Your output is displayed on a command line interface. Keep responses short and concise.

## Behavior

- Prioritize accuracy over validation
- Use professional, objective tone
- Be thorough but efficient

## Response Format

- Keep responses brief and direct
- For non-comparative information, prefer plain text or simple lists over tables
- Do not use markdown headers or *italics* - use **bold** sparingly for emphasis

## Tables (for comparative/tabular data)

Use markdown tables. They will be rendered as formatted box tables.

STRICT FORMAT - each row must:
- Start with | and end with |
- Have no trailing spaces after the final |
- Use |---| separator (with optional : for alignment)

| Ticker | Rev    | OM  |
|--------|--------|-----|
| AAPL   | 416.2B | 31% |

Keep tables compact:
- Max 2-3 columns; prefer multiple small tables over one wide table
- Headers: 1-3 words max. "FY Rev" not "Most recent fiscal year revenue"
- Tickers not names: "AAPL" not "Apple Inc."
- Abbreviate: Rev, Op Inc, Net Inc, OCF, FCF, GM, OM, EPS
- Numbers compact: 102.5B not $102,466,000,000
- Omit units in cells if header has them`;

// ============================================================================
// Group Chat Context
// ============================================================================

export type GroupContext = {
  groupName?: string;
  membersList?: string;
  activationMode: 'mention';
};

/**
 * Build a system prompt section for group chat context.
 */
export function buildGroupSection(ctx: GroupContext): string {
  const lines: string[] = ['## Group Chat'];
  lines.push('');
  if (ctx.groupName) {
    const safeName = sanitizePromptContent(ctx.groupName);
    lines.push(`You are participating in the WhatsApp group "${safeName}".`);
  } else {
    lines.push('You are participating in a WhatsApp group chat.');
  }
  lines.push('You were activated because someone @-mentioned you.');
  lines.push('');
  lines.push('### Group behavior');
  lines.push('- Address the person who mentioned you by name');
  lines.push('- Reference recent group context when relevant');
  lines.push('- Keep responses concise — this is a group chat, not a 1:1 conversation');
  lines.push('- Do not repeat information that was already shared in the group');

  if (ctx.membersList) {
    lines.push('');
    lines.push('### Group members');
    lines.push(sanitizePromptContent(ctx.membersList));
  }

  return lines.join('\n');
}

// ============================================================================
// System Prompt
// ============================================================================

/**
 * Build the system prompt for the agent.
 * @param model - The model name (used to get appropriate tool descriptions)
 * @param soulContent - Optional SOUL.md identity content
 * @param channel - Delivery channel (e.g., 'whatsapp', 'cli') — selects formatting profile
 */
export function buildSystemPrompt(
  model: string,
  soulContent?: string | null,
  channel?: string,
  groupContext?: GroupContext,
  memoryFiles?: string[],
): string {
  const currentProfile = getCurrentProfile();
  const toolDescriptions = buildToolDescriptions(model);
  const profile = getChannelProfile(channel);

  const behaviorBullets = profile.behavior.map(b => `- ${b}`).join('\n');
  const formatBullets = profile.responseFormat.map(b => `- ${b}`).join('\n');

  const tablesSection = profile.tables
    ? `\n## Tables (for comparative/tabular data)\n\n${profile.tables}`
    : '';

  return `You are ${currentProfile.assistantName}, ${currentProfile.vertical.assistantDescription}.

Current date: ${getCurrentDate()}

${profile.preamble}

## Available Tools

${toolDescriptions}

## Tool Usage Policy

${buildToolUsagePolicy()}

${buildProfileSourcePolicy()}

${buildSkillsSection()}

${buildWorkspaceSection()}

${buildMemorySection(memoryFiles ?? [])}

## Heartbeat

You have a periodic heartbeat that runs on a schedule (configurable by the user).
The heartbeat reads ${getYassirDir()}/HEARTBEAT.md to know what to check.
Users can ask you to manage their heartbeat checklist — use the heartbeat tool to view/update it.
Example user requests: "watch NVDA for me", "add a market check to my heartbeat", "what's my heartbeat doing?"

## Behavior

${behaviorBullets}

${soulContent ? `## Identity

${sanitizePromptContent(soulContent)}

Embody the identity described above. Let it shape your tone, values, and how you engage with questions in this domain.
` : ''}

## Response Format

${formatBullets}${tablesSection}${groupContext ? '\n\n' + buildGroupSection(groupContext) : ''}`;
}

// ============================================================================
// User Prompts
// ============================================================================

/**
 * Build user prompt for agent iteration with full tool results.
 * Anthropic-style: full results in context for accurate decision-making.
 * Context clearing happens at threshold, not inline summarization.
 * 
 * @param originalQuery - The user's original query
 * @param fullToolResults - Formatted full tool results (or placeholder for cleared)
 * @param toolUsageStatus - Optional tool usage status for graceful exit mechanism
 * @param researchPlan - Optional research plan to guide the agent's execution
 * @param retrievedContext - Optional summaries of previously cleared tool results
 */
export function buildIterationPrompt(
  originalQuery: string,
  fullToolResults: string,
  toolUsageStatus?: string | null,
  researchPlan?: string | null,
  retrievedContext?: string | null,
): string {
  let prompt = `Query: ${originalQuery}`;

  if (fullToolResults.trim()) {
    prompt += `

Data retrieved from tool calls:
${fullToolResults}`;
  }

  // Add tool usage status if available (graceful exit mechanism)
  if (toolUsageStatus) {
    prompt += `\n\n${toolUsageStatus}`;
  }

  // Add research plan to guide execution
  if (researchPlan) {
    prompt += `\n\n${researchPlan}`;
  }

  // Add retrieved summaries of cleared tool results
  if (retrievedContext) {
    prompt += `\n\n${retrievedContext}`;
  }

  prompt += `

Continue working toward answering the query. When you have gathered sufficient data to answer, write your complete answer directly and do not call more tools. For browser tasks: seeing a link is NOT the same as reading it - you must click through (using the ref) OR navigate to its visible /url value. NEVER guess at URLs - use ONLY URLs visible in snapshots.`;

  return prompt;
}

