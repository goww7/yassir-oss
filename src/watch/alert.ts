/** Pure alert formatting + filtering for `yassir watch`. */
import type { Change, ChangeKind } from './diff.js';

const ICON: Record<ChangeKind, string> = {
  flipped_out: '🔴',
  became_unknown: '🟠',
  flipped_in: '🟢',
  resolved: '🔵',
  new: '•',
};

const LABEL: Record<ChangeKind, string> = {
  flipped_out: 'NO LONGER COMPLIANT',
  flipped_in: 'now compliant',
  became_unknown: 'verdict now indeterminate',
  resolved: 'verdict resolved',
  new: 'now tracked',
};

export function formatChange(c: Change): string {
  return `${ICON[c.kind]} ${c.symbol} — ${LABEL[c.kind]}`;
}

/** Changes worth surfacing. By default the baseline `new` entries are silent. */
export function alertableChanges(changes: Change[], includeBaseline = false): Change[] {
  return changes.filter((c) => includeBaseline || c.kind !== 'new');
}
