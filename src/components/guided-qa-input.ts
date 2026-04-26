import { Input } from '@mariozechner/pi-tui';
import { theme } from '../theme.js';

export class GuidedQaInputComponent {
  private readonly input = new Input();
  private readonly suggestedValue: string;
  private readonly placeholder: string;
  private readonly allowBlank: boolean;
  onSubmit?: (value: string | null) => void;
  onBack?: () => void;
  onCancel?: () => void;

  constructor(options?: { suggestedValue?: string; placeholder?: string; allowBlank?: boolean }) {
    this.suggestedValue = options?.suggestedValue ?? '';
    this.placeholder = options?.placeholder ?? '';
    this.allowBlank = options?.allowBlank ?? true;
  }

  invalidate() {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const lines = this.input.render(Math.max(10, width - 4));
    const raw = lines[0] ?? '';
    const maxDisplay = Math.max(0, width - 2);
    const display = raw.slice(0, maxDisplay) || theme.muted(this.placeholder || this.suggestedValue || 'Type your answer');
    const helper = this.suggestedValue
      ? `Enter to confirm · blank uses suggestion: ${this.suggestedValue}`
      : this.allowBlank
        ? 'Enter to confirm · blank skips'
        : 'Enter to confirm · input required';
    return [`${theme.primary('> ')}${display}`, theme.muted(helper)];
  }

  handleInput(keyData: string): void {
    if (keyData === '\r' || keyData === '\n') {
      this.onSubmit?.(this.input.getValue().trim() || null);
      return;
    }
    if (keyData === '\u001b') {
      this.onBack?.();
      return;
    }
    if (keyData === '\u0003') {
      this.onCancel?.();
      return;
    }
    this.input.handleInput(keyData);
  }

  getValue(): string {
    return this.input.getValue();
  }
}
