export function formatModelDisplay(model: string): string {
  const map: Record<string, string> = {
    'gpt-5.4': 'GPT 5.4', 'gpt-4.1': 'GPT 4.1', 'gpt-5-mini': 'GPT 5 Mini',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4', 'claude-opus-4-20250514': 'Claude Opus 4',
    'gemini-2.5-pro': 'Gemini 2.5 Pro', 'deepseek-chat': 'DeepSeek Chat',
  };
  return map[model] ?? model;
}
