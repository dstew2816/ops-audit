// Runbook templates as they actually exist inside an organisation: process
// documentation written by the people who run the process, not a spec written
// for a machine to consume.
//
// Both templates describe a runbook the automation platform already has
// configured (`runbookId`), so a definition generated from one can be run
// against the real execution log rather than against nothing. The configured
// version is ground truth; the template is the prose it was supposedly built
// from. The gap between them is the point.
//
// Deliberate properties of this text — the model has to survive all of them:
//   - two languages interleaved mid-document, sometimes mid-sentence
//   - superseded values left inline next to the current one
//   - the threshold stated twice, in different units, in different places
//   - exclusions buried in a parenthetical rather than listed
//   - forum/email formatting, quote markers, dead cross-references

export const templates = [
  {
    id: 'TPL-SERVICE-RESTART',
    label: 'SOP — Dienst reagiert nicht (DE/EN)',
    runbookId: 'RB-001',
    note: 'Ops wiki page, machine-translated in patches, three revisions deep.',
    text: `SOP-0114 — Dienst reagiert nicht / Hung Service Auto-Restart
Stand: v3.2 (ersetzt v2.9 — alte Version noch im Confluence, NICHT verwenden)
Owner: Platform Engineering / Betrieb 2nd Level
Rufbereitschaft ab 18:00 siehe Dienstplan

ZWECK
=====
Wenn ein Dienst nicht mehr auf die Health-Probes antwortet, soll der Prozess
automatisch neu gestartet werden, ohne dass jemand ein Ticket aufmacht.
(auto-restart -- no ticket required unless it fails twice in a row, dann
eskalieren an 2nd Level)

Der Monitoring-Agent setzt den State auf "unresponsive". Das ist der einzige
State der zählt. Es gibt daneben noch degraded und restarting, die sind hier
NICHT gemeint.

ABLAUF / procedure
==================
  1. monitoring flags the service --> state wird "unresponsive"
  2. warten. 10 Minuten. WICHTIG: erst nach 10 min, nicht sofort!!!
     sonst restart-loop wie bei INC-4471
     (früher waren es 5 min, wurde im März angepasst)
  3. wenn der Dienst dann immer noch unresponsive ist:
     --> restart_service ausführen
  4. Ergebnis wird ins Execution Log geschrieben. Fertig.

  --> Schritt 2 und 3 macht die Automation selbst, nicht der Operator.

AUSNAHMEN (bitte beachten!)
===========================
Zwei Hosts sind während der laufenden Migration ausgenommen und dürfen
NICHT automatisch neu gestartet werden: SVC-19, SVC-20. Bitte nicht anfassen,
Rückfragen an Migration Team.

Gilt selbstverständlich nur für services. Tickets und Requests haben ihre
eigenen Runbooks (siehe SOP-0119 bzw. SOP-0122), hier explizit ausgeschlossen.

--
Änderungshistorie: 2025-03 Schwellwert 5->10 min (INC-4471). 2025-06 Owner
von Infra auf Platform Engineering übertragen. 2026-01 Ausnahmeliste ergänzt.`,
  },
  {
    id: 'TPL-TICKET-REOPEN',
    label: 'FW: RE: closed tickets w/o notes (email thread)',
    runbookId: 'RB-002',
    note: 'Never made it to the wiki. This forwarded thread is the documentation.',
    text: `FW: RE: RE: process doc -- closed tickets w/o resolution notes
(someone please add this to the wiki, we keep re-explaining it)

Hi all -- consolidating what we agreed so it's written down somewhere.
Adjunto abajo el hilo original. -- SD Ops

> > From: Service Desk Ops
> > Subject: RE: closed tickets w/o resolution notes
> >
> > yes -- the bot reopens the ticket if it was closed and the resolution
> > field came back empty. the state in the tool shows up as
> > closed_no_notes, that's what we key off.
> >
> > it should NOT fire straight away though. people close the ticket and
> > then go and write the notes afterwards, happens constantly. give it an
> > hour first.
> >
> > > From: Queue Management
> > > can we get a number on "an hour"? the last doc said 30
> > > minutes and nobody could tell me which was right.

Nota: el umbral acordado es de 60 minutos. El valor anterior (30 min) quedó
obsoleto tras la revisión del Q2 -- ignorar cualquier documento que diga 30.

So, to summarise what the automation does:

 * trigger state = closed_no_notes
 * wait 60 min
 * action = reopen_and_reassign  (goes back to the agent who closed it,
   not to the queue -- this caught people out last time)
 * owner for this one is Service Desk (not Queue Management, despite the
   thread above)

 * excluded: TKT-13 through TKT-16. this was a bulk range added during the
   Q2 backlog cleanup and honestly it should have been trimmed back
   afterwards, but it never was, so it's still live. flagging it here.

 * only applies to tickets obviously. services and requests are out of
   scope for this one, they have their own automation.

thanks
-- SD Ops`,
  },
];

export const templatesById = Object.fromEntries(templates.map((t) => [t.id, t]));
