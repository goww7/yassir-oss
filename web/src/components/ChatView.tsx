import { useRef, useEffect, useState, useCallback } from 'react';
import { useChat } from '../hooks/useChat';
import type { useProfiles } from '../hooks/useProfiles';
import { MessageBubble } from './MessageBubble';
import { InputBar } from './InputBar';
import { ApprovalDialog } from './ApprovalDialog';
import type { MenuAction } from './HeaderMenu';
import { ModelSelector } from './ModelSelector';
import { ApiKeysPanel } from './ApiKeysPanel';
import { WorkspaceExplorer } from './WorkspaceExplorer';
import { GuidedQaFlow } from './GuidedQaFlow';
import { ExportButton } from './ExportButton';
import { executeSlashCommand, switchModel } from '../api/client';
import { formatModelDisplay } from '../utils/format-model';

const BANNER_WIDTH = 50;

function LoadingSkeleton() {
  return (
    <div className="intro loading-skeleton" aria-busy="true" aria-label="Loading">
      <div className="skeleton-line skeleton-wide" />
      <div className="skeleton-logo" />
      <div className="skeleton-line skeleton-medium" />
      <div className="skeleton-line skeleton-narrow" />
      <div className="skeleton-line skeleton-narrow" />
      <div className="skeleton-prompts">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton-prompt" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="intro error-state" role="alert">
      <div className="error-state-icon">!</div>
      <div className="error-state-title">Connection failed</div>
      <div className="error-state-message">{message}</div>
      <button className="error-state-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}

function IntroBlock({ profile, version, model, hasBackend, onPromptClick }: {
  profile: NonNullable<ReturnType<typeof useProfiles>['current']>;
  version: string;
  model: string;
  hasBackend: boolean;
  onPromptClick: (query: string) => void;
}) {
  const welcome = `Welcome to ${profile.name}`;
  const versionStr = ` v${version}`;
  const full = welcome + versionStr;
  const pad = Math.max(0, Math.floor((BANNER_WIDTH - full.length - 2) / 2));
  const trail = Math.max(0, BANNER_WIDTH - full.length - pad - 2);
  const prompts = hasBackend ? profile.starterPrompts.ready : profile.starterPrompts.setup;

  return (
    <div className="intro">
      <div className="intro-border">{'═'.repeat(BANNER_WIDTH)}</div>
      <div className="intro-banner">
        ║{' '.repeat(pad)}{welcome}<span style={{ color: 'var(--text-muted)' }}>{versionStr}</span>{' '.repeat(trail)}║
      </div>
      <div className="intro-border">{'═'.repeat(BANNER_WIDTH)}</div>
      <pre className="intro-logo">{profile.logo}</pre>
      <div className="intro-title">{profile.title}</div>
      <div className="intro-subtitle">{profile.subtitle}</div>
      <div className="intro-meta">
        <span className="label">Model: </span>
        <span className="value">{formatModelDisplay(model)}</span>
        <span className="sep">  ·  /model to change</span>
      </div>
      {profile.backend ? (
        <div className="intro-meta">
          <span className="label">{profile.backend.statusLabel}: </span>
          {hasBackend
            ? <><span className="value" style={{ color: 'var(--success)' }}>ready</span><span className="sep">  ·  {profile.backend.readyDescription}</span></>
            : <><span className="value" style={{ color: 'var(--warning)' }}>not configured</span><span className="sep">  ·  {profile.backend.missingDescription}</span></>}
        </div>
      ) : (
        <div className="intro-meta">
          <span className="label">Focus: </span><span className="value">{profile.vertical}</span>
          <span className="sep">  ·  Shariah compliance, portfolio intelligence, and research</span>
        </div>
      )}
      <div className="intro-helper">
        Try one of these. Type /1 to /6 to insert a prompt, /guide for a Shariah workflow, or /help for commands:
      </div>
      <div className="intro-prompts">
        {prompts.slice(0, 6).map((prompt, i) => (
          <button key={i} className="intro-prompt" onClick={() => onPromptClick(prompt)}>
            <span className="num">{i + 1}.</span> {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

// Toast notification component
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), 2500);
    const remove = setTimeout(onDone, 2800);
    return () => { clearTimeout(timer); clearTimeout(remove); };
  }, [onDone]);

  return (
    <div className="toast-container">
      <div className={`toast ${exiting ? 'toast-exit' : ''}`}>
        <span className="toast-icon">✓</span>
        {message}
      </div>
    </div>
  );
}

type ProfileState = ReturnType<typeof useProfiles>;

export function ChatView({ sessionId, profileState, menuAction, onMenuActionHandled }: {
  sessionId?: string;
  profileState?: ProfileState;
  menuAction?: MenuAction | null;
  onMenuActionHandled?: () => void;
}) {
  const resolvedSessionId = sessionId ?? crypto.randomUUID();
  const chat = useChat(resolvedSessionId);
  const { current, hasBackend, version, model, loading: profilesLoading, error: profilesError, retry: profilesRetry } = profileState ?? {
    current: undefined, hasBackend: false, version: '', model: '', loading: false, error: null, retry: () => {},
  };
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showGuidedQa, setShowGuidedQa] = useState<{ seedQuery?: string; workflowId?: string } | null>(null);
  const [currentModel, setCurrentModel] = useState(model);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  useEffect(() => { setCurrentModel(model); }, [model]);

  // Handle menu actions from top bar
  useEffect(() => {
    if (!menuAction) return;
    handleMenuAction(menuAction);
    onMenuActionHandled?.();
  }, [menuAction]); // eslint-disable-line

  // Smart auto-scroll — only scroll if user is near the bottom
  useEffect(() => {
    const el = outputRef.current;
    if (!el) { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); return; }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 150) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat.messages]);

  // Track new messages for animation
  useEffect(() => {
    prevMsgCount.current = chat.messages.length;
  }, [chat.messages.length]);

  // Scroll FAB visibility
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollFab(distanceFromBottom > 300);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && chat.status === 'streaming') chat.abort();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chat.status, chat.abort]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  const handleSend = useCallback(async (input: string) => {
    // Starter prompt shortcuts: /1 through /6
    const shortcutMatch = input.match(/^\/([1-6])$/);
    if (shortcutMatch && current) {
      const prompts = hasBackend ? current.starterPrompts.ready : current.starterPrompts.setup;
      const idx = parseInt(shortcutMatch[1]) - 1;
      if (prompts[idx]) { chat.send(prompts[idx]); return; }
    }

    // Slash commands
    if (input.startsWith('/')) {
      if (input === '/model') { setShowModelSelector(true); return; }
      if (input === '/keys') { setShowApiKeys(true); return; }
      if (input === '/settings') { setShowApiKeys(true); return; }
      if (input === '/workspace' || input.startsWith('/workspace ')) { setShowWorkspace(true); return; }
      if (input === '/attach') { setShowWorkspace(true); return; }
      if (input === '/guide') { setShowGuidedQa({}); return; }

      try {
        const result = await executeSlashCommand(input);
        switch (result.kind) {
          case 'local':
            if (result.answer) chat.addLocalAnswer(result.answer);
            return;
          case 'run':
            if (result.query) { chat.send(result.query); return; }
            break;
          case 'insert':
            if (result.text) { chat.send(result.text); return; }
            break;
          case 'guide':
            setShowGuidedQa({ seedQuery: result.seedQuery, workflowId: result.workflowId });
            return;
          case 'attach':
            setShowWorkspace(true);
            return;
          case 'passthrough':
            // Passthrough — send as regular query
            break;
          default:
            break;
        }
      } catch (err) {
        // Show error to user instead of silently sending as query
        const msg = err instanceof Error ? err.message : 'Command failed';
        showToast(msg);
        return;
      }
    }

    chat.send(input);
  }, [chat, current, hasBackend]);

  const handleMenuAction = useCallback(async (action: MenuAction) => {
    switch (action) {
      case 'model': setShowModelSelector(true); break;
      case 'keys': setShowApiKeys(true); break;
      case 'workspace': setShowWorkspace(true); break;
      case 'guide': setShowGuidedQa({}); break;
      case 'help': {
        const result = await executeSlashCommand('/help');
        if (result.kind === 'local' && result.answer) chat.addLocalAnswer(result.answer);
        break;
      }
      case 'doctor': {
        const result = await executeSlashCommand('/doctor');
        if (result.kind === 'local' && result.answer) chat.addLocalAnswer(result.answer);
        break;
      }
    }
  }, [chat]);

  const handleModelSelect = useCallback(async (provider: string, modelId: string, displayName: string) => {
    await switchModel(provider, modelId);
    setCurrentModel(modelId);
    setShowModelSelector(false);
    showToast(`Model switched to ${displayName}`);
  }, [showToast]);

  const isStreaming = chat.status === 'streaming';

  return (
    <div className="terminal" style={{ position: 'relative' }}>
      <div className="terminal-output" ref={outputRef}>
        {chat.messages.length === 0 && profilesLoading && <LoadingSkeleton />}
        {chat.messages.length === 0 && profilesError && <ErrorState message={profilesError} onRetry={profilesRetry} />}
        {chat.messages.length === 0 && !profilesLoading && !profilesError && current && (
          <IntroBlock profile={current} version={version} model={currentModel || model} hasBackend={hasBackend} onPromptClick={handleSend} />
        )}

        {chat.messages.map((msg, i) => {
          const isNew = i >= prevMsgCount.current - 1;
          return (
            <div key={msg.id} className={isNew ? 'message-enter' : ''}>
              {i > 0 && msg.role === 'user' && <div className="separator" />}
              <MessageBubble
                message={msg}
                isStreaming={isStreaming && i === chat.messages.length - 1 && msg.role === 'assistant'}
                onClarificationAnswer={(answer) => chat.send(answer)}
              />
            </div>
          );
        })}

        {/* Inline approval */}
        {chat.status === 'awaiting_approval' && chat.pendingApproval && (
          <ApprovalDialog tool={chat.pendingApproval.tool} args={chat.pendingApproval.args} onDecide={chat.approve} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom FAB */}
      {showScrollFab && (
        <button className="scroll-fab scroll-fab-enter" onClick={scrollToBottom} aria-label="Scroll to bottom">
          ↓
        </button>
      )}

      {/* Toast */}
      {toastMsg && <Toast message={toastMsg} onDone={() => setToastMsg(null)} />}

      <div className="terminal-input-area">
        <div className="input-row">
          <InputBar
            onSend={handleSend}
            onAbort={isStreaming ? chat.abort : undefined}
            disabled={isStreaming || chat.status === 'awaiting_approval'}
          />
          <ExportButton messages={chat.messages} />
        </div>
        {chat.error && <div className="terminal-error">{chat.error}</div>}
      </div>

      {/* Modals */}
      {showModelSelector && (
        <ModelSelector onClose={() => setShowModelSelector(false)} onSelect={handleModelSelect} />
      )}
      {showApiKeys && (
        <ApiKeysPanel
          onClose={() => setShowApiKeys(false)}
          onMessage={(msg) => { showToast(msg); setShowApiKeys(false); }}
        />
      )}
      {showWorkspace && (
        <WorkspaceExplorer
          onClose={() => setShowWorkspace(false)}
          onMessage={(msg) => { showToast(msg); setShowWorkspace(false); }}
        />
      )}
      {showGuidedQa && (
        <GuidedQaFlow
          seedQuery={showGuidedQa.seedQuery}
          preselectedWorkflowId={showGuidedQa.workflowId}
          onComplete={(enrichedQuery) => { setShowGuidedQa(null); chat.send(enrichedQuery); }}
          onCancel={() => setShowGuidedQa(null)}
        />
      )}
    </div>
  );
}
