// Runbook definitions as configured on the automation platform.
//
// Note on `excludedResourceTypes`: in this dataset it is largely redundant with
// the primary `resourceType` scope — real runbook configs carry the same kind of
// belt-and-braces guard. The engine still evaluates it as a genuine exclusion.

export const runbooks = [
  {
    id: 'RB-001',
    name: 'Hung Service Auto-Restart',
    description:
      'Restarts a service process that has stopped responding to health probes.',
    resourceType: 'service',
    triggerState: 'unresponsive',
    thresholdMinutes: 10,
    action: 'restart_service',
    // Two hosts pinned out during a long-running migration.
    exclusionList: ['SVC-19', 'SVC-20'],
    excludedResourceTypes: ['ticket', 'request'],
    owner: 'Platform Engineering',
  },
  {
    id: 'RB-002',
    name: 'Ticket Closed Without Resolution Notes',
    description:
      'Reopens a ticket closed with an empty resolution field and reassigns it to the closing agent.',
    resourceType: 'ticket',
    triggerState: 'closed_no_notes',
    thresholdMinutes: 60,
    action: 'reopen_and_reassign',
    // Bulk-added as a contiguous range during a Q2 backlog cleanup and never
    // trimmed back afterwards.
    exclusionList: ['TKT-13', 'TKT-14', 'TKT-15', 'TKT-16'],
    excludedResourceTypes: ['service', 'request'],
    owner: 'Service Desk',
  },
  {
    id: 'RB-003',
    name: 'SLA Breach Predicted',
    description:
      'Escalates a request forecast to breach its service level agreement to the on-call queue manager.',
    resourceType: 'request',
    triggerState: 'approaching_sla',
    thresholdMinutes: 25,
    action: 'escalate_to_queue_manager',
    exclusionList: ['REQ-20'],
    excludedResourceTypes: ['service', 'ticket'],
    owner: 'Service Delivery',
  },
];

export const runbooksById = Object.fromEntries(runbooks.map((r) => [r.id, r]));
