import { Container, Text } from '@mariozechner/pi-tui';
import type { ApprovalDecision } from '../agent/types.js';
import { createApprovalSelector } from './select-list.js';
import { theme } from '../theme.js';

function formatToolLabel(tool: string): string {
  return tool
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export class ApprovalPromptComponent extends Container {
  readonly selector: any;
  onSelect?: (decision: ApprovalDecision) => void;

  constructor(tool: string, args: Record<string, unknown>) {
    super();
    this.selector = createApprovalSelector((decision) => this.onSelect?.(decision));
    const width = Math.max(20, process.stdout.columns ?? 80);
    const border = theme.warning('─'.repeat(width));
    const detail = (args.purpose as string) || (args.command as string) || (args.path as string) || '';

    this.addChild(new Text(border, 0, 0));
    this.addChild(new Text(theme.warning(theme.bold('Permission required')), 0, 0));
    this.addChild(new Text(theme.white(formatToolLabel(tool)) + (detail ? ' ' + theme.muted(detail) : ''), 0, 0));
    this.addChild(new Text(theme.muted('Do you want to allow this?'), 0, 0));
    this.addChild(new Text('', 0, 0));
    this.addChild(this.selector);
    this.addChild(new Text('', 0, 0));
    this.addChild(new Text(theme.muted('Enter to confirm · esc to deny'), 0, 0));
    this.addChild(new Text(border, 0, 0));
  }
}
