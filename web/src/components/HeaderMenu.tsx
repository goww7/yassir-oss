import { useState, useEffect, useRef } from 'react';

export type MenuAction = 'model' | 'keys' | 'workspace' | 'guide' | 'help' | 'doctor';

interface Props {
  onAction: (action: MenuAction) => void;
  currentModel: string;
}

const MENU_ICONS: Record<MenuAction, string> = {
  model: '\u{2728}',     // sparkles
  keys: '\u{1F511}',     // key
  workspace: '\u{1F4C1}', // folder
  guide: '\u{1F9ED}',    // compass
  help: '\u{2753}',      // question
  doctor: '\u{1F6E0}',   // wrench
};

export function HeaderMenu({ onAction, currentModel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [open]);

  const items: Array<{ action: MenuAction; label: string; shortcut: string; detail?: string }> = [
    { action: 'model', label: 'Model', shortcut: '/model', detail: currentModel },
    { action: 'keys', label: 'API Keys', shortcut: '/keys' },
    { action: 'workspace', label: 'Portfolio Room', shortcut: '/workspace' },
    { action: 'guide', label: 'Shariah Workflow', shortcut: '/guide' },
    { action: 'help', label: 'Help', shortcut: '/help' },
    { action: 'doctor', label: 'System Check', shortcut: '/doctor' },
  ];

  return (
    <div className="header-menu" ref={ref}>
      <button
        className="header-menu-trigger"
        onClick={() => setOpen(!open)}
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>
      {open && (
        <div className="header-menu-dropdown" role="menu">
          {items.map((item) => (
            <button
              key={item.action}
              role="menuitem"
              className="header-menu-item"
              onClick={() => { onAction(item.action); setOpen(false); }}
            >
              <span style={{ fontSize: '14px', width: '20px', textAlign: 'center' }}>{MENU_ICONS[item.action]}</span>
              <span className="menu-label">{item.label}</span>
              {item.detail && <span className="menu-detail">{item.detail}</span>}
              <span className="menu-shortcut">{item.shortcut}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
