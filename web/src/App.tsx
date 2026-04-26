import { useState, useCallback } from 'react';
import { useSessions } from './hooks/useSessions';
import { useProfiles } from './hooks/useProfiles';
import { ChatView } from './components/ChatView';
import { SessionTabs } from './components/SessionTabs';
import { ThemeToggle } from './components/ThemeToggle';
import { HeaderMenu, type MenuAction } from './components/HeaderMenu';

import { formatModelDisplay } from './utils/format-model';

export function App() {
  const { sessions, activeSessionId, addSession, removeSession, selectSession } = useSessions();
  const profileState = useProfiles();
  const [menuAction, setMenuAction] = useState<MenuAction | null>(null);

  const handleMenuAction = useCallback((action: MenuAction) => {
    setMenuAction(action);
  }, []);

  const clearMenuAction = useCallback(() => {
    setMenuAction(null);
  }, []);

  return (
    <div className="app-shell">
      <div className="app-top-bar">
        <SessionTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={selectSession}
          onNew={addSession}
          onClose={removeSession}
        />
        <div className="app-top-actions">
          <HeaderMenu
            onAction={handleMenuAction}
            currentModel={formatModelDisplay(profileState.model)}
          />
          <ThemeToggle />
        </div>
      </div>
      <div className="app-main">
        {sessions.map((s) => (
          <div key={s.id} style={{ display: s.id === activeSessionId ? 'flex' : 'none', flex: 1, flexDirection: 'column' }}>
            <ChatView
              sessionId={s.id}
              profileState={profileState}
              menuAction={s.id === activeSessionId ? menuAction : null}
              onMenuActionHandled={clearMenuAction}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
        <a href="https://api.halalterminal.com" target="_blank" rel="noopener"
          style={{ fontSize: '11px', opacity: 0.5, textDecoration: 'none', color: 'inherit' }}>
          Powered by HalalTerminal
        </a>
      </div>
    </div>
  );
}
