"""The hand-written baseline: a branching keyword classifier, the way a person who
knows the work would write one first. FROZEN: written before any model was trained
and never adjusted after seeing results, so the comparison with the learned tree is
fair. It does not import the taxonomy.

It works in two steps, like the taxonomy:

  STEP 1, what kind of check is it?  Cues are checked in a fixed order
          (countdown, then absent, then missing, then count, then state, and
          otherwise it is an interval).
  STEP 2, which specific thing?      Inside each kind, ordered keyword rules.

Two versions score on the same held-out set:

  rules_en     English keywords only. This is what hand-written rules usually are.
  rules_multi  The same rules, using the multilingual keyword lists the model's
               features use. This separates "how the decisions are made" from
               "which languages the keywords cover".

Both run on the canonicalised record (schema already mapped), so neither is
disadvantaged by the messy field names.
"""

from __future__ import annotations

import re

from features import has

_EN = {
    "countdown": r"remaining|expire|expiry|about to|coming due|due soon|upcoming",
    "absent": r"never ran|not run|no record|not performed|not logged|never logged|no run",
    "blank": r"blank|empty|\bnull\b|missing|without|no owner",
    "retry": r"retr|attempt|tries",
    "repeat": r"repeat|storm|times",
    "fail": r"\bfail|autoload",
    "flag": r"flag|bypass|skip|toggle|override",
    "manual": r"manual",
    "ack": r"\back|acknowledg",
    "alarm": r"alarm",
    "hold": r"\bhold",
    "pm": r"\bpm\b|maintenance|preventive",
    "owner": r"owner|department|\bdept",
    "reason": r"reason",
    "product": r"product|recipe",
    "contact": r"contact|phone|email",
    "disposition": r"disposition|decision",
    "oos": r"\boos\b|out of spec|out-of-spec",
    "ooc": r"\booc\b|out of control|out-of-control",
    "calibration": r"calib",
    "clean": r"\bclean",
    "handoff": r"hand-?off|port change|change time",
    "trackout": r"track-?out|last step|step end|step_end",
    "queue": r"queue|q-time|qtime",
    "status": r"status",
    "update": r"update|message",
    "blocked": r"block",
    "error": r"\berror|fault",
    "idle": r"\bidle",
    "down": r"\bdown",
    "notification": r"notif|message",
    "check": r"\bcheck\b|inspection",
    "elapsed": r"since|elapsed|\bage\b|too long|exceed|older|longer",
}
_EN_COMPILED = {k: re.compile(v, re.IGNORECASE) for k, v in _EN.items()}


def _en(concept: str, text: str) -> bool:
    return bool(_EN_COMPILED[concept].search(text))


def _multi(concept: str, text: str) -> bool:
    return bool(has(concept, text))


def _predict(canon: dict, kw) -> tuple[str, str]:
    text = " ".join(str(canon[k] or "") for k in ("name", "description", "field", "condition")).lower()

    # STEP 1: the kind of check -------------------------------------------------
    if kw("countdown", text):
        kind = "countdown"
    elif kw("absent", text):
        kind = "absent"
    elif kw("blank", text) or re.search(r"is null|= ''", text):
        kind = "missing"
    elif kw("retry", text) or kw("repeat", text) or kw("fail", text):
        kind = "count"
    elif kw("flag", text) or kw("manual", text) or kw("ack", text):
        kind = "state"
    else:
        kind = "interval"

    # STEP 2: the specific thing, within the kind -----------------------------
    if kind == "countdown":
        leaf = (
            "calibration_expiring" if kw("calibration", text)
            else "pm_due_soon" if kw("pm", text)
            else "qtime_expiring"
        )
    elif kind == "absent":
        leaf = (
            "pm_not_done" if kw("pm", text)
            else "track_out_not_logged" if kw("trackout", text)
            else "check_not_run"
        )
    elif kind == "missing":
        leaf = (
            "oos_missing_disposition" if kw("oos", text) or kw("disposition", text)
            else "contact_missing" if kw("contact", text)
            else "lot_missing_product" if kw("product", text)
            else "downtime_missing_reason" if kw("reason", text)
            else "hold_missing_owner"
        )
    elif kind == "count":
        leaf = (
            "autoload_failures" if kw("fail", text)
            else "repeat_alarms" if kw("alarm", text) or kw("repeat", text)
            else "notification_retries"
        )
    elif kind == "state":
        leaf = (
            "alarm_unacknowledged" if kw("ack", text) or kw("alarm", text)
            else "hold_not_cleared" if kw("hold", text)
            else "maintenance_flag_stuck" if kw("pm", text)
            else "port_manual_mode" if kw("manual", text)
            else "bypass_flag_left_on"
        )
    else:
        leaf = (
            "ooc_unaddressed" if kw("ooc", text)
            else "oos_unaddressed" if kw("oos", text)
            else "time_since_calibration" if kw("calibration", text)
            else "time_since_clean" if kw("clean", text)
            else "time_since_pm" if kw("pm", text)
            else "hold_age" if kw("hold", text)
            else "handoff_delay" if kw("handoff", text)
            else "time_since_track_out" if kw("trackout", text)
            else "queue_time_elapsed" if kw("queue", text)
            else "status_feed_gap" if kw("status", text) and kw("update", text)
            else "error_dwell" if kw("error", text)
            else "idle_wait" if kw("idle", text)
            else "unscheduled_downtime" if kw("down", text)
            else "blocked_dwell"
        )
    return kind, leaf


def rules_en(canon: dict) -> tuple[str, str]:
    return _predict(canon, _en)


def rules_multi(canon: dict) -> tuple[str, str]:
    return _predict(canon, _multi)


RULE_TEXT = [
    "STEP 1: what kind of check?  (first match wins)",
    "  mentions remaining / expire / about to / coming due     -> countdown",
    "  mentions never ran / no record / not performed / not logged -> absent",
    "  mentions blank / empty / null / missing / without       -> missing",
    "  mentions retry / attempts / repeat / fail               -> count",
    "  mentions flag / bypass / manual / ack                   -> state",
    "  otherwise                                               -> interval",
    "STEP 2: which specific thing?  (inside the kind, first match wins)",
    "  countdown: calibration -> calibration expiring | PM -> PM due soon | else queue time expiring",
    "  absent:    PM -> PM not done | track-out -> track-out not logged | else check not run",
    "  missing:   OOS/disposition | contact | product/recipe | reason | else hold owner",
    "  count:     fail/autoload | alarm/repeat | else notification retries",
    "  state:     ack/alarm | hold | PM | manual | else bypass left on",
    "  interval:  OOC | OOS | calibration | clean | PM | hold | handoff | track-out | queue",
    "             | status + update | error | idle | down | else blocked too long",
]
