import { CombinedAutocompleteProvider, Container, ProcessTerminal, Spacer, Text, TUI } from '@mariozechner/pi-tui';
import type {
  ApprovalDecision,
  ClarificationNeededEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ToolStartEvent,
} from './agent/index.js';
import type { GuidedQaRunContext } from './controllers/index.js';
import { buildClarificationContext } from './agent/clarification-preflight.js';
import { checkApiKeyExists, getApiKeyNameForProvider, getProviderDisplayName } from './utils/env.js';
import { logger } from './utils/logger.js';
import { summarizeGetShariahData } from './utils/summarize-get-shariah-result.js';
import { createSlashCommands, extractRecentSymbols, resolveSlashCommand } from './cli-slash-commands.js';
import { RuntimeSuggestionStore } from './cli-runtime-suggestions.js';
import {
  AgentRunnerController,
  ApiKeyManagerController,
  GuidedQaController,
  HalalKeyController,
  InputHistoryController,
  ModelSelectionController,
  WorkspaceAttachController,
} from './controllers/index.js';
import {
  ApiKeyInputComponent,
  ApprovalPromptComponent,
  ChatLogComponent,
  CustomEditor,
  DebugPanelComponent,
  IntroComponent,
  getStarterPrompts,
  WorkingIndicatorComponent,
  createApiKeyConfirmSelector,
  createGuidedQaWorkflowSelector,
  createKeyManagerSelector,
  createModelSelector,
  createProviderSelector,
  createSimpleSelector,
  createSettingsSelector,
} from './components/index.js';
import { getCurrentProfile, hasCurrentProfileBackendConfigured } from './profile/current.js';
import { editorTheme, theme } from './theme.js';
import { getSourceTraceEntry } from './utils/source-trace.js';
import { getReplyShortcutOption } from './utils/reply-shortcuts.js';
import { extractToolSourceEntries } from './utils/tool-source-drilldown.js';

function truncateAtWord(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  const lastSpace = str.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.5) {
    return `${str.slice(0, lastSpace)}...`;
  }
  return `${str.slice(0, maxLength)}...`;
}

function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) {
    return null;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function formatThinkingLabel(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) >>> 0;
  }
  const pick = (options: string[]) => options[hash % options.length] ?? options[0] ?? 'Thinking';
  const lower = message.toLowerCase();
  if (lower.includes('summar')) return pick(['Summarizing', 'Wrapping up', 'Pulling together']);
  if (lower.includes('compar')) return pick(['Comparing', 'Cross-checking', 'Weighing']);
  if (lower.includes('screen')) return pick(['Screening', 'Reviewing', 'Scanning']);
  if (lower.includes('search') || lower.includes('research')) return pick(['Researching', 'Inspecting', 'Checking']);
  return pick(['Planning', 'Scoping', 'Mapping']);
}

function summarizeToolResult(tool: string, args: Record<string, unknown>, result: string): string {
  if (tool === 'skill') {
    const skillName = args.skill as string;
    return `Loaded ${skillName} skill`;
  }
  try {
    const parsed = JSON.parse(result);
    if (parsed.data) {
      if (Array.isArray(parsed.data)) {
        return `Received ${parsed.data.length} items`;
      }
      if (typeof parsed.data === 'object') {
        const data = parsed.data as Record<string, unknown>;
        if (tool === 'screen_index_bulk') {
          const indexName = typeof data.index_name === 'string' ? data.index_name : (args.index_name as string | undefined);
          const total = typeof data.total === 'number' ? data.total : typeof data.count === 'number' ? data.count : null;
          const runId = typeof data.run_id === 'string' ? data.run_id : null;
          return `${indexName ?? 'Bulk run'} queued${total ? ` · ${total} symbols` : ''}${runId ? ` · run ${runId}` : ''}`;
        }
        if (tool === 'get_bulk_status') {
          const status = typeof data.status === 'string' ? data.status : typeof data.running === 'boolean' ? (data.running ? 'running' : 'idle') : 'status';
          const progress = typeof data.progress_pct === 'number' ? `${data.progress_pct.toFixed(1)}%` : null;
          const done = typeof data.done === 'number' ? data.done : null;
          const total = typeof data.total === 'number' ? data.total : null;
          const current = typeof data.current_symbol === 'string' ? data.current_symbol : null;
          const eta = formatEta(
            typeof data.estimated_remaining_seconds === 'number' ? data.estimated_remaining_seconds : null,
          );
          return [
            status,
            progress,
            done != null && total != null ? `${done}/${total}` : null,
            current ? `current ${current}` : null,
            eta ? `ETA ${eta}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
        }
        if (tool === 'get_bulk_summary') {
          const overall = data.overall as Record<string, unknown> | undefined;
          const complianceRate =
            overall && typeof overall.compliance_rate === 'number'
              ? `${overall.compliance_rate.toFixed(1)}% compliant`
              : null;
          const screened = typeof data.total_screened === 'number' ? `${data.total_screened} screened` : null;
          return [screened, complianceRate].filter(Boolean).join(' · ') || 'Bulk summary ready';
        }
        if (tool === 'get_shariah') {
          return summarizeGetShariahData(data);
        }
        const keys = Object.keys(parsed.data).filter((key) => !key.startsWith('_'));
        if (tool === 'get_financials' || tool === 'get_market_data' || tool === 'stock_screener') {
          return keys.length === 1 ? 'Called 1 data source' : `Called ${keys.length} data sources`;
        }
        if (tool === 'web_search') {
          return 'Did 1 search';
        }
        return `Received ${keys.length} fields`;
      }
    }
  } catch {
    return truncateAtWord(result, 50);
  }
  return 'Received data';
}

function collectSourceTraceEntries(events: { event: { type: string; tool?: string; args?: Record<string, unknown> } }[]) {
  const entries = [];
  for (const display of events) {
    if (display.event.type !== 'tool_start' || !display.event.tool || !display.event.args) {
      continue;
    }
    const entry = getSourceTraceEntry(display.event.tool, display.event.args);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function createScreen(
  title: string,
  description: string,
  body: any,
  footer?: string,
): Container {
  const container = new Container();
  if (title) {
    container.addChild(new Text(theme.bold(theme.primary(title)), 0, 0));
  }
  if (description) {
    container.addChild(new Text(theme.muted(description), 0, 0));
  }
  container.addChild(new Spacer(1));
  container.addChild(body);
  if (footer) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.muted(footer), 0, 0));
  }
  return container;
}

function hasProfileBackendConfigured(): boolean {
  return hasCurrentProfileBackendConfigured();
}

function getIntroPrompts(): string[] {
  return getStarterPrompts(hasProfileBackendConfigured());
}

function getSlashCommandContext(model: string, provider: string) {
  const currentProfile = getCurrentProfile();
  const searchConfigured =
    checkApiKeyExists('EXASEARCH_API_KEY') ||
    checkApiKeyExists('PERPLEXITY_API_KEY') ||
    checkApiKeyExists('TAVILY_API_KEY') ||
    checkApiKeyExists('BRAVE_SEARCH_API_KEY');

  return {
    model,
    provider,
    providerLabel: getProviderDisplayName(provider),
      hasHalalBackend: hasProfileBackendConfigured(),
    configuredServices: [
      {
        label: 'Current provider key',
        configured: (() => {
          const envVar = getApiKeyNameForProvider(provider);
          return envVar ? checkApiKeyExists(envVar) : true;
        })(),
      },
      ...(currentProfile.vertical.backend
        ? [
            {
              label: currentProfile.vertical.backend.label,
              configured: hasProfileBackendConfigured(),
            },
          ]
        : []),
      { label: 'Search', configured: searchConfigured },
      { label: 'X / Twitter', configured: checkApiKeyExists('X_BEARER_TOKEN') },
    ],
  };
}

function renderHistory(chatLog: ChatLogComponent, history: AgentRunnerController['history']) {
  chatLog.clearAll();
  for (const item of history) {
    chatLog.addQuery(item.query);
    chatLog.resetToolGrouping();
    if (item.clarificationContext) {
      chatLog.addGuidedQaSummary(
        item.clarificationContext.seedWorkflowLabel ?? 'Adaptive Q&A',
        item.clarificationContext.entries,
        item.clarificationContext.autoTriggered,
      );
    }

    if (item.status === 'interrupted') {
      chatLog.addInterrupted();
    }

    for (const display of item.events) {
      const event = display.event;
      if (event.type === 'thinking') {
        const message = event.message.trim();
        if (message) {
          chatLog.addChild(
            new Text(
              `${theme.muted(`✻ ${formatThinkingLabel(message)} · `)}${message.length > 260 ? `${message.slice(0, 260)}...` : message}`,
              0,
              0,
            ),
          );
        }
        continue;
      }

      if (event.type === 'clarification_needed') {
        chatLog.addClarificationPrompt(event.question, event.options);
        continue;
      }

      if (event.type === 'tool_start') {
        const toolStart = event as ToolStartEvent;
        const component = chatLog.startTool(
          display.id,
          toolStart.tool,
          toolStart.args,
          getSourceTraceEntry(toolStart.tool, toolStart.args)?.reason,
        );
        if (display.completed && display.endEvent?.type === 'tool_end') {
          const done = display.endEvent as ToolEndEvent;
          chatLog.setToolSources(display.id, extractToolSourceEntries(done.tool, done.result));
          component.setComplete(
            summarizeToolResult(done.tool, toolStart.args, done.result),
            done.duration,
          );
        } else if (display.completed && display.endEvent?.type === 'tool_error') {
          const toolError = display.endEvent as ToolErrorEvent;
          component.setError(toolError.error);
        } else if (display.progressMessage) {
          component.setActive(display.progressMessage);
        }
        continue;
      }

      if (event.type === 'tool_approval') {
        const approval = chatLog.startTool(display.id, event.tool, event.args);
        approval.setApproval(event.approved);
        continue;
      }

      if (event.type === 'tool_denied') {
        const denied = chatLog.startTool(display.id, event.tool, event.args);
        const path = (event.args.path as string) ?? '';
        denied.setDenied(path, event.tool);
        continue;
      }

      if (event.type === 'tool_limit') {
        continue;
      }

      if (event.type === 'context_cleared') {
        chatLog.addContextCleared(event.clearedCount, event.keptCount);
      }
    }

    if (item.answer) {
      chatLog.finalizeAnswer(item.answer);
    }
    if (item.status === 'complete') {
      chatLog.addSourcesTrace(collectSourceTraceEntries(item.events));
      chatLog.addPerformanceStats(item.duration ?? 0, item.tokenUsage, item.tokensPerSecond);
    }
  }
}

export async function runCli() {
  const tui = new TUI(new ProcessTerminal());
  const root = new Container();
  let lastError: string | null = null;
  let settingsOpen = false;

  const onError = (message: string) => {
    lastError = message;
    logger.error(message);
    tui.requestRender();
  };

  const renderStandaloneScreen = (
    title: string,
    description: string,
    body: any,
    footer?: string,
    focusTarget?: any,
  ) => {
    root.clear();
    root.addChild(createScreen(title, description, body, footer));
    if (focusTarget) {
      tui.setFocus(focusTarget);
    }
  };

  tui.addChild(root);
  tui.start();

  const chatLog = new ChatLogComponent(tui);
  const inputHistory = new InputHistoryController(() => tui.requestRender());
  const runtimeSuggestions = new RuntimeSuggestionStore();

  const halalKey = new HalalKeyController(() => {
    void runtimeSuggestions.refreshInBackground();
    intro.setState(modelSelection.model, hasProfileBackendConfigured());
    renderSelectionOverlay();
    tui.requestRender();
  });

  const modelSelection = new ModelSelectionController(onError, () => {
    intro.setState(modelSelection.model, hasProfileBackendConfigured());
    // When LLM key setup completes (state returns to idle), start Halal wizard if needed
    if (!modelSelection.isInSelectionFlow() && !halalKey.isActive()) {
      halalKey.startIfNeeded();
    }
    renderSelectionOverlay();
    tui.requestRender();
  });

  const apiKeyManager = new ApiKeyManagerController(() => {
    void runtimeSuggestions.refreshInBackground();
    intro.setState(modelSelection.model, hasProfileBackendConfigured());
    renderSelectionOverlay();
    tui.requestRender();
  });

  let guidedQaDisplayQuery = '';

  const agentRunner = new AgentRunnerController(
    { model: modelSelection.model, modelProvider: modelSelection.provider, maxIterations: 10 },
    modelSelection.inMemoryChatHistory,
    () => {
      renderHistory(chatLog, agentRunner.history);
      workingIndicator.setState(agentRunner.workingState);
      renderSelectionOverlay();
      tui.requestRender();
    },
  );

  const runResolvedQuery = async (
    agentQuery: string,
    displayQuery: string,
    clarificationContext?: Omit<GuidedQaRunContext, 'enrichedQuery'>,
    options?: { reusePendingClarification?: boolean; historyQuery?: string },
  ) => {
    const shouldSaveDisplayQuery =
      !options?.reusePendingClarification || agentRunner.history.at(-1)?.historySaved === false;
    const result = await agentRunner.runQuery(agentQuery, {
      displayQuery,
      clarificationContext,
      reusePendingClarification: options?.reusePendingClarification,
      historyQuery: options?.historyQuery,
    });
    if (shouldSaveDisplayQuery) {
      await inputHistory.saveMessage(displayQuery);
      inputHistory.resetNavigation();
    }
    if (result?.answer) {
      await inputHistory.updateAgentResponse(result.answer);
    }
    if (displayQuery.startsWith('/watchlist')) {
      void runtimeSuggestions.refreshInBackground();
    }
    refreshError();
    tui.requestRender();
  };

  const guidedQa = new GuidedQaController(() => {
    renderSelectionOverlay();
    tui.requestRender();
  });

  const proceedWithAdaptiveContext = async (displayQuery: string) => {
    const context = guidedQa.buildRunContext();
    if (!context) {
      return;
    }
    guidedQaDisplayQuery = '';
    const enrichedQuery =
      context.entries.length > 0 || context.seedWorkflowLabel ? context.enrichedQuery : context.originalQuery;
    await runResolvedQuery(enrichedQuery, displayQuery, buildClarificationContext(context), {
      reusePendingClarification: agentRunner.history.at(-1)?.status === 'awaiting_clarification',
      historyQuery: context.originalQuery || displayQuery,
    });
    guidedQa.close();
  };

  const restorePendingClarificationFromHistory = () => {
    if (guidedQa.hasPendingSession()) {
      return;
    }
    const lastItem = agentRunner.history.at(-1);
    if (!lastItem || lastItem.status !== 'awaiting_clarification') {
      return;
    }
    const lastPrompt = [...lastItem.events]
      .reverse()
      .find(
        (entry): entry is typeof entry & { event: ClarificationNeededEvent } => entry.event.type === 'clarification_needed',
      )?.event;
    if (!lastPrompt) {
      return;
    }
    guidedQa.startSession(lastItem.clarificationContext?.originalQuery ?? lastItem.query, {
      workflowId: lastItem.clarificationContext?.seedWorkflowId,
      autoTriggered: lastItem.clarificationContext?.autoTriggered,
    });
    guidedQa.setPendingPrompt({
      question: lastPrompt.question,
      mode: lastPrompt.mode,
      label: lastPrompt.label,
      options: lastPrompt.options,
    });
  };

  const workspaceAttach = new WorkspaceAttachController(() => {
    renderSelectionOverlay();
    tui.requestRender();
  });

  const intro = new IntroComponent(modelSelection.model, hasProfileBackendConfigured());
  const errorText = new Text('', 0, 0);
  const workingIndicator = new WorkingIndicatorComponent(tui);
  const editor = new CustomEditor(tui, editorTheme);
  const debugPanel = new DebugPanelComponent(8, false);

  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      createSlashCommands({
        getRecentSymbols: () => extractRecentSymbols(inputHistory.getMessages()),
        getBulkIndices: () => runtimeSuggestions.getBulkIndices(),
        getWatchlists: () => runtimeSuggestions.getWatchlists(),
      }),
      process.cwd(),
    ),
  );

  const refreshError = () => {
    const message = lastError ?? agentRunner.error;
    errorText.setText(message ? theme.error(`Error: ${message}`) : '');
  };

  const handleSubmit = async (query: string) => {
    if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
      tui.stop();
      process.exit(0);
      return;
    }

    if (query === '/model') {
      modelSelection.startSelection();
      return;
    }

    if (query === '/settings') {
      settingsOpen = true;
      renderSelectionOverlay();
      tui.requestRender();
      return;
    }

    if (query === '/keys') {
      apiKeyManager.open();
      return;
    }

    restorePendingClarificationFromHistory();

    if (guidedQa.isAwaitingInline()) {
      guidedQa.recordInlineAnswer(query);
      await proceedWithAdaptiveContext(guidedQaDisplayQuery || guidedQa.getOriginalQuery() || query);
      return;
    }

    const slashAction = resolveSlashCommand(
      query,
      getSlashCommandContext(modelSelection.model, modelSelection.provider),
    );
    if (slashAction.kind === 'insert') {
      editor.setText(slashAction.text);
      tui.requestRender();
      return;
    }
    if (slashAction.kind === 'local') {
      await inputHistory.saveMessage(query);
      await inputHistory.updateAgentResponse(slashAction.answer);
      agentRunner.addLocalAnswer(query, slashAction.answer);
      refreshError();
      tui.requestRender();
      return;
    }
    if (slashAction.kind === 'guide') {
      guidedQaDisplayQuery = query;
      const guidedSeed = slashAction.seedQuery?.trim() ? slashAction.seedQuery : '';
      if (guidedQa.startSession(guidedSeed, { workflowId: slashAction.workflowId, manual: true })) {
        if (slashAction.workflowId) {
          await proceedWithAdaptiveContext(query);
        } else {
          renderSelectionOverlay();
          tui.requestRender();
        }
      }
      return;
    }
    if (slashAction.kind === 'attach') {
      try {
        if (slashAction.path) {
          const destinationPath = await workspaceAttach.importFromUserPath(slashAction.path);
          await inputHistory.saveMessage(query);
          await inputHistory.updateAgentResponse(`Imported file to workspace:\n${destinationPath}`);
          agentRunner.addLocalAnswer(query, `Imported file to workspace:\n${destinationPath}`);
        } else {
          await workspaceAttach.open();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await inputHistory.saveMessage(query);
        await inputHistory.updateAgentResponse(message);
        agentRunner.addLocalAnswer(query, message);
      }
      refreshError();
      tui.requestRender();
      return;
    }
    const exampleMatch = query.match(/^\/([1-6])$/);
    if (exampleMatch) {
      const prompt = getIntroPrompts()[Number(exampleMatch[1]) - 1];
      if (prompt) {
        editor.setText(prompt);
        tui.requestRender();
      }
      return;
    }

    if (
      halalKey.isActive() ||
      apiKeyManager.isActive() ||
      guidedQa.isActive() ||
      workspaceAttach.isActive() ||
      settingsOpen ||
      modelSelection.isInSelectionFlow() ||
      agentRunner.pendingApproval ||
      agentRunner.isProcessing
    ) {
      return;
    }

    await runResolvedQuery(slashAction.kind === 'run' ? slashAction.query : query, query);
  };

  editor.onChange = (text) => {
    editor.trackText(text);
  };
  editor.onEmptyDigitShortcut = (digit) => {
    const latestAnswer = agentRunner.history.at(-1)?.answer ?? '';
    const replyShortcut = latestAnswer ? getReplyShortcutOption(latestAnswer, digit) : null;
    if (replyShortcut) {
      editor.setText(replyShortcut);
      tui.requestRender();
      return true;
    }

    if (agentRunner.history.length > 0) {
      return false;
    }

    const prompt = getIntroPrompts()[digit - 1];
    if (!prompt) return false;
    editor.setText(prompt);
    tui.requestRender();
    return true;
  };
  editor.onEmptyKeyShortcut = (key) => {
    if (key !== 's') return false;
    if (chatLog.toggleLastToolSources()) {
      tui.requestRender();
      return true;
    }
    return false;
  };

  editor.onSubmit = (text) => {
    const value = text.trim();
    if (!value) return;
    editor.setText('');
    editor.addToHistory(value);
    void handleSubmit(value);
  };

  editor.onEscape = () => {
    if (halalKey.isActive()) {
      halalKey.dismiss();
      return;
    }
    if (apiKeyManager.isActive()) {
      apiKeyManager.close();
      return;
    }
    if (guidedQa.isActive()) {
      agentRunner.dismissPendingClarification();
      guidedQaDisplayQuery = '';
      guidedQa.close();
      return;
    }
    if (workspaceAttach.isActive()) {
      workspaceAttach.close();
      return;
    }
    if (settingsOpen) {
      settingsOpen = false;
      renderSelectionOverlay();
      tui.requestRender();
      return;
    }
    if (modelSelection.isInSelectionFlow()) {
      modelSelection.cancelSelection();
      return;
    }
    if (agentRunner.isProcessing || agentRunner.pendingApproval) {
      agentRunner.cancelExecution();
      return;
    }
  };

  editor.onCtrlC = () => {
    if (apiKeyManager.isActive()) {
      apiKeyManager.close();
      return;
    }
    if (guidedQa.isActive()) {
      agentRunner.dismissPendingClarification();
      guidedQaDisplayQuery = '';
      guidedQa.close();
      return;
    }
    if (workspaceAttach.isActive()) {
      workspaceAttach.close();
      return;
    }
    if (settingsOpen) {
      settingsOpen = false;
      renderSelectionOverlay();
      tui.requestRender();
      return;
    }
    if (modelSelection.isInSelectionFlow()) {
      modelSelection.cancelSelection();
      return;
    }
    if (agentRunner.isProcessing || agentRunner.pendingApproval) {
      agentRunner.cancelExecution();
      return;
    }
    tui.stop();
    process.exit(0);
  };

  const renderMainView = () => {
    root.clear();
    root.addChild(intro);
    root.addChild(chatLog);
    if (lastError ?? agentRunner.error) {
      root.addChild(errorText);
    }
    if (agentRunner.workingState.status !== 'idle') {
      root.addChild(workingIndicator);
    }
    root.addChild(new Spacer(1));
    root.addChild(editor);
    root.addChild(debugPanel);
    tui.setFocus(editor);
  };

  const renderScreenView = (
    title: string,
    description: string,
    body: any,
    footer?: string,
    focusTarget?: any,
  ) => {
    root.clear();
    root.addChild(createScreen(title, description, body, footer));
    if (focusTarget) {
      tui.setFocus(focusTarget);
    }
  };

  const renderSelectionOverlay = () => {
    if (settingsOpen) {
      const selector = createSettingsSelector((action) => {
        settingsOpen = false;
        if (action === 'model') {
          modelSelection.startSelection();
          return;
        }
        if (action === 'keys') {
          apiKeyManager.open();
          return;
        }
        renderSelectionOverlay();
        tui.requestRender();
      });
      renderScreenView(
        'Settings',
        `Yassir setup · ${getCurrentProfile().vertical.label}`,
        selector,
        'Enter to open · Esc to close',
        selector,
      );
      return;
    }

    const guidedQaState = guidedQa.state;
    if (guidedQaState.appState === 'workflow_select') {
      const selector = createGuidedQaWorkflowSelector(guidedQaState.workflows, (workflowId) => {
        guidedQa.handleWorkflowSelect(workflowId);
        if (workflowId) {
          void proceedWithAdaptiveContext(guidedQaDisplayQuery || guidedQa.getOriginalQuery());
        } else {
          guidedQaDisplayQuery = '';
        }
      });
      renderScreenView(
        'Guided Q&A',
        `Choose a business scenario seed for ${getCurrentProfile().brand.name}.`,
        selector,
        'Enter to continue · Esc to cancel',
        selector,
      );
      return;
    }

    if (guidedQaState.appState === 'structured_question' && guidedQaState.pendingPrompt) {
      const selector = createSimpleSelector(
        (guidedQaState.pendingPrompt.options ?? []).map((option, index) => ({
          value: option.value,
          label: `${index + 1}. ${option.label}`,
          description: option.description,
        })),
        (value) => {
          guidedQa.recordStructuredAnswer(value);
          if (value) {
            void proceedWithAdaptiveContext(guidedQaDisplayQuery || guidedQa.getOriginalQuery());
          } else {
            agentRunner.dismissPendingClarification();
            guidedQaDisplayQuery = '';
            guidedQa.close();
          }
        },
      );
      const body = new Container();
      body.addChild(new Text(guidedQaState.pendingPrompt.question, 0, 0));
      body.addChild(new Spacer(1));
      body.addChild(selector);
      renderScreenView(
        guidedQaState.seedWorkflow?.label ?? 'Clarification',
        guidedQaState.pendingPrompt.label ? `Choose ${guidedQaState.pendingPrompt.label.toLowerCase()}.` : '',
        body,
        'Enter to confirm · Esc to cancel',
        selector,
      );
      return;
    }

    const attachState = workspaceAttach.state;
    if (attachState.appState === 'browse') {
      const selector = createSimpleSelector(
        attachState.entries.map((entry) => ({
          value: entry.value,
          label: entry.label,
          description: entry.description,
        })),
        (value) => {
          void workspaceAttach.handleSelect(value).catch((error) => {
            void workspaceAttach.fail(error);
          });
        },
        18,
      );
      renderScreenView(
        'Attach File',
        `Browse local files and import into the active workspace.\n${attachState.currentDir}`,
        selector,
        'Enter to open/import · Esc to cancel',
        selector,
      );
      return;
    }

    if (attachState.appState === 'importing') {
      const body = new Container();
      body.addChild(new Text(theme.muted(attachState.message || 'Importing file...'), 0, 0));
      renderScreenView('Attach File', '', body);
      return;
    }

    if (attachState.appState === 'done') {
      const body = new Container();
      body.addChild(new Text(theme.success(attachState.message), 0, 0));
      body.addChild(new Text('', 0, 0));
      body.addChild(new Text(theme.muted('Press any key to continue...'), 0, 0));
      const dismissOnKey = new class extends Container {
        handleInput(_keyData: string): void {
          workspaceAttach.dismissDone();
        }
      }();
      dismissOnKey.addChild(body);
      renderScreenView('Attach File', '', dismissOnKey, undefined, dismissOnKey);
      return;
    }

    if (attachState.appState === 'error') {
      const body = new Container();
      body.addChild(new Text(theme.error(`Error: ${attachState.message}`), 0, 0));
      body.addChild(new Text('', 0, 0));
      body.addChild(new Text(theme.muted('Press any key to continue...'), 0, 0));
      const dismissOnKey = new class extends Container {
        handleInput(_keyData: string): void {
          workspaceAttach.close();
        }
      }();
      dismissOnKey.addChild(body);
      renderScreenView('Attach File', '', dismissOnKey, undefined, dismissOnKey);
      return;
    }

    // --- API Key Manager (/keys command) ---
    const keyManagerState = apiKeyManager.state;

    if (keyManagerState.appState === 'provider_select') {
      const selector = createKeyManagerSelector(keyManagerState.keys, (envVar) =>
        apiKeyManager.handleKeySelect(envVar),
      );
      renderScreenView(
        'API Keys',
        'Select a key to add or update. Keys are saved to your .env file.',
        selector,
        'Enter to edit · Esc to close',
        selector,
      );
      return;
    }

    if (keyManagerState.appState === 'key_input' && keyManagerState.selectedKey) {
      const { label, envVar } = keyManagerState.selectedKey;
      const input = new ApiKeyInputComponent(true);
      input.onSubmit = (value) => {
        void apiKeyManager.handleKeySubmit(value);
      };
      input.onCancel = () => {
        void apiKeyManager.handleKeySubmit(null);
      };
      const isHalalTerminal = envVar === 'HALAL_TERMINAL_API_KEY';
      renderScreenView(
        `Set ${label} Key`,
        isHalalTerminal
          ? `(${envVar})\nPaste an ht_... key, or enter your email to generate one automatically.`
          : `(${envVar})`,
        input,
        isHalalTerminal ? 'Enter to save/generate · Esc to go back' : 'Enter to save · Esc to go back',
        input,
      );
      return;
    }

    if (keyManagerState.appState === 'done') {
      const body = new Container();
      body.addChild(new Text(theme.success(`✓ ${keyManagerState.savedKeyLabel ?? 'API'} key saved to .env`), 0, 0));
      body.addChild(new Text('', 0, 0));
      body.addChild(new Text(theme.muted('Press any key to continue...'), 0, 0));
      const dismissOnKey = new class extends Container {
        handleInput(_keyData: string): void {
          apiKeyManager.dismissDone();
        }
      }();
      dismissOnKey.addChild(body);
      renderScreenView('API Keys', '', dismissOnKey, undefined, dismissOnKey);
      return;
    }

    if (keyManagerState.appState === 'error') {
      const body = new Container();
      body.addChild(new Text(theme.error(`Error: ${keyManagerState.errorMessage ?? 'Unknown error'}`), 0, 0));
      body.addChild(new Text('', 0, 0));
      body.addChild(new Text(theme.muted('Press Enter to retry · Esc to go back'), 0, 0));
      const retryOrBack = new class extends Container {
        handleInput(keyData: string): void {
          if (keyData === '\r' || keyData === '\n') {
            apiKeyManager.retryFromError();
          } else if (keyData === '\u001b') {
            apiKeyManager.dismissDone();
          }
        }
      }();
      retryOrBack.addChild(body);
      renderScreenView('API Keys', '', retryOrBack, undefined, retryOrBack);
      return;
    }

    // --- Profile backend setup wizard ---
    const halalState = halalKey.state;
    const currentProfile = getCurrentProfile();
    const backend = currentProfile.vertical.backend;
    const backendSetup = backend?.setup;

    if (halalState.appState === 'confirm' && backend && backendSetup) {
      const selector = createApiKeyConfirmSelector((wantsToSetUp) =>
        halalKey.handleConfirm(wantsToSetUp),
      );
      renderScreenView(
        backendSetup.confirmTitle,
        backendSetup.confirmDescription,
        selector,
        backendSetup.confirmFooter,
        selector,
      );
      return;
    }

    if (halalState.appState === 'email_input' && backendSetup) {
      const input = new ApiKeyInputComponent(false);
      input.onSubmit = (email) => {
        void halalKey.handleEmailSubmit(email);
      };
      input.onCancel = () => halalKey.handleConfirm(false);
      renderScreenView(
        backendSetup.emailTitle,
        backendSetup.emailDescription,
        input,
        backendSetup.emailFooter,
        input,
      );
      return;
    }

    if (halalState.appState === 'generating' && backend && backendSetup) {
      const body = new Container();
      body.addChild(new Text(theme.muted(backendSetup.generatingMessage), 0, 0));
      renderScreenView(backend.label, '', body);
      return;
    }

    if (halalState.appState === 'done' && backend && backendSetup) {
      const body = new Container();
      body.addChild(new Text(theme.success(backendSetup.successMessage), 0, 0));
      body.addChild(new Text(theme.muted(`Key: ${halalState.generatedKey ?? ''}`), 0, 0));
      body.addChild(new Text('', 0, 0));
      body.addChild(new Text(theme.muted('Press any key to continue...'), 0, 0));

      // Dismiss on any keypress
      const dismissOnKey = new class extends Container {
        handleInput(_keyData: string): void {
          halalKey.dismiss();
        }
      }();
      dismissOnKey.addChild(body);
      renderScreenView(backend.label, '', dismissOnKey, undefined, dismissOnKey);
      return;
    }

    if (halalState.appState === 'error') {
      const body = new Container();
      body.addChild(new Text(theme.error(`Error: ${halalState.errorMessage ?? 'Unknown error'}`), 0, 0));
      body.addChild(new Text('', 0, 0));
      body.addChild(new Text(theme.muted('Press Enter to retry · Esc to skip'), 0, 0));

      const retryOrSkip = new class extends Container {
        handleInput(keyData: string): void {
          if (keyData === '\r' || keyData === '\n') {
            halalKey.retryFromError();
          } else if (keyData === '\u001b') {
            halalKey.dismiss();
          }
        }
      }();
      retryOrSkip.addChild(body);
      renderScreenView(backend?.label ?? currentProfile.brand.name, '', retryOrSkip, undefined, retryOrSkip);
      return;
    }

    // --- end profile backend wizard ---

    const state = modelSelection.state;
    if (state.appState === 'idle' && !agentRunner.pendingApproval) {
      refreshError();
      renderMainView();
      return;
    }

    if (agentRunner.pendingApproval) {
      const prompt = new ApprovalPromptComponent(
        agentRunner.pendingApproval.tool,
        agentRunner.pendingApproval.args,
      );
      prompt.onSelect = (decision: ApprovalDecision) => {
        agentRunner.respondToApproval(decision);
      };
      renderScreenView('', '', prompt, undefined, prompt.selector);
      return;
    }

    if (state.appState === 'provider_select') {
      const selector = createProviderSelector(modelSelection.provider, (providerId) => {
        void modelSelection.handleProviderSelect(providerId);
      });
      renderScreenView(
        'Select provider',
        'Switch between LLM providers. Applies to this session and future sessions.',
        selector,
        'Enter to confirm · esc to exit',
        selector,
      );
      return;
    }

    if (state.appState === 'model_select' && state.pendingProvider) {
      const selector = createModelSelector(
        state.pendingModels,
        modelSelection.provider === state.pendingProvider ? modelSelection.model : undefined,
        (modelId) => modelSelection.handleModelSelect(modelId),
        state.pendingProvider,
      );
      renderScreenView(
        `Select model for ${getProviderDisplayName(state.pendingProvider)}`,
        '',
        selector,
        'Enter to confirm · esc to go back',
        selector,
      );
      return;
    }

    if (state.appState === 'model_input' && state.pendingProvider) {
      const input = new ApiKeyInputComponent();
      input.onSubmit = (value) => modelSelection.handleModelInputSubmit(value);
      input.onCancel = () => modelSelection.handleModelInputSubmit(null);
      renderScreenView(
        `Enter model name for ${getProviderDisplayName(state.pendingProvider)}`,
        'Type or paste the model name from openrouter.ai/models',
        input,
        'Examples: anthropic/claude-3.5-sonnet, openai/gpt-4-turbo, meta-llama/llama-3-70b\nEnter to confirm · esc to go back',
        input,
      );
      return;
    }

    if (state.appState === 'api_key_confirm' && state.pendingProvider) {
      const selector = createApiKeyConfirmSelector((wantsToSet) =>
        modelSelection.handleApiKeyConfirm(wantsToSet),
      );
      renderScreenView(
        'Set API Key',
        `Would you like to set your ${getProviderDisplayName(state.pendingProvider)} API key?`,
        selector,
        'Enter to confirm · esc to decline',
        selector,
      );
      return;
    }

    if (state.appState === 'api_key_input' && state.pendingProvider) {
      const input = new ApiKeyInputComponent(true);
      input.onSubmit = (apiKey) => modelSelection.handleApiKeySubmit(apiKey);
      input.onCancel = () => modelSelection.handleApiKeySubmit(null);
      const apiKeyName = getApiKeyNameForProvider(state.pendingProvider) ?? '';
      renderScreenView(
        `Enter ${getProviderDisplayName(state.pendingProvider)} API Key`,
        apiKeyName ? `(${apiKeyName})` : '',
        input,
        'Enter to confirm · Esc to cancel',
        input,
      );
    }
  };

  await inputHistory.init();
  for (const msg of inputHistory.getMessages().reverse()) {
    editor.addToHistory(msg);
  }
  // Show LLM key setup first if missing, then Halal Terminal wizard
  if (!modelSelection.startKeySetupIfNeeded()) {
    halalKey.startIfNeeded();
  }
  renderSelectionOverlay();
  refreshError();
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    process.once('exit', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });

  workingIndicator.dispose();
  debugPanel.dispose();
  runtimeSuggestions.dispose();
}
