import { StructuredToolInterface } from '@langchain/core/tools';
import { createGetFinancials, createGetMarketData, createReadFilings, createScreenStocks, createGetShariah, GET_SHARIAH_DESCRIPTION } from './finance/index.js';
import { federatedWebSearch, WEB_SEARCH_DESCRIPTION, xSearchTool, X_SEARCH_DESCRIPTION } from './search/index.js';
import { hasReadySearchProvider } from './search/provider-health.js';
import { skillTool, SKILL_TOOL_DESCRIPTION } from './skill.js';
import { webFetchTool, WEB_FETCH_DESCRIPTION } from './fetch/web-fetch.js';
import { browserTool, BROWSER_DESCRIPTION } from './browser/browser.js';
import { readFileTool, READ_FILE_DESCRIPTION } from './filesystem/read-file.js';
import { writeFileTool, WRITE_FILE_DESCRIPTION } from './filesystem/write-file.js';
import { editFileTool, EDIT_FILE_DESCRIPTION } from './filesystem/edit-file.js';
import { GET_FINANCIALS_DESCRIPTION } from './finance/get-financials.js';
import { GET_MARKET_DATA_DESCRIPTION } from './finance/get-market-data.js';
import { READ_FILINGS_DESCRIPTION } from './finance/read-filings.js';
import { SCREEN_STOCKS_DESCRIPTION } from './finance/screen-stocks.js';
import { memoryGetTool, MEMORY_GET_DESCRIPTION, memorySearchTool, MEMORY_SEARCH_DESCRIPTION, memoryUpdateTool, MEMORY_UPDATE_DESCRIPTION } from './memory/index.js';
import { discoverSkills } from '../skills/index.js';
import { getCurrentProfile } from '../profile/current.js';
import {
  listWorkspaceFilesTool,
  LIST_WORKSPACE_FILES_DESCRIPTION,
  readDocumentTool,
  READ_DOCUMENT_DESCRIPTION,
  searchWorkspaceTool,
  SEARCH_WORKSPACE_DESCRIPTION,
} from './workspace/index.js';
import {
  secCompanyFactsTool,
  SEC_COMPANY_FACTS_DESCRIPTION,
  secSubmissionsTool,
  SEC_SUBMISSIONS_DESCRIPTION,
} from './open-data/index.js';

/**
 * A registered tool with its rich description for system prompt injection.
 */
export interface RegisteredTool {
  /** Tool name (must match the tool's name property) */
  name: string;
  /** The actual tool instance */
  tool: StructuredToolInterface;
  /** Rich description for system prompt (includes when to use, when not to use, etc.) */
  description: string;
}

/**
 * Get all registered tools with their descriptions.
 * Conditionally includes tools based on environment configuration.
 *
 * @param model - The model name (needed for tools that require model-specific configuration)
 * @returns Array of registered tools
 */
export function getToolRegistry(model: string): RegisteredTool[] {
  const currentProfile = getCurrentProfile();
  const alwaysOnWorkspaceTools = ['list_workspace_files', 'read_document', 'search_workspace'];
  const allowedTools = currentProfile.vertical.enabledTools
    ? new Set([...currentProfile.vertical.enabledTools, ...alwaysOnWorkspaceTools])
    : null;
  const tools: RegisteredTool[] = [
    {
      name: 'get_financials',
      tool: createGetFinancials(model),
      description: GET_FINANCIALS_DESCRIPTION,
    },
    {
      name: 'get_market_data',
      tool: createGetMarketData(model),
      description: GET_MARKET_DATA_DESCRIPTION,
    },
    {
      name: 'read_filings',
      tool: createReadFilings(model),
      description: READ_FILINGS_DESCRIPTION,
    },
    {
      name: 'stock_screener',
      tool: createScreenStocks(model),
      description: SCREEN_STOCKS_DESCRIPTION,
    },
    {
      name: 'web_fetch',
      tool: webFetchTool,
      description: WEB_FETCH_DESCRIPTION,
    },
    {
      name: 'browser',
      tool: browserTool,
      description: BROWSER_DESCRIPTION,
    },
    {
      name: 'read_file',
      tool: readFileTool,
      description: READ_FILE_DESCRIPTION,
    },
    {
      name: 'write_file',
      tool: writeFileTool,
      description: WRITE_FILE_DESCRIPTION,
    },
    {
      name: 'edit_file',
      tool: editFileTool,
      description: EDIT_FILE_DESCRIPTION,
    },
    {
      name: 'list_workspace_files',
      tool: listWorkspaceFilesTool,
      description: LIST_WORKSPACE_FILES_DESCRIPTION,
    },
    {
      name: 'read_document',
      tool: readDocumentTool,
      description: READ_DOCUMENT_DESCRIPTION,
    },
    {
      name: 'search_workspace',
      tool: searchWorkspaceTool,
      description: SEARCH_WORKSPACE_DESCRIPTION,
    },
    {
      name: 'memory_search',
      tool: memorySearchTool,
      description: MEMORY_SEARCH_DESCRIPTION,
    },
    {
      name: 'memory_get',
      tool: memoryGetTool,
      description: MEMORY_GET_DESCRIPTION,
    },
    {
      name: 'memory_update',
      tool: memoryUpdateTool,
      description: MEMORY_UPDATE_DESCRIPTION,
    },
    {
      name: 'sec_company_facts',
      tool: secCompanyFactsTool,
      description: SEC_COMPANY_FACTS_DESCRIPTION,
    },
    {
      name: 'sec_submissions',
      tool: secSubmissionsTool,
      description: SEC_SUBMISSIONS_DESCRIPTION,
    },
  ];

  // Include federated web search only if at least one provider passes config/health checks.
  if (hasReadySearchProvider()) {
    tools.push({
      name: 'web_search',
      tool: federatedWebSearch,
      description: WEB_SEARCH_DESCRIPTION,
    });
  }

  // Include x_search if X Bearer Token is configured
  if (process.env.X_BEARER_TOKEN) {
    tools.push({
      name: 'x_search',
      tool: xSearchTool,
      description: X_SEARCH_DESCRIPTION,
    });
  }

  // Include get_shariah if Halal Terminal API key is configured
  if (
    currentProfile.vertical.enabledTools?.includes('get_shariah') &&
    currentProfile.vertical.backend?.envVar &&
    process.env[currentProfile.vertical.backend.envVar]
  ) {
    tools.push({
      name: 'get_shariah',
      tool: createGetShariah(model),
      description: GET_SHARIAH_DESCRIPTION,
    });
  }

  // Include skill tool if any skills are available
  const availableSkills = discoverSkills();
  if (availableSkills.length > 0) {
    tools.push({
      name: 'skill',
      tool: skillTool,
      description: SKILL_TOOL_DESCRIPTION,
    });
  }

  return allowedTools ? tools.filter((tool) => allowedTools.has(tool.name)) : tools;
}

/**
 * Get just the tool instances for binding to the LLM.
 *
 * @param model - The model name
 * @returns Array of tool instances
 */
export function getTools(model: string): StructuredToolInterface[] {
  return getToolRegistry(model).map((t) => t.tool);
}

/**
 * Build the tool descriptions section for the system prompt.
 * Formats each tool's rich description with a header.
 *
 * @param model - The model name
 * @returns Formatted string with all tool descriptions
 */
export function buildToolDescriptions(model: string): string {
  return getToolRegistry(model)
    .map((t) => `### ${t.name}\n\n${t.description}`)
    .join('\n\n');
}
