import { useEffect, useRef } from 'react';
import type { ApprovalDecision } from '../types';

interface Props {
  tool: string;
  args: Record<string, unknown>;
  onDecide: (decision: ApprovalDecision) => void;
}

function formatToolName(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function ApprovalDialog({ tool, args, onDecide }: Props) {
  const purpose = args.purpose as string | undefined;
  const command = args.command as string | undefined;
  const path = args.path as string | undefined;
  const detail = purpose || command || path || '';
  const blockRef = useRef<HTMLDivElement>(null);

  // P2: Keyboard shortcuts 1/2/3 for approval options
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '1') onDecide('allow-once');
      else if (e.key === '2') onDecide('allow-session');
      else if (e.key === '3') onDecide('deny');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDecide]);

  // Auto-focus the first option for keyboard users
  useEffect(() => {
    const firstBtn = blockRef.current?.querySelector<HTMLButtonElement>('.approval-option');
    firstBtn?.focus();
  }, []);

  return (
    <div className="approval-block" ref={blockRef} role="alertdialog" aria-label="Permission required">
      <div className="approval-border" aria-hidden="true">{'─'.repeat(50)}</div>
      <div className="approval-title">Permission required</div>
      <div className="approval-tool-line">
        {formatToolName(tool)}{detail ? ` ${detail}` : ''}
      </div>
      {command && !purpose && (
        <div className="approval-detail">{command}</div>
      )}
      <div className="approval-question">Do you want to allow this?</div>
      <div className="approval-options">
        <button className="approval-option" onClick={() => onDecide('allow-once')}>
          <span className="arrow">→</span> 1. Yes
          <span className="key">(press 1)</span>
        </button>
        <button className="approval-option" onClick={() => onDecide('allow-session')}>
          <span className="arrow">&nbsp;&nbsp;</span> 2. Yes, allow all this session
          <span className="key">(press 2)</span>
        </button>
        <button className="approval-option" onClick={() => onDecide('deny')}>
          <span className="arrow">&nbsp;&nbsp;</span> 3. No
          <span className="key">(press 3)</span>
        </button>
      </div>
      <div className="approval-footer">Click or press 1/2/3</div>
      <div className="approval-border" aria-hidden="true">{'─'.repeat(50)}</div>
    </div>
  );
}
