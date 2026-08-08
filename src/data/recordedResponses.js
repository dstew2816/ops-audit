// Recorded model responses, served by demo mode when no API key is present.
//
// ---------------------------------------------------------------------------
// THESE ARE PLACEHOLDERS. They were written by hand to the response schema,
// not captured from a live API call, and they carry no token counts or
// timestamps because there is no real call behind them to report.
//
// Replace them with genuine captures:
//
//     VITE_ANTHROPIC_API_KEY=sk-ant-... npm run record
//
// which calls the model once per template and overwrites this file, setting
// FIXTURES_ARE_SYNTHETIC to false. The UI reads that flag and labels the
// panel accordingly, so it is always accurate about what it is showing.
// ---------------------------------------------------------------------------
//
// `templateHash` ties each recording to the exact template text it answers.
// Edit a template and its recording stops matching, which is the intended
// behaviour — demo mode then says it has no recording rather than serving an
// answer to a question nobody asked.

export const FIXTURES_ARE_SYNTHETIC = true;

export const recordedResponses = {
  'TPL-SERVICE-RESTART': {
    templateId: 'TPL-SERVICE-RESTART',
    templateHash: '797e3003',
    model: 'claude-opus-5',
    usage: null,
    elapsedMs: null,
    recordedAt: null,
    raw: `{
  "name": "Hung Service Auto-Restart",
  "resourceType": "service",
  "triggerState": "unresponsive",
  "thresholdMinutes": 10,
  "action": "restart_service",
  "owner": "Platform Engineering",
  "exclusionList": ["SVC-19", "SVC-20"],
  "excludedResourceTypes": ["ticket", "request"],
  "notes": "Threshold is stated as 10 minutes in step 2 and confirmed by the change history (raised from 5 to 10 in 2025-03 after INC-4471); took 10 and discarded the superseded 5. The document mentions degraded and restarting only to rule them out, so triggerState is unresponsive alone. Owner taken from the header and corroborated by the 2025-06 transfer entry. SVC-19 and SVC-20 are exempted for the duration of a migration, so this exclusion is time-bounded and worth re-checking once that work completes."
}`,
  },

  'TPL-TICKET-REOPEN': {
    templateId: 'TPL-TICKET-REOPEN',
    templateHash: '080434be',
    model: 'claude-opus-5',
    usage: null,
    elapsedMs: null,
    recordedAt: null,
    raw: `{
  "name": "Ticket Closed Without Resolution Notes",
  "resourceType": "ticket",
  "triggerState": "closed_no_notes",
  "thresholdMinutes": 60,
  "action": "reopen_and_reassign",
  "owner": "Service Desk",
  "exclusionList": ["TKT-13", "TKT-14", "TKT-15", "TKT-16"],
  "excludedResourceTypes": ["service", "request"],
  "notes": "The thread disagrees on the threshold: an earlier document said 30 minutes and the quoted reply says 'an hour'. The Spanish note settles it at 60 minutes and marks 30 as obsolete after the Q2 review, so 60 was taken. Two teams appear in the thread; the summary states explicitly that Service Desk owns this one, not Queue Management. The exclusion is written as the range TKT-13 through TKT-16 and expanded here to all four IDs. The author flags that this range was a bulk addition from the Q2 backlog cleanup that should have been trimmed back and never was — it is still live, so it is recorded as configured rather than as intended."
}`,
  },
};
