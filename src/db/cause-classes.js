// The vocabulary a diagnosis assigns causes from.
//
// Its own module, and this is the whole reason: both sides of the diagnosis
// layer need the enum and only one of them may see the answers. If it lived in
// expected-findings.js then src/engine/diagnose.js would have to import the
// file containing the expected findings in order to know what a cause class is,
// and the ground truth would be sitting in the module graph of the thing being
// tested. Same rule as generate-sql.js never importing baselines.js.
//
// The first five are the classes CLAUDE.md's scope boundary names — the ones
// detect.js deliberately does not assign.
//
// `unexplained` is the sixth and it is load-bearing rather than a fallback. A
// layer required to pick one of five causes for every miss will produce one for
// every miss, and a manufactured cause is worse than an acknowledged gap: it is
// wrong, it is confident, and it sends somebody to fix a thing that is not
// broken. Two misses in this dataset were pinned clear of every cluster on
// purpose so that a diagnosis has to be willing to say this about them.

export const CAUSE_CLASSES = [
  'infrastructure',
  'configuration',
  'data',
  'logic-gap',
  'detector-error',
  'unexplained',
];
