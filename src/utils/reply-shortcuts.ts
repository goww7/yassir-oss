export interface ReplyShortcutOption {
  index: number;
  text: string;
}

const NUMBERED_LINE_RE = /^(\d{1,2})[.)]\s+(.+)$/;

export function extractReplyShortcutOptions(answer: string): ReplyShortcutOption[] {
  const lines = answer.split(/\r?\n/);
  const options: ReplyShortcutOption[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = line.match(NUMBERED_LINE_RE);
    if (match) {
      const index = Number(match[1]);
      const text = match[2]?.trim();
      if (!Number.isNaN(index) && text) {
        options.push({ index, text });
      }
      continue;
    }

    if (
      options.length > 0 &&
      rawLine.trim() &&
      /^\s+/.test(rawLine) &&
      !NUMBERED_LINE_RE.test(rawLine.trim())
    ) {
      const last = options[options.length - 1];
      last.text = `${last.text} ${rawLine.trim()}`.trim();
    }
  }

  if (options.length < 2 || options[0]?.index !== 1) {
    return [];
  }

  for (let i = 0; i < options.length; i++) {
    if (options[i]?.index !== i + 1) {
      return [];
    }
  }

  return options.slice(0, 6);
}

export function getReplyShortcutOption(answer: string, digit: number): string | null {
  const option = extractReplyShortcutOptions(answer).find((entry) => entry.index === digit);
  return option?.text ?? null;
}
