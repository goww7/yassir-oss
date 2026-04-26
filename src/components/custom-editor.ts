import { Editor, Key, matchesKey } from '@mariozechner/pi-tui';

export class CustomEditor extends Editor {
  onEscape?: () => void;
  onCtrlC?: () => void;
  onEmptyDigitShortcut?: (digit: number) => boolean;
  onEmptyKeyShortcut?: (key: string) => boolean;
  private currentText = '';

  trackText(text: string): void {
    this.currentText = text;
  }

  setText(text: string): void {
    this.currentText = text;
    super.setText(text);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) && this.onEscape) {
      this.onEscape();
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) && this.onCtrlC) {
      this.onCtrlC();
      return;
    }
    if (
      this.onEmptyDigitShortcut &&
      this.currentText.trim() === '' &&
      data.length === 1 &&
      /^[1-6]$/.test(data)
    ) {
      if (this.onEmptyDigitShortcut(Number(data))) {
        return;
      }
    }
    if (
      this.onEmptyKeyShortcut &&
      this.currentText.trim() === '' &&
      data.length === 1 &&
      /^[a-zA-Z]$/.test(data)
    ) {
      if (this.onEmptyKeyShortcut(data.toLowerCase())) {
        return;
      }
    }
    super.handleInput(data);
  }
}
