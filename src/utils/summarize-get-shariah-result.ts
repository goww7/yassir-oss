/**
 * Human-readable summary for {@code get_shariah} meta-tool JSON (`formatToolResult` payload).
 * The CLI/Web default counter skips `_`-prefixed keys (`_errors`, `_workflow`), which yields
 * misleading "0 fields" when Halal Terminal sub-calls all failed.
 */
export function summarizeGetShariahData(data: Record<string, unknown>): string {
  const errs = data._errors;
  const wf = data._workflow as Record<string, unknown> | undefined;
  const datasets = Object.keys(data).filter((k) => !k.startsWith('_'));
  const recovery = wf?.recovery as Record<string, unknown> | undefined;
  const completeness = wf && typeof wf.completeness === 'string' ? wf.completeness : undefined;

  if (completeness === 'quota_blocked') {
    const hasDashboard = typeof recovery?.dashboardUrl === 'string';
    const suffix = hasDashboard ? ' · refill or upgrade credits' : ' · refill credits';
    return datasets.length
      ? `Shariah · action required${suffix} · ${datasets.length} dataset(s)`
      : `Shariah · action required${suffix}`;
  }

  if (Array.isArray(errs) && errs.length > 0) {
    const first = errs[0] as { tool?: string; error?: string };
    const toolPart = typeof first.tool === 'string' ? `${first.tool}: ` : '';
    const msg =
      typeof first.error === 'string' ? first.error.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const extra = errs.length > 1 ? ` (+${errs.length - 1} more)` : '';
    return msg
      ? `Shariah · ${errs.length} error(s)${extra} · ${toolPart}${msg}`
      : `Shariah · ${errs.length} error(s)${extra}`;
  }

  if (datasets.length > 0) {
    if (completeness && completeness !== 'complete') {
      return `Shariah · ${completeness} · ${datasets.length} dataset(s)`;
    }
    return `Shariah · ${datasets.length} dataset(s)`;
  }

  if (typeof data.error === 'string' && data.error.trim()) {
    return `Shariah · ${data.error.trim().slice(0, 120)}`;
  }

  return 'Shariah · no screening data returned';
}
