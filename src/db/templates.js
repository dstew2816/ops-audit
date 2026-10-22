// Process documentation for five of the seven ASOPs, as it actually exists
// inside the organisation: written by the people who run the process, for other
// people who already know how it works.
//
// They feed src/engine/generate-sql.js, which has to resolve which ASOP a
// document is about before it can write anything.
//
// THE HARD RULE
//
// A template never names its table, never names a column, and never names its
// ASOP id. It does not reproduce the ASOP's registered name either, because the
// resolver is handed the roster of names and matching one verbatim would be a
// string comparison rather than an act of comprehension.
//
// So resolution has to come from what the document is ABOUT. A document
// discussing units that will not release resolves to ports; one
// discussing holds nobody has put a department against resolves to holds. If
// the table were named, the demo would prove nothing.
//
// `asopId` below is ground truth for scoring and is NEVER passed to a model.
// The prompt builders in generate-sql.js take `text` and nothing else.
//
// WHAT MAKES THEM HARD
//
// Each carries two or three of: two languages interleaved mid-document, a
// superseded value left inline beside the current one, a threshold stated twice
// in different units, a scoping rule or exclusion buried in a parenthetical, a
// forwarded email thread as the only documentation, a reference to a screenshot
// that was never attached, and ownership transferred twice and gone stale.
//
// THE SPONSOR TRAP
//
// Stage 1 gets each ASOP's sponsor and department. Two sponsors own two ASOPs
// each — p.varghese has both the maintenance and the QC one, r.lindqvist
// both the logistics and the notification one — so a sponsor never resolves a
// document on its own. TPL-HOLD-DEPT goes further and names p.varghese in a
// stale ownership line, which pulls towards the wrong pair entirely. Matching
// on the owner line is supposed to fail.
//
// FIDELITY
//
// Every rule these documents state corresponds to something in that ASOP's
// baseline in src/db/baselines.js. A scoping rule written into prose here that
// the baseline does not apply would make correct extraction score as wrong.
// When you edit a template, check the baseline still says the same thing.
//
// BYPASSES ARE WRITTEN THE WAY REAL DOCS WRITE THEM
//
// "We don't restart a port that's in maintenance mode." That is suppression
// language, because in the automation a bypass genuinely does suppress. The
// audit layer has to invert it and report the candidate anyway with the reason
// attributed. See the note on that inversion in src/engine/generate-sql.js —
// the templates deliberately do not pre-chew it.

export const sqlTemplates = [
  // ==========================================================================
  {
    id: 'TPL-PORT-BLOCKED',
    label: 'Wiki — ロードポート開放不良 / port will not release (JA/EN)',
    asopId: 'ASOP-114',
    note: 'Ops Automation wiki page. Written in Japanese, patched in English by whoever was on shift.',
    defects: [
      'two languages interleaved mid-document',
      'superseded threshold left inline with a change note',
      'ownership transferred twice, current line stale',
    ],
    text: `ロードポート開放不良 / load position will not release
================================================================
版数: v4.1 (2026-04-18 更新)
担当: Ops Automation 自動化チーム
  ※ 元々は装置エンジニアリング → 2025-09 に搬送グループ → 2026-02 から現行
  (ownership has moved twice, the distribution list has not been updated —
   if the page is wrong, ask in #ops-auto rather than the old alias)

概要 / what this covers
-----------------------
ロードポートがキャリアを載せたまま解放されず、ブロック状態から
戻ってこないことがある。搬送側は次のロットを流そうとして待ち続けるので、
放置すると装置一台分のスループットが丸ごと止まる。

The automation watches for a load position that has gone into the blocked
condition and stayed there. It is the sitting-still that matters, not how the
port got there — a port that bounces in and out of blocked in under a minute is
normal handshake behaviour and nobody wants a ticket for it.

判定条件 / when it fires
------------------------
  ・ポートがブロック状態に入る
  ・そのまま **30分** を超えて滞留した場合に起動する
    (旧しきい値は45分。2026-04の見直しで30分に短縮。
     Confluence の古いページにはまだ45と書いてあるので注意)
  ・キャリアの有無は問わない。空でもブロックはブロック。

解析期間の終わりの時点でまだブロックが続いているポートについて:
そのまま「継続中」として期間の終わりまでを滞留時間として数える。
An interval that has not closed yet is measured up to the end of the period
under review. It still counts.

やらないこと / what it does not do
----------------------------------
メンテナンスモードに切り替わっているポートには何もしない。
技術者が作業中のポートを自動で触ると危険なため。
(we do not act on a port the techs have switched to maintenance mode — the
block is real, we just aren't the ones who should be clearing it)

エラーで落ちているポートはこのページの対象外。別運用。
A port that has faulted out into an error condition is somebody else's page —
different response, much shorter fuse, do not fold the two together.

備考
----
INC-8823 のときは18本のキャリアが3時間止まった。あれ以降しきい値を下げた。`,
  },

  // ==========================================================================
  {
    id: 'TPL-PORT-ERROR',
    label: 'FW: RE: RE: port faults — nobody owns these?',
    asopId: 'ASOP-118',
    note: 'Never written up. This forwarded thread is the whole of the documentation.',
    defects: [
      'a forwarded email thread is the only documentation',
      'the threshold stated twice, in different units',
    ],
    text: `FW: RE: RE: port faults -- nobody owns these?

Forwarding for the record since this keeps coming up and the answer is buried
in a thread from March. Someone please put it on the wiki. -- m.o.

> > > From: Equipment Engineering
> > > Subject: RE: RE: port faults -- nobody owns these?
> > >
> > > Right, to close this out. There are two separate things happening on the
> > > load positions and people keep conflating them.
> > >
> > > One is a position that just sits there refusing to hand the unit back.
> > > That has its own page, half an hour of patience before anything happens,
> > > not what this thread is about.
> > >
> > > The other one is a hard fault. The position drops into the error
> > > condition and stops responding to the handler entirely. That is what we
> > > are escalating on, and the fuse is much shorter -- a quarter of an hour
> > > and it goes to the area tech, paged, not a ticket.
> > >
> > > > From: Ops Automation
> > > > Subject: RE: port faults -- nobody owns these?
> > > >
> > > > Confirming the number for the automation config: 15 min in the faulted
> > > > condition and it escalates. Not 30, that's the other one. We have been
> > > > round this twice now.
> > > >
> > > > It does not matter whether there is a unit sitting on the position
> > > > or not. A faulted position is faulted.
> > > >
> > > > One carve-out, same as the other page: if the position has been put
> > > > into maintenance mode then we stay out of it. The tech owns it at that
> > > > point and an automated escalation on top of somebody already working
> > > > the problem just adds noise.
> > > >
> > > > > From: Shift Lead
> > > > > Subject: port faults -- nobody owns these?
> > > > >
> > > > > Had a position faulted from 02:10 to 04:40 last night and nothing
> > > > > escalated. Two and a half hours. Who owns this? Is there even an
> > > > > automation for it or have we been assuming?
> > > > >
> > > > > Also if a position is still faulted when you run the numbers at the
> > > > > end of the month, please count it. Last time it got dropped from the
> > > > > report because it "hadn't finished yet", which is backwards -- the
> > > > > ones that never recover are the bad ones.`,
  },

  // ==========================================================================
  {
    id: 'TPL-HOLD-DEPT',
    label: 'Holds with nobody\'s name on them (quality wiki stub)',
    asopId: 'ASOP-341',
    note: 'Stub page. Half of it points at an attachment that was never uploaded.',
    defects: [
      'a referenced screenshot that does not exist',
      'the exclusion written as prose in a parenthetical',
      'ownership transferred twice, and the stale line names the wrong person',
    ],
    text: `Holds with nobody's name on them
================================

Owner: p.varghese
  (page was q-systems, then a.ferreira when the quality group took the sweep
  over, then handed to p.varghese in the 2026-01 reshuffle. The reshuffle was
  partly reversed in March and nobody has fixed this line. If in doubt, whoever
  is running the quality queue this quarter owns it.)

The problem
-----------
When a hold is raised, whoever raises it is supposed to put their department
against it so the disposition queue knows who has to sign it off. A hold with
nothing in that field goes into no queue at all. It does not age out, it does
not escalate, it does not appear on anyone's morning list — it just sits on the
batch, silently, until somebody notices the batch has not moved in a week.

See the attached screenshot (holds_no_dept_example.png) for what this looks
like in the disposition view.

  [!] the attachment is not on this page. It was in the original email and did
      not survive the wiki import. Nobody has re-uploaded it.

What the sweep does
-------------------
It walks the holds and picks up every one with an empty owner department, then
raises a backfill request against the batch so somebody has to claim it.

**There is no time element to this at all.** This is the part people get wrong
when they re-implement it. A hold raised four seconds ago with no department is
exactly as broken as one raised three weeks ago with no department — the defect
is the missing owner, not the waiting. The sweep does not care when the hold was
placed, does not care whether it has since been released, and has no threshold,
no grace period and no window. Every hold on the books is looked at, every time.

(The dates are on the report because the disposition team asked for them as
context when they are chasing one down. They are not part of the test. Do not
add a date filter to this. It has been added by mistake twice.)

Not us
------
(Holds raised by engineering are left alone — engineering runs its own backfill
off the ECN queue and gets to them first, so the sweep firing as well produces
two requests for the same hold and the second one gets closed as a duplicate,
which is how we ended up leaving them out in the first place. Every other kind
of hold is in scope: quality, material and customer holds are all swept.)`,
  },

  // ==========================================================================
  {
    id: 'TPL-CHECK-SWEEP',
    label: 'Quality Control — checks that never ran (SOP-0402 rev C)',
    asopId: 'ASOP-402',
    note: 'Has a real scoping rule in it: the sweep does not cover the pilot line.',
    defects: [
      'the grace period stated twice, in different units',
      'a superseded value left inline with a change note',
      'a business scoping rule written as prose, and the exclusion in a parenthetical',
    ],
    text: `SOP-0402 rev C — checks that never ran
QC systems / sponsor: p.varghese
Supersedes rev B (2025-11). Rev C is the one in force.

PURPOSE
-------
Every tool on the floor has recurring checks booked against it — some hourly,
some daily, some weekly. The booking system knows when each one came due. What
it does not do is tell anyone when one did not happen. A check that is simply
never performed leaves no record of itself, because the only record the system
writes is the one that gets written when somebody performs it.

This sweep reconstructs the ones that came due and never happened.

CONDITION
---------
A check qualifies when:

  a) it came due at some point inside the period being reviewed, AND
  b) it was never carried out, AND
  c) it has been overdue by more than the grace period.

On (a): a check booked for next Tuesday has obviously not been done yet and is
not a defect. Only the ones whose due time has already passed are in scope.

On (c): the grace period is half an hour. This is to stop the report filling up
with checks that are twenty minutes late and are about to be done anyway.

  Rev B had this at 60 minutes. Rev C halved it to 30 min after the audit found
  we were losing a whole shift's worth of misses in the gap. Some of the older
  dashboards still have 60 hard-coded in them — those are wrong and are being
  migrated.

SCOPE
-----
The sweep covers the production bays only, which is tools T-01 through T-22.

The two pilot-line tools are not swept by us. They sit under the vendor's
service contract for the duration of the pilot and the vendor's own field
system books and chases their checks — if we swept them too we would be raising
findings against a queue we do not control. Revisit when the pilot converts.

(Where a reason has been recorded against a check explaining why it was not
carried out — tool was in a PM window, no operator on shift, superseded by a
manual check, deferred by the area lead — the sweep does not chase it. The
reason is taken as sufficient and it goes no further.)

CONTACT
-------
QC systems, or the area lead for the bay in question.`,
  },

  // ==========================================================================
  {
    id: 'TPL-QUEUE-DEADLINE',
    label: 'Aviso de plazo de cola / batches about to run late (ES/EN)',
    asopId: 'ASOP-207',
    note: 'Logistics runbook. Spanish original, English patched in by the night shift.',
    defects: [
      'two languages interleaved mid-document',
      'the threshold stated twice, in different units',
      'the terminal states buried in a parenthetical',
    ],
    text: `Aviso de plazo de cola — lotes que van a llegar tarde
=====================================================
Logística de planta · r.lindqvist · v2

QUÉ ES ESTO / what this is
--------------------------
Cada paso de un lote lleva asociado un compromiso de entrega: la hora a la que
ese lote tiene que haber salido de la cola hacia el siguiente grupo de equipos.
No es un tiempo transcurrido. Es una cuenta atrás contra una hora fija.

This is the bit people get wrong when they rebuild it. Nobody cares how long the
batch has been sitting in the queue. What matters is how much time is LEFT
before the commitment it was given, and that number goes negative — a batch that
blew its commitment forty minutes ago has minus forty minutes left, and it is
still the thing we want to know about.

CUÁNDO AVISA / when it warns
----------------------------
Se avisa cuando a un lote le queda menos de una hora contra el compromiso de su
paso actual.

  --> threshold is 60 minutes remaining. Less than that and it warns.

Un lote se mueve por varios pasos y va generando eventos por el camino. Lo que
cuenta es dónde está AHORA: hay que mirar el último evento registrado para ese
lote en ese paso, y calcular desde ahí. Los eventos anteriores son historia y no
se evalúan otra vez.

Take the most recent event for the batch at that step and measure from it. The
earlier ones are history — a batch that was two hours out at its first event and
is now ten minutes out gets one warning, not two.

(Solo se avisa de lotes que siguen en movimiento, es decir los que están en cola
o ya en tránsito hacia el siguiente grupo. Si un lote ya ha sido marcado como en
riesgo, o ya consta como vencido, la plataforma ya lo sabe y ya está en el
tablero de excepciones — avisar otra vez no aporta nada y satura el canal, así
que esos dos casos no se avisan por muy pasados de plazo que estén.)

NOTAS
-----
No hay lista de exenciones en este aviso. Todos los lotes cuentan.
There is no carve-out on this one. Every batch counts.

El grupo de destino se incluye en el aviso para que el turno sepa a quién
llamar. No influye en la condición.`,
  },
];
