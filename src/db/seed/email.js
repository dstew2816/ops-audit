// email_queue — DETECTION SHAPE: retry chain.
//
// 90 notification messages. Qualification is a counter, not a clock:
//
//   WHERE attempts > 3 AND acked_at IS NULL
//
// Two traps sit either side of that condition. A message that took six
// attempts and was finally acknowledged is not a defect, however ugly the
// chain looks. A message that was never sent at all still is.

import {
  DAY, HOUR, MIN, SEEDS, WINDOW_START,
  between, iso, lcg, overlapsOutage, pick,
} from './common.js';

const rand = lcg(SEEDS.email);

/** Retry ceiling ASOP-455 is configured with. */
export const ATTEMPT_CEILING = 3;

const RECIPIENT_GROUPS = [
  'ops-automation',
  'area-leads',
  'quality-eng',
  'logistics',
  'maintenance',
  'shift-supervisors',
];

const BOUNCE_CODES = ['550', '421', '451', 'timeout', 'tls-handshake'];

// ---------------------------------------------------------------------------
// The interesting messages, keyed by roster position.
//
//   attempts > 3, no ack   candidate
//   attempts > 3, acked    long chain that succeeded in the end — not a defect
//   attempts <= 3, no ack  under the ceiling — not a defect yet
// ---------------------------------------------------------------------------

const SPECIAL_MESSAGES = {
  2: { attempts: 6, acked: false, handled: true, bounce: '421' },
  7: { attempts: 5, acked: false, handled: true, bounce: 'timeout' },
  12: { attempts: 9, acked: false, handled: false, pinAt: '2026-07-29T02:05:00Z', bounce: '550' },
  16: { attempts: 4, acked: false, handled: true, bounce: '451' },
  21: { attempts: 7, acked: false, handled: true, bounce: 'tls-handshake' },
  26: { attempts: 5, acked: false, handled: false, bounce: '550' },
  30: { attempts: 8, acked: false, handled: true, bounce: '421', neverSent: true },
  37: { attempts: 4, acked: false, handled: true, bounce: 'timeout' },
  42: { attempts: 11, acked: false, handled: false, pinAt: '2026-07-29T03:55:00Z', bounce: '550' },
  48: { attempts: 6, acked: false, handled: true, bounce: '451' },
  55: { attempts: 5, acked: false, handled: true, bounce: '421' },
  61: { attempts: 4, acked: false, handled: false, bounce: 'timeout' },
  68: { attempts: 7, acked: false, handled: true, bounce: '550', neverSent: true },
  74: { attempts: 6, acked: false, handled: true, bounce: 'tls-handshake' },

  // Long chains that eventually got through. Not defects.
  33: { attempts: 6, acked: true, bounce: '421' },
  57: { attempts: 5, acked: true, bounce: 'timeout' },
  81: { attempts: 8, acked: true, bounce: '451' },

  // Under the ceiling and unacknowledged. Not defects yet.
  9: { attempts: 2, acked: false, bounce: null },
  44: { attempts: 3, acked: false, bounce: null },
  86: { attempts: 3, acked: false, bounce: 'timeout' },
};

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

const rows = [];
const candidates = [];

for (let i = 0; i < 90; i += 1) {
  const messageId = `M-${String(i + 1).padStart(4, '0')}`;
  const special = SPECIAL_MESSAGES[i];
  const recipientGroup = pick(rand, RECIPIENT_GROUPS);

  const queuedAt = special?.pinAt
    ? Date.parse(special.pinAt)
    : WINDOW_START +
      between(rand, 0, 13) * DAY +
      between(rand, 0, 23) * HOUR +
      between(rand, 0, 59) * MIN;

  const attempts = special?.attempts ?? (rand() < 0.85 ? 1 : 2);
  const acked = special ? special.acked : true;

  // Each attempt backs off a little further.
  const chainMinutes = attempts * between(rand, 4, 18);
  const sentAt = special?.neverSent ? null : queuedAt + chainMinutes * MIN;
  const ackedAt = acked && sentAt !== null ? sentAt + between(rand, 1, 40) * MIN : null;

  const bounceCode =
    special !== undefined
      ? special.bounce
      : attempts > 1
        ? pick(rand, BOUNCE_CODES)
        : null;

  rows.push({
    message_id: messageId,
    recipient_group: recipientGroup,
    queued_at: iso(queuedAt),
    sent_at: sentAt === null ? null : iso(sentAt),
    acked_at: ackedAt === null ? null : iso(ackedAt),
    attempts,
    bounce_code: bounceCode,
  });

  if (attempts <= ATTEMPT_CEILING || ackedAt !== null) continue;

  const exhaustedAt = queuedAt + chainMinutes * MIN;
  candidates.push({
    table: 'email_queue',
    asopId: 'ASOP-455',
    handled: special?.handled === true,
    payload: {
      message_id: messageId,
      recipient_group: recipientGroup,
      attempts,
    },
    // The chain passed the ceiling partway through; that is when it became
    // actionable, not when the message was first queued.
    actionableAt: exhaustedAt,
    intervalStart: queuedAt,
    intervalEnd: exhaustedAt,
    insideOutage: overlapsOutage(queuedAt, exhaustedAt),
  });
}

export const emailQueue = rows;
export const emailCandidates = candidates;
