"""KPIs ActiveCampaign — calculés depuis la table ac_campaigns dans DuckDB."""
from datetime import date, timedelta

from . import cache
from .kpis import _get_target, _status


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

def open_rate(days: int = 30) -> dict:
    if not _table_exists("ac_campaigns"):
        return {"value": None, "status": "unknown"}
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    row = cache.query(f"""
        SELECT
            SUM(uniqueopens)::float / NULLIF(SUM(send_amt), 0) AS open_rate,
            COUNT(*) AS nb_campaigns
        FROM ac_campaigns
        WHERE sdate >= '{cutoff}'
    """)
    val = _safe(row.iloc[0]["open_rate"]) if not row.empty else None
    t = _get_target("open_rate_email")
    st = _status(val, t["target"] if t else None, t["seuil"] if t else None, t["sens"] if t else None)
    return {"value": val, "status": st}


def ctor(days: int = 30) -> dict:
    if not _table_exists("ac_campaigns"):
        return {"value": None, "status": "unknown"}
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    row = cache.query(f"""
        SELECT SUM(uniquelinkclicks)::float / NULLIF(SUM(uniqueopens), 0) AS ctor
        FROM ac_campaigns
        WHERE sdate >= '{cutoff}'
    """)
    val = _safe(row.iloc[0]["ctor"]) if not row.empty else None
    return {
        "value": val,
        "status": "green" if val and val >= 0.10 else ("orange" if val and val >= 0.05 else "red"),
    }


def unsubscribes(days: int = 30) -> dict:
    if not _table_exists("ac_campaigns"):
        return {"value": None, "status": "unknown"}
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    val = cache.query_one(f"""
        SELECT SUM(unsubscribes) FROM ac_campaigns WHERE sdate >= '{cutoff}'
    """)
    val = _safe(val, 0)
    return {
        "value": val,
        "status": "green" if val is not None and val < 100 else ("orange" if val is not None and val < 300 else "red"),
    }


def unsubscribe_rate(days: int = 30) -> dict:
    if not _table_exists("ac_campaigns"):
        return {"value": None, "status": "unknown"}
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    row = cache.query(f"""
        SELECT SUM(unsubscribes)::float / NULLIF(SUM(send_amt), 0) AS rate
        FROM ac_campaigns WHERE sdate >= '{cutoff}'
    """)
    val = _safe(row.iloc[0]["rate"]) if not row.empty else None
    return {
        "value": val,
        "status": "green" if val is not None and val < 0.002 else ("orange" if val is not None and val < 0.005 else "red"),
    }


def total_sends(days: int = 30) -> dict:
    if not _table_exists("ac_campaigns"):
        return {"value": None, "status": "unknown"}
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    val = cache.query_one(f"SELECT SUM(send_amt) FROM ac_campaigns WHERE sdate >= '{cutoff}'")
    return {"value": _safe(val, 0), "status": "unknown"}


def nb_campaigns(days: int = 30) -> dict:
    if not _table_exists("ac_campaigns"):
        return {"value": None, "status": "unknown"}
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    val = cache.query_one(f"SELECT COUNT(*) FROM ac_campaigns WHERE sdate >= '{cutoff}'")
    return {"value": _safe(val, 0), "status": "unknown"}


# ─── Charts ──────────────────────────────────────────────────────────────────

def chart_open_rate(days: int = 90) -> list:
    """OR par campagne sur les `days` derniers jours, trié par date."""
    if not _table_exists("ac_campaigns"):
        return []
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    df = cache.query(f"""
        SELECT
            sdate,
            name,
            send_amt,
            uniqueopens,
            uniquelinkclicks,
            open_rate,
            ctr,
            ctor,
            unsubscribes
        FROM ac_campaigns
        WHERE sdate >= '{cutoff}'
        ORDER BY sdate ASC
    """)
    if df.empty:
        return []
    return [
        {
            "date": str(row["sdate"]),
            "name": row["name"],
            "open_rate": round(float(row["open_rate"]), 4) if row["open_rate"] else 0,
            "ctr": round(float(row["ctr"]), 4) if row["ctr"] else 0,
        }
        for _, row in df.iterrows()
    ]


# ─── Tables ──────────────────────────────────────────────────────────────────

def campaigns_table(days: int = 90, limit: int = 50) -> list:
    """Top campagnes triées par date desc."""
    if not _table_exists("ac_campaigns"):
        return []
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    df = cache.query(f"""
        SELECT
            name,
            sdate,
            send_amt,
            uniqueopens,
            uniquelinkclicks,
            unsubscribes,
            ROUND(open_rate * 100, 1) AS open_rate_pct,
            ROUND(ctr * 100, 1)       AS ctr_pct,
            ROUND(ctor * 100, 1)      AS ctor_pct
        FROM ac_campaigns
        WHERE sdate >= '{cutoff}'
        ORDER BY sdate DESC
        LIMIT {limit}
    """)
    if df.empty:
        return []
    return df.to_dict(orient="records")
