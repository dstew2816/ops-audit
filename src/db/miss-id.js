// How a miss is named. Shared by the diagnosis layer and the impact model.

/** The columns a baseline's antiJoinKeys name, with the JSON prefix stripped. */
export function identityColumns(baseline) {
  return baseline.antiJoinKeys.map((key) => key.replace(/^\$\./, ''));
}

/**
 * A miss's identifier: the ASOP, then that candidate type's identity columns.
 *
 * Built from antiJoinKeys rather than from a hand-picked column, so it is
 * exactly as specific as the anti-join is. ASOP-402 names a check with one
 * column and ASOP-207 needs three to name a batch's position at a step; these
 * are not all the same length and should not be forced to be.
 */
export function missId(baseline, row) {
  return [baseline.asopId, ...identityColumns(baseline).map((column) => row[column])].join(':');
}
