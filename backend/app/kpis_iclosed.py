"""KPIs iClosed — calculés depuis ic_calls et ic_deals dans DuckDB."""
from typing import Optional

from . import cache
from .period_resolver import Period
from .kpis import _get_target, _status, _scale_target, _kpi_card


def _safe(val, default=None):
    if val is None:
        return default
    if hasattr(val, "item"):
        return val.item()
    return val


def _table_exists(name: str) -> bool:
    try:
        cache.query_one(f"SELECT COUNT(*) FROM {name}")
        return True
    except Exception:
        return False


# ─── KPI Cards ───────────────────────────────────────────────────────────────

def volume_calls(p: Period, comp: Period = None) -> dict:
    if not _table_exists("ic_calls"):
        return {"value": None, "status": "unknown"}
    val = _safe(cache.query_one(
        "SELECT COUNT(*) FROM ic_calls WHERE date BETWEEN ? AND ?",
        [p.start, p.end]
    ), 0)
    comp_val = None
    delta_pct = None
    if comp:
        comp_val = _safe(cache.query_one(
            "SELECT COUNT(*) FROM ic_calls WHERE date BETWEEN ? AND ?",
            [comp.start, comp.end]
        ), 0)
        if comp_val and comp_val > 0:
            delta_pct = round((val - comp_val) / comp_val * 100, 1)
    return {"value": val, "comparison_value": comp_val, "delta_pct": delta_pct, "status": "unknown"}


def no_show_rate(p: Period, comp: Period = None) -> dict:
    if not _table_exists("ic_calls"):
        return {"value": None, "status": "unknown"}
    row = cache.query("""
        SELECT
            COUNT(*) FILTER (WHERE outcome = 'NO_SHOW')::float
            / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) AS rate
        FROM ic_calls WHERE date BETWEEN ? AND ?
    """, [p.start, p.end])
    val = _safe(row.iloc[0]["rate"]) if not row.empty else None
    comp_val = None
    delta_pct = None
    if comp:
        row2 = cache.query("""
            SELECT
                COUNT(*) FILTER (WHERE outcome = 'NO_SHOW')::float
                / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) AS rate
            FROM ic_calls WHERE date BETWEEN ? AND ?
        """, [comp.start, comp.end])
        comp_val = _safe(row2.iloc[0]["rate"]) if not row2.empty else None
        if comp_val and comp_val > 0 and val is not None:
            delta_pct = round((val - comp_val) / comp_val * 100, 1)
    t = _get_target("no_show_rate")
    scaled_t, scaled_s = _scale_target(t, p)
    status = _status(val, scaled_t, scaled_s, t["sens"] if t else None)
    return {"value": val, "comparison_value": comp_val, "delta_pct": delta_pct, "status": status}


def closing_rate_net(p: Period, comp: Period = None) -> dict:
    """WON deals / shown calls (outcome != NO_SHOW and not null)."""
    if not _table_exists("ic_calls") or not _table_exists("ic_deals"):
        return {"value": None, "status": "unknown"}
    shown = _safe(cache.query_one(
        "SELECT COUNT(*) FROM ic_calls WHERE date BETWEEN ? AND ? AND outcome IS NOT NULL AND outcome != 'NO_SHOW'",
        [p.start, p.end]
    ), 0)
    won = _safe(cache.query_one(
        "SELECT COUNT(*) FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
        [p.start, p.end]
    ), 0)
    val = won / shown if shown else None

    comp_val = None
    delta_pct = None
    if comp:
        shown2 = _safe(cache.query_one(
            "SELECT COUNT(*) FROM ic_calls WHERE date BETWEEN ? AND ? AND outcome IS NOT NULL AND outcome != 'NO_SHOW'",
            [comp.start, comp.end]
        ), 0)
        won2 = _safe(cache.query_one(
            "SELECT COUNT(*) FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
            [comp.start, comp.end]
        ), 0)
        comp_val = won2 / shown2 if shown2 else None
        if comp_val and comp_val > 0 and val is not None:
            delta_pct = round((val - comp_val) / comp_val * 100, 1)

    t = _get_target("closing_rate_net")
    scaled_t, scaled_s = _scale_target(t, p)
    status = _status(val, scaled_t, scaled_s, t["sens"] if t else None)
    return {"value": val, "comparison_value": comp_val, "delta_pct": delta_pct, "status": status}


def revenue(p: Period, comp: Period = None) -> dict:
    if not _table_exists("ic_deals"):
        return {"value": None, "status": "unknown"}
    val = _safe(cache.query_one(
        "SELECT SUM(value) FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
        [p.start, p.end]
    ), 0)
    comp_val = None
    delta_pct = None
    if comp:
        comp_val = _safe(cache.query_one(
            "SELECT SUM(value) FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
            [comp.start, comp.end]
        ), 0)
        if comp_val and comp_val > 0:
            delta_pct = round((val - comp_val) / comp_val * 100, 1)
    status = "green" if val and val > 0 else "red"
    return {"value": val, "comparison_value": comp_val, "delta_pct": delta_pct, "status": status}


def acv(p: Period, comp: Period = None) -> dict:
    if not _table_exists("ic_deals"):
        return {"value": None, "status": "unknown"}
    row = cache.query(
        "SELECT AVG(value) AS acv FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
        [p.start, p.end]
    )
    val = _safe(row.iloc[0]["acv"]) if not row.empty else None
    comp_val = None
    delta_pct = None
    if comp:
        row2 = cache.query(
            "SELECT AVG(value) AS acv FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
            [comp.start, comp.end]
        )
        comp_val = _safe(row2.iloc[0]["acv"]) if not row2.empty else None
        if comp_val and comp_val > 0 and val is not None:
            delta_pct = round((val - comp_val) / comp_val * 100, 1)
    t = _get_target("acv")
    scaled_t, scaled_s = _scale_target(t, p)
    status = _status(val, scaled_t, scaled_s, t["sens"] if t else None)
    return {"value": val, "comparison_value": comp_val, "delta_pct": delta_pct, "status": status}


def _outcome_rate(outcome: str, p: Period) -> Optional[float]:
    """Helper SQL : COUNT(outcome=X) / COUNT(outcome IS NOT NULL) sur ic_calls."""
    row = cache.query(
        """
        SELECT COUNT(*) FILTER (WHERE outcome = ?)::float
             / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) AS rate
        FROM ic_calls WHERE date BETWEEN ? AND ?
        """,
        [outcome, p.start, p.end],
    )
    return _safe(row.iloc[0]["rate"]) if not row.empty else None


def _outcome_rate_card(indicateur: str, outcome: str, p: Period, comp: Period = None) -> dict:
    """Renvoie un payload KpiCard complet pour un taux iClosed basé sur outcome.

    Dénominateur = calls dont l'outcome a été renseigné (no-show inclus),
    cohérent avec la définition iClosed native.
    """
    if not _table_exists("ic_calls"):
        return _kpi_card(indicateur, None, None, p, fmt="percent")
    val = _outcome_rate(outcome, p)
    cval = _outcome_rate(outcome, comp) if comp else None
    return _kpi_card(indicateur, val, cval, p, fmt="percent")


def cancellation_rate(p: Period, comp: Period = None) -> dict:
    """Taux d'annulation iClosed : outcome='CANCELLED' / outcome IS NOT NULL."""
    return _outcome_rate_card("cancellation_rate", "CANCELLED", p, comp)


def disqualification_rate(p: Period, comp: Period = None) -> dict:
    """Taux de disqualification iClosed : outcome='DISQUALIFIED' / outcome IS NOT NULL."""
    return _outcome_rate_card("disqualification_rate", "DISQUALIFIED", p, comp)


def ventes_count(p: Period, comp: Period = None) -> dict:
    if not _table_exists("ic_deals"):
        return {"value": None, "status": "unknown"}
    val = _safe(cache.query_one(
        "SELECT COUNT(*) FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
        [p.start, p.end]
    ), 0)
    comp_val = None
    delta_pct = None
    if comp:
        comp_val = _safe(cache.query_one(
            "SELECT COUNT(*) FROM ic_deals WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'",
            [comp.start, comp.end]
        ), 0)
        if comp_val and comp_val > 0:
            delta_pct = round((val - comp_val) / comp_val * 100, 1)
    return {"value": val, "comparison_value": comp_val, "delta_pct": delta_pct, "status": "unknown"}


# ─── Tables ──────────────────────────────────────────────────────────────────

def closers_table(p: Period) -> list:
    if not _table_exists("ic_calls") or not _table_exists("ic_deals"):
        return []
    df = cache.query("""
        WITH calls_agg AS (
            SELECT
                closer,
                COUNT(*) AS calls_total,
                COUNT(*) FILTER (WHERE outcome IS NOT NULL) AS calls_logged,
                COUNT(*) FILTER (WHERE outcome = 'NO_SHOW') AS no_shows,
                COUNT(*) FILTER (WHERE outcome IS NOT NULL AND outcome != 'NO_SHOW') AS shown
            FROM ic_calls
            WHERE date BETWEEN ? AND ?
            GROUP BY closer
        ),
        deals_agg AS (
            SELECT
                closer,
                COUNT(*) FILTER (WHERE transaction_type = 'WON') AS ventes,
                SUM(value) FILTER (WHERE transaction_type = 'WON') AS ca
            FROM ic_deals
            WHERE date BETWEEN ? AND ?
            GROUP BY closer
        )
        SELECT
            c.closer,
            c.calls_total AS calls,
            c.shown,
            c.no_shows,
            COALESCE(d.ventes, 0) AS ventes,
            COALESCE(d.ca, 0) AS ca,
            CASE WHEN c.shown > 0 THEN ROUND(COALESCE(d.ventes, 0)::float / c.shown * 100, 1) END AS closing_rate_pct,
            CASE WHEN d.ventes > 0 THEN ROUND(d.ca / d.ventes, 0) END AS acv
        FROM calls_agg c
        LEFT JOIN deals_agg d ON c.closer = d.closer
        ORDER BY ca DESC NULLS LAST
    """, [p.start, p.end, p.start, p.end])
    if df.empty:
        return []
    return df.to_dict(orient="records")


def outcomes_breakdown(p: Period) -> list:
    if not _table_exists("ic_calls"):
        return []
    df = cache.query("""
        SELECT
            COALESCE(outcome, 'Non renseigné') AS outcome,
            COUNT(*) AS count
        FROM ic_calls
        WHERE date BETWEEN ? AND ?
        GROUP BY outcome
        ORDER BY count DESC
    """, [p.start, p.end])
    if df.empty:
        return []
    total = df["count"].sum()
    return [
        {
            "outcome": row["outcome"],
            "count": int(row["count"]),
            "pct": round(row["count"] / total * 100, 1) if total else 0,
        }
        for _, row in df.iterrows()
    ]


def chart_revenue_by_day(p: Period) -> list:
    if not _table_exists("ic_deals"):
        return []
    df = cache.query("""
        SELECT date, SUM(value) AS ca, COUNT(*) AS ventes
        FROM ic_deals
        WHERE date BETWEEN ? AND ? AND transaction_type = 'WON'
        GROUP BY date ORDER BY date ASC
    """, [p.start, p.end])
    if df.empty:
        return []
    return [
        {"date": str(row["date"]), "ca": float(row["ca"]), "ventes": int(row["ventes"])}
        for _, row in df.iterrows()
    ]
