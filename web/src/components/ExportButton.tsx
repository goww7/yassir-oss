import type { ChatMessage } from '../types';

function messagesToMarkdown(messages: ChatMessage[]): string {
  const lines: string[] = ['# Yassir Research Session', '', `_Exported ${new Date().toISOString()}_`, ''];

  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push('---', '', `**User:** ${msg.content}`, '');
    } else {
      // Tool events
      const toolStarts = msg.events.filter((e) => e.type === 'tool_start');
      if (toolStarts.length > 0) {
        lines.push('_Tools used:_');
        for (const e of toolStarts) {
          const tool = (e.tool as string).replace(/_/g, ' ');
          lines.push(`- ${tool}`);
        }
        lines.push('');
      }
      if (msg.content) {
        lines.push(msg.content, '');
      }
      // Stats
      const done = msg.events.find((e) => e.type === 'done');
      if (done) {
        const time = (done.totalTime as number) / 1000;
        const tokens = (done as { tokenUsage?: { totalTokens: number } }).tokenUsage?.totalTokens;
        lines.push(`_${time.toFixed(1)}s${tokens ? ` · ${tokens.toLocaleString()} tokens` : ''}_`, '');
      }
    }
  }
  return lines.join('\n');
}

export function ExportButton({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) return null;

  const handleExport = () => {
    const md = messagesToMarkdown(messages);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yassir-session-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button className="export-btn" onClick={handleExport} title="Export chat as Markdown">
      ↓ Export
    </button>
  );
}
