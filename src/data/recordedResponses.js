// Recorded model responses, served by demo mode when no API key is present.
//
// GENERATED FILE — captured from live API calls by scripts/record-fixtures.mjs.
// Re-run `npm run record` after changing a template or the prompt; a recording
// is bound by `templateHash` to the exact template text it answers, and demo
// mode refuses to serve one whose template has since been edited.

export const FIXTURES_ARE_SYNTHETIC = false;

export const recordedResponses = {
  "TPL-SERVICE-RESTART": {
    "templateId": "TPL-SERVICE-RESTART",
    "templateHash": "797e3003",
    "model": "claude-opus-5",
    "usage": {
      "inputTokens": 1999,
      "outputTokens": 243
    },
    "elapsedMs": 5865,
    "recordedAt": "2026-08-08T03:10:13.533Z",
    "raw": "{\"name\":\"SOP-0114 — Hung Service Auto-Restart\",\"resourceType\":\"service\",\"triggerState\":\"unresponsive\",\"thresholdMinutes\":10,\"action\":\"restart_service\",\"owner\":\"Platform Engineering\",\"exclusionList\":[\"SVC-19\",\"SVC-20\"],\"excludedResourceTypes\":[\"ticket\",\"request\"],\"notes\":\"Threshold was previously 5 minutes, raised to 10 minutes in March 2025 (INC-4471); current value 10 taken. Document is v3.2, superseding v2.9. Owner transferred from Infra to Platform Engineering (2025-06); Platform Engineering taken. States 'degraded' and 'restarting' mentioned only to rule out.\"}"
  },
  "TPL-TICKET-REOPEN": {
    "templateId": "TPL-TICKET-REOPEN",
    "templateHash": "080434be",
    "model": "claude-opus-5",
    "usage": {
      "inputTokens": 1809,
      "outputTokens": 275
    },
    "elapsedMs": 5701,
    "recordedAt": "2026-08-08T03:10:19.235Z",
    "raw": "{\"name\":\"Reopen closed tickets without resolution notes\",\"resourceType\":\"ticket\",\"triggerState\":\"closed_no_notes\",\"thresholdMinutes\":60,\"action\":\"reopen_and_reassign\",\"owner\":\"Service Desk\",\"exclusionList\":[\"TKT-13\",\"TKT-14\",\"TKT-15\",\"TKT-16\"],\"excludedResourceTypes\":[\"service\",\"request\"],\"notes\":\"Threshold previously documented as 30 minutes; superseded by the Q2 revision to 60 minutes (stated in the Spanish note and the summary). Owner ambiguity between Queue Management (thread participant) and Service Desk; document explicitly states Service Desk owns it. Exclusion range TKT-13 through TKT-16 was flagged as stale from Q2 backlog cleanup but is confirmed still live.\"}"
  }
};
