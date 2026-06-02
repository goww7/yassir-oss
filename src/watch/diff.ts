/**
 * Pure compliance-change detection for `yassir watch`.
 *
 * Compares the previous and current Shariah verdicts for a set of symbols and
 * returns what changed. No I/O — trivially testable. The monitor decides which
 * changes to alert on (flips loud, `new` is silent baseline).
 */

export interface Verdict {
  /** true = compliant, false = non-compliant, null = indeterminate/unknown. */
  is_compliant: boolean | null;
}

export type VerdictMap = Record<string, Verdict>;

export type ChangeKind =
  | 'flipped_out' // compliant -> non-compliant (the alert that matters most)
  | 'flipped_in' // non-compliant -> compliant
  | 'became_unknown' // had a verdict -> indeterminate
  | 'resolved' // indeterminate -> has a verdict
  | 'new'; // not previously tracked

export interface Change {
  symbol: string;
  kind: ChangeKind;
  from: boolean | null | undefined;
  to: boolean | null;
}

export function diffVerdicts(prev: VerdictMap, next: VerdictMap): Change[] {
  const changes: Change[] = [];
  for (const [symbol, nv] of Object.entries(next)) {
    const to = nv.is_compliant;
    const pv = prev[symbol];

    if (pv === undefined) {
      changes.push({ symbol, kind: 'new', from: undefined, to });
      continue;
    }

    const from = pv.is_compliant;
    if (from === to) continue; // unchanged — silent

    let kind: ChangeKind;
    if (to === null) kind = 'became_unknown';
    else if (from === null) kind = 'resolved';
    else if (from === true && to === false) kind = 'flipped_out';
    else kind = 'flipped_in'; // from === false && to === true

    changes.push({ symbol, kind, from, to });
  }
  return changes;
}
