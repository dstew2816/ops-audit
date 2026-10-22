"""Turn a messy procedure record into explainable features.

Two steps, kept separate on purpose:

1. canonicalize(): map each team's field names onto one schema (name,
   description, entity, field, threshold, condition, owner). This is data cleaning,
   and both the model and the hand-written rules go through it, so neither gets an
   advantage from it.
2. featurize(): turn the canonical record into numbers a decision tree can split
   on. Every feature has a plain-English meaning, so a learned tree reads as rules.

Keyword concepts are regular expressions in English, German, Spanish and Japanese,
written once and not tuned afterwards. This module does not import the taxonomy:
the answers stay out of the code being tested.
"""

from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd

# --- step 1: schema mapping --------------------------------------------------
ALIASES = {
    "name": {"name", "title", "proc_name"},
    "description": {"description", "desc", "details", "notes_text"},
    "entity": {"entity", "table", "target", "object"},
    "field": {"trigger_field", "timestamp_col", "watch_field", "field"},
    "threshold": {"threshold", "thr", "limit", "alert_after"},
    "condition": {"condition", "rule", "expr", "criteria"},
    "owner": {"owner", "team", "dept"},
}


def canonicalize(record: dict) -> dict:
    lowered = {k.lower(): v for k, v in record.items()}
    out = {}
    for canonical, names in ALIASES.items():
        out[canonical] = next((lowered[n] for n in names if lowered.get(n) is not None), None)
    return out


# --- threshold parsing -------------------------------------------------------
_TIME_UNITS = [
    (re.compile(r"^(m|min|mins|minutes?|minuten|minutos|分)\.?$"), 1),
    (re.compile(r"^(h|hr|hrs|hours?|std|stunden|horas?|時間)\.?$"), 60),
    (re.compile(r"^(d|days?|tage|días|dias|日)\.?$"), 1440),
]
_COUNT_UNITS = re.compile(r"^(attempts?|tries|alarms?|times|failures?|fails?|x)$")


def parse_threshold(raw):
    """Return (value, minutes_or_nan, kind) where kind is none | time | count | bare.

    A bare number has no unit, so nothing is assumed about it: `bare` is its own
    kind and the tree can learn how much to trust the number.
    """
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return float("nan"), float("nan"), "none"
    if isinstance(raw, (int, float)):
        return float(raw), float("nan"), "bare"
    match = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(.*?)\s*$", str(raw))
    if not match:
        return float("nan"), float("nan"), "none"
    value, unit = float(match.group(1)), match.group(2).lower()
    if not unit:
        return value, float("nan"), "bare"
    for pattern, factor in _TIME_UNITS:
        if pattern.match(unit):
            return value, value * factor, "time"
    if _COUNT_UNITS.match(unit):
        return value, float("nan"), "count"
    return value, float("nan"), "bare"


# --- step 2: concept keywords (regular expressions) ---------------------------
CONCEPTS = {
    # things
    "port": r"\bport\b|ladeport|puerto|ポート|load_port|port_tbl",
    "carrier": r"carrier|キャリア",
    "batch": r"\bbatch\b|\blot\b|charge|\blote\b|バッチ|ロット",
    "tool": r"\btool\b|equipment|\beqp\b|anlage|equipo|装置|asset|chamber|gauge",
    "hold": r"\bhold|sperre|retenci|ホールド|\bheld\b",
    "alarm": r"alarm|アラーム",
    "notification": r"notif|message|\bmsg\b|meldung|mensaje|通知|email_queue|recipient|escalation group|eskalationsgruppe|grupo de escalado|エスカレーション先",
    "check": r"\bcheck\b|inspection|prüfung|revisión|チェック|sched_check",
    # conditions of things
    "blocked": r"block|bloquead|blockiert|ブロック|閉塞",
    "error": r"\berror|fault|fehler|\bfalla|エラー",
    "idle": r"\bidle|leerlauf|inactiv|アイドル",
    "down": r"\bdown|ausfall|stillstand|\bparada|ダウン|停止",
    "clean": r"\bclean|reinig|limpieza|洗浄",
    "pm": r"\bpm\b|preventive|maintenance|wartung|mantenimiento|保全|work order",
    "calibration": r"calib|kalibr|校正|cal_|_cal\b|verified",
    "queue": r"queue|q-time|qtime|warte|\bcola\b|キュー|wait",
    "trackout": r"track-out|track_out|trackout|step end|step_end|last step|letzten schritt|último paso|前のステップ|step_out",
    "status": r"status|estado|ステータス",
    "update": r"update|\bupd\b|aktualisier|actualiz|更新|heartbeat|latido",
    "handoff": r"hand-?off|übergabe|entrega|受け渡し|change time|port change|arrived",
    "ooc": r"\booc\b|out of control|out-of-control|außer kontrolle|fuera de control|管理外",
    "oos": r"\boos\b|out of spec|out-of-spec|spec_fail|außerhalb der spez|fuera de especif|規格外",
    "manual": r"manual|handbetrieb|手動|\bmode\b",
    "flag": r"flag|toggle|bypass|skip|override|indicador|フラグ|\bflg\b|バイパス",
    "ack": r"\back|acknowledg|quitt|reconoc|確認",
    "retry": r"retr|attempt|tries|wiederhol|reintento|再送",
    "repeat": r"repeat|storm|mehrfach|repetid|多発|occurrence",
    "fail": r"\bfail|autoload|load error",
    "owner": r"owner|department|\bdept|owning|abteilung|responsable|担当",
    "reason": r"reason|motivo|grund|理由|\brc\b",
    "product": r"product|recipe|rezept|receta|part_number|製品",
    "contact": r"contact|phone|email|kontakt|連絡先",
    "disposition": r"disposition|decision|判定|entscheidung",
    # kind cues
    "elapsed": r"since|elapsed|\bage\b|older|aged|too long|exceed|seit|desde|経過|überschritten|excedido|超過|longer|\bdwell",
    "blank": r"blank|empty|\bnull\b|missing|no owner|without|kein|\bsin\b|ohne|未設定|未入力|nobody's name",
    "absent": r"never ran|not run|not perform|no record|not logged|no run|no event|nicht ausgef|nicht durch|no se realiz|未実施|未記録|sin registr|never logged",
    "countdown": r"remaining|expire|expiry|due soon|about to|coming due|upcoming|läuft|vencer|期限が迫|近い|time remaining|will expire|vence pronto|fällig",
    "negation": r"\bnot the same|unlike|do not confuse|separate from|does not look|not a ",
}
_COMPILED = {k: re.compile(v, re.IGNORECASE) for k, v in CONCEPTS.items()}


def has(concept: str, text: str) -> int:
    return int(bool(_COMPILED[concept].search(text or "")))


# --- condition-expression cues ------------------------------------------------
COND = {
    "isnull": re.compile(r"is null|= ''|=''|is empty|is blank|= \"\"", re.I),
    "flag_eq": re.compile(r"(=|==|!=)\s*'?(true|false|1|0|manual|auto|blocked|error|idle|down|queued)\b", re.I),
    "count_cmp": re.compile(r"(attempts?|count|retry_count|occurrences|fail\w*|alarm_count)\s*(>=|>)", re.I),
    "num_cmp": re.compile(r"(>=|>|<)\s*\d", re.I),
    "now_minus": re.compile(r"now\s*-|-\s*now|age\(|older|within|remaining\(", re.I),
    "lt_now": re.compile(r"<\s*now|due_at|due after|after due|no .*record", re.I),
    "time_word": re.compile(r"\b(min|minutes?|hours?|days?|h|d)\b|[0-9]+\s?(min|h|d)\b", re.I),
}


def featurize(canon: dict) -> dict:
    text = f"{canon['name'] or ''} {canon['description'] or ''}"
    field_text = f"{canon['field'] or ''}"
    entity_text = f"{canon['entity'] or ''}"
    cond = f"{canon['condition'] or ''}"
    value, minutes, kind = parse_threshold(canon["threshold"])

    features = {}
    for concept in CONCEPTS:
        features[f"text_{concept}"] = has(concept, text)
        if concept != "negation":
            features[f"field_{concept}"] = has(concept, field_text)
            features[f"cond_{concept}"] = has(concept, cond)
            features[f"entity_{concept}"] = has(concept, entity_text) if concept in ("port", "carrier", "batch", "tool", "hold", "alarm", "notification", "check") else 0
    for name, pattern in COND.items():
        features[f"cexpr_{name}"] = int(bool(pattern.search(cond)))
    features["cond_missing"] = int(canon["condition"] is None)
    features["cond_vague"] = int(bool(cond) and not any(p.search(cond) for p in COND.values()) and not any(has(c, cond) for c in CONCEPTS if c != "negation"))
    features["entity_missing"] = int(not entity_text)
    features["field_missing"] = int(not field_text)
    features["field_generic"] = int(bool(field_text) and not any(has(c, field_text) for c in CONCEPTS if c != "negation"))
    features["name_missing"] = int(canon["name"] is None)
    features["desc_missing"] = int(canon["description"] is None)
    features["text_length"] = len((text or "").strip())
    for k in ("none", "time", "count", "bare"):
        features[f"threshold_{k}"] = int(kind == k)
    features["log_threshold_min"] = 0.0 if math.isnan(minutes) else float(np.log1p(minutes))
    features["threshold_value"] = 0.0 if math.isnan(value) else float(min(value, 1000))
    return features


def build_frame(rows: list[dict]) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """rows are the JSONL objects. Returns (features, leaf labels, canonical records + metadata)."""
    canon = [canonicalize(r["record"]) for r in rows]
    X = pd.DataFrame([featurize(c) for c in canon])
    y = pd.Series([r["label"] for r in rows], name="label")
    info = pd.DataFrame(canon)
    info["kind"] = [r["kind"] for r in rows]
    info["lang"] = [r["lang"] for r in rows]
    info["weak"] = [r["weak"] for r in rows]
    info["id"] = [next(iter(r["record"].values())) for r in rows]
    return X, y, info
