"""Generate synthetic, deliberately messy procedure definitions with known labels.

Task: given a procedure definition as it might be exported from several different
teams' tools, say (1) what KIND of check it is and (2) which SPECIFIC thing it
watches. The two-level taxonomy is in taxonomy.py (6 kinds, 33 specifics).

The label is chosen FIRST and the record is then written from it, so the label is
known exactly. What makes it a real problem is how the record is written:

  - field names differ between records (`threshold`, `thr`, `alert_after`, ...)
  - fields are missing at random
  - thresholds come in mixed units ("45m", "2 hrs", "3 Tage"), counts ("4 attempts")
    or with no unit; checks that have no natural threshold sometimes carry a small
    grace time anyway
  - names and descriptions are in English, German, Spanish or Japanese, and some
    mix languages
  - some records are nearly uninformative (generic title, vague description)
  - some descriptions mention a DIFFERENT check only to rule it out, which fools
    keyword rules
  - the condition field is written the way people write conditions, in several
    styles, and is sometimes missing or vague

This is synthetic: results measure how well a method handles THIS generator, not
real documentation. Deterministic for a given seed.

    python ml/generate_data.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from taxonomy import LEAVES

SEED = 20260801
PER_LEAF = 50

# --- messiness knobs ---------------------------------------------------------
P_MISSING = 0.12
P_WEAK = 0.22
P_NEGATED_DISTRACTOR = 0.14
P_GENERIC_FIELD = 0.25
P_NO_UNIT = 0.10
P_STRAY_THRESHOLD = 0.10
P_COND_MISSING = 0.22
P_COND_VAGUE = 0.08
# Thresholds must not give the label away. Each drawn value gets multiplicative
# noise, and sometimes comes from an unrelated range entirely, so a number alone
# is weak evidence and the model has to read the text and structure.
THRESHOLD_JITTER = 0.45
P_THRESHOLD_ANY = 0.15

LANGS = ["en"] * 62 + ["de"] * 14 + ["es"] * 10 + ["ja"] * 9 + ["mix"] * 5

WEAK_NAMES = ["Auto-escalation rule", "Timer check", "Threshold alert", "Monitoring rule", "Check #{n}", "Rule {n}", "Alert"]
WEAK_DESCS = [
    "Escalates when the limit is exceeded.",
    "See wiki page.",
    "Standard alert.",
    "Notify owner if over threshold.",
    "TBD",
    "Migrated from old system, behaviour unchanged.",
]
VAGUE_CONDS = ["see config", "per SOP", "standard rule", "TBD", "n/a"]
NEGATION_TEMPLATES = ["Not the same as {x}.", "Unlike {x}, this one does not look at that.", "Do not confuse with {x}.", "Separate from {x}."]

ENTITY_SPELLINGS = {
    "port": ["port", "PORT_TBL", "Port", "load_port"],
    "tool": ["tool", "TOOL_MASTER", "Tool", "asset"],
    "equipment": ["equipment", "EQP", "equip"],
    "chamber": ["chamber", "CHMBR", "Chamber"],
    "gauge": ["gauge", "metrology_tool", "Gauge"],
    "carrier": ["carrier", "CARRIER_TBL", "Carrier"],
    "batch": ["batch", "BATCH_HDR", "lot", "Batch"],
    "hold": ["hold", "HOLD_REC", "holds"],
    "alarm": ["alarm", "ALM_LOG", "alarms"],
    "group": ["group", "ESC_GROUP", "recipient_group"],
    "notification": ["notification", "NOTIF_Q", "email_queue"],
    "message": ["message", "MSG_Q", "Message"],
    "check": ["check", "SCHED_CHECK", "inspection"],
    "result": ["result", "MEAS_RESULT", "measurement"],
}
GENERIC_FIELDS = ["ts", "timestamp", "time_col", "TS1", "date_field", "t0", "value", "flag"]

KEYS = {
    "id": ["id", "proc_id", "ID"],
    "name": ["name", "title", "proc_name", "Name"],
    "description": ["description", "desc", "details", "notes_text"],
    "entity": ["entity", "table", "target", "object"],
    "field": ["trigger_field", "timestamp_col", "watch_field", "field"],
    "threshold": ["threshold", "thr", "limit", "alert_after"],
    "condition": ["condition", "rule", "expr", "criteria"],
    "owner": ["owner", "team", "dept"],
}
OWNERS = ["Ops Automation", "Quality Control", "Logistics", "Maintenance", "Planning", None]

UNIT_FORMS = {
    "m": {"en": ["m", "min", "mins", "minutes"], "de": ["Min.", "Minuten"], "es": ["min", "minutos"], "ja": ["分"]},
    "h": {"en": ["h", "hr", "hrs", "hours"], "de": ["Std.", "Stunden"], "es": ["h", "horas"], "ja": ["時間"]},
    "d": {"en": ["d", "days"], "de": ["Tage", "d"], "es": ["días", "d"], "ja": ["日"]},
}
COUNT_FORMS = {"attempts": ["attempts", "tries", "x"], "alarms": ["alarms", "times", "x"], "failures": ["failures", "fails", "x"]}


def draw_range(rng: random.Random, lo: float, hi: float) -> float:
    return lo * (hi / lo) ** rng.random()


def format_minutes(rng: random.Random, minutes: float, lang: str):
    """Write a duration the way a person might. Returns text or a bare number."""
    if rng.random() < P_NO_UNIT:
        if minutes >= 1440:
            return round(minutes / 1440, 1)
        if minutes >= 120:
            return round(minutes / 60, 1)
        return round(minutes)
    if minutes >= 2880:
        unit, value = "d", minutes / 1440
    elif minutes >= 180:
        unit, value = "h", minutes / 60
    else:
        unit, value = "m", minutes
    forms = UNIT_FORMS[unit].get(lang if lang in UNIT_FORMS[unit] else "en")
    value_text = f"{value:.0f}" if value >= 10 else f"{value:.1f}".rstrip("0").rstrip(".")
    return f"{value_text}{rng.choice(['', ' '])}{rng.choice(forms)}"


def format_threshold(rng: random.Random, leaf: dict, lang: str):
    spec = leaf["threshold"]
    if spec is None:
        if rng.random() < P_STRAY_THRESHOLD:
            return format_minutes(rng, draw_range(rng, 5, 30), "en" if lang == "mix" else lang)
        return None
    lo, hi, unit = spec
    if unit == "min":
        if rng.random() < P_THRESHOLD_ANY:
            minutes = draw_range(rng, 5, 20160)
        else:
            minutes = draw_range(rng, lo, hi) * rng.lognormvariate(0, THRESHOLD_JITTER)
        return format_minutes(rng, max(minutes, 2), "en" if lang == "mix" else lang)
    value = round(draw_range(rng, lo, hi))
    if rng.random() < P_NO_UNIT:
        return value
    return f"{value} {rng.choice(COUNT_FORMS[unit])}"


def build_record(rng: random.Random, leaf: dict, index: int) -> dict:
    lang = rng.choice(LANGS)
    weak = rng.random() < P_WEAK
    key = {field: rng.choice(options) for field, options in KEYS.items()}

    def pick(which: str, language: str) -> str:
        if language == "en":
            return rng.choice(leaf[which])
        return leaf[language][0 if which == "name" else 1]

    if weak:
        name = rng.choice(WEAK_NAMES).format(n=rng.randint(10, 99))
        description = rng.choice(WEAK_DESCS)
    else:
        name_lang = rng.choice(["en", "de", "es", "ja"]) if lang == "mix" else lang
        desc_lang = rng.choice(["en", "de", "es", "ja"]) if lang == "mix" else lang
        name = pick("name", name_lang)
        description = pick("desc", desc_lang)
        if rng.random() < P_NEGATED_DISTRACTOR:
            other = rng.choice([x for x in LEAVES if x["id"] != leaf["id"]])
            description += " " + rng.choice(NEGATION_TEMPLATES).format(x=other["about"])

    entity_kind = leaf["entities"][0] if rng.random() < 0.7 else rng.choice(leaf["entities"])
    entity = rng.choice(ENTITY_SPELLINGS[entity_kind])
    field = rng.choice(GENERIC_FIELDS) if rng.random() < P_GENERIC_FIELD else rng.choice(leaf["fields"])
    threshold = format_threshold(rng, leaf, lang)

    roll = rng.random()
    if weak and roll < 0.5:
        condition = None
    elif roll < P_COND_MISSING:
        condition = None
    elif roll < P_COND_MISSING + P_COND_VAGUE:
        condition = rng.choice(VAGUE_CONDS)
    else:
        condition = rng.choice(leaf["conds"])

    record = {key["id"]: f"PRC-{1000 + index}"}
    optional = {
        key["name"]: name,
        key["description"]: description,
        key["entity"]: entity,
        key["field"]: field,
        key["threshold"]: threshold,
        key["condition"]: condition,
        key["owner"]: rng.choice(OWNERS),
    }
    for k, v in optional.items():
        if v is not None and rng.random() >= P_MISSING:
            record[k] = v
    if key["name"] not in record and key["description"] not in record:
        record[key["name"]] = name
    return {"label": leaf["id"], "kind": leaf["kind"], "lang": lang, "weak": weak, "record": record}


def main() -> None:
    rng = random.Random(SEED)
    rows = []
    for leaf in LEAVES:
        for i in range(PER_LEAF):
            rows.append(build_record(rng, leaf, len(rows)))
    rng.shuffle(rows)
    out = Path(__file__).parent / "data" / "procedures.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    weak = sum(r["weak"] for r in rows)
    print(f"wrote {len(rows)} records ({len(LEAVES)} specifics, 6 kinds) to {out}; {weak} weak, {len(rows) - weak} informative")


if __name__ == "__main__":
    main()
