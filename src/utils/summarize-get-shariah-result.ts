/**
 * Human-readable summary for {@code get_shariah} meta-tool JSON (`formatToolResult` payload).
 * The CLI/Web default counter skips `_`-prefixed keys (`_errors`, `_workflow`), which yields
 * misleading "0 fields" when Halal Terminal sub-calls all failed.
 */
function findFirstDataset(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function collectDegradedSources(data: Record<string, unknown>): string[] {
  const collected = new Set<string>();
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sources = (value as Record<string, unknown>).degraded_sources;
      if (Array.isArray(sources)) {
        for (const entry of sources) {
          if (typeof entry === 'string' && entry.trim().length > 0) {
            collected.add(entry.trim());
          }
        }
      }
    }
  }
  return [...collected];
}

export function summarizeGetShariahData(data: Record<string, unknown>): string {
  const errs = data._errors;
  const wf = data._workflow as Record<string, unknown> | undefined;
  const datasetKeys = Object.keys(data).filter((k) => !k.startsWith('_'));
  const recovery = wf?.recovery as Record<string, unknown> | undefined;
  const completeness = wf && typeof wf.completeness === 'string' ? wf.completeness : undefined;
  const firstDataset = findFirstDataset(data);
  const appStatus =
    firstDataset && typeof firstDataset.app_compliance_status === 'string'
      ? (firstDataset.app_compliance_status as string)
      : null;

  if (completeness === 'quota_blocked') {
    const hasDashboard = typeof recovery?.dashboardUrl === 'string';
    const suffix = hasDashboard ? ' · refill or upgrade credits' : ' · refill credits';
    return datasetKeys.length
      ? `Shariah · action required${suffix} · ${datasetKeys.length} dataset(s)`
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

  // ETF disposition path: surface the disposition + attestation count instead of a generic counter.
  if (firstDataset?.is_etf === true && typeof firstDataset.disposition === 'string') {
    const attestations = firstDataset.methodology_attestations;
    const attestationCount = attestations && typeof attestations === 'object'
      ? Object.keys(attestations as Record<string, unknown>).length
      : 0;
    const tail = attestationCount > 0 ? ` · ${attestationCount} scholar attestation(s)` : '';
    return `Shariah · ETF disposition: ${firstDataset.disposition}${tail}`;
  }

  // Abstain path: ADR currency mismatch and similar INSUFFICIENT_DATA cases.
  if (appStatus === 'abstain') {
    const reason =
      firstDataset && typeof firstDataset.abstain_reason === 'string'
        ? (firstDataset.abstain_reason as string).replace(/\s+/g, ' ').trim().slice(0, 120)
        : '';
    return reason
      ? `Shariah · abstained · ${reason}`
      : 'Shariah · abstained · insufficient data for a confident verdict';
  }

  // Degradation path: insights returned 200 + note (e.g. SEC EDGAR temporarily unavailable).
  const degradedSources = collectDegradedSources(data);
  if (degradedSources.length > 0 && datasetKeys.length > 0) {
    const noteCount = degradedSources.length;
    const firstNote = degradedSources[0]!.replace(/\s+/g, ' ').slice(0, 80);
    const moreSuffix = noteCount > 1 ? ` (+${noteCount - 1} more)` : '';
    return `Shariah · partial · ${firstNote}${moreSuffix} · ${datasetKeys.length} dataset(s)`;
  }

  if (datasetKeys.length > 0) {
    if (completeness && completeness !== 'complete') {
      return `Shariah · ${completeness} · ${datasetKeys.length} dataset(s)`;
    }
    return `Shariah · ${datasetKeys.length} dataset(s)`;
  }

  if (typeof data.error === 'string' && data.error.trim()) {
    return `Shariah · ${data.error.trim().slice(0, 120)}`;
  }

  return 'Shariah · no screening data returned';
}
