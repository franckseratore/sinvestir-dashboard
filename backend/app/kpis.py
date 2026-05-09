from datetime import date, timedelta
from typing import Optional, List

import structlog

from . import cache
from .period_resolver import Period

log = structlog.get_logger()

_SENTINEL = None  # returned when data is unavailable


def _safe_div(num, den):
    if den is None or den == 0:
        return None
    if num is None:
        return None
    return num / den


def _get_target(indicateur: str) -> Optional[dict]:
    df = cache.query(
        "SELECT sens, target_mensuelle, seuil_critique, prorata FROM targets WHERE indicateur = ?",
        [indicateur],
    )
    if df.empty:
        return None
    row = df.iloc[0]
    return {
        "sens": row["sens"],
        "target": float(row["target_mensuelle"]),
        "seuil": float(row["seuil_critique"]),
        "prorata": bool(row["prorata"]),
    }


def _scale_target(t: Optional[dict], period: Period) -> tuple:
    if not t:
        return None, None
    # Garde année : si la période est ENTIÈREMENT hors-2026 (avant ou après), pas de comparaison.
    # Période chevauchante (ex. last_30_days fin janvier 2026 ↔ déc 2025) : on conserve la comparaison aux targets 2026.
    if (period.start.year < 2026 and period.end.year < 2026) or (period.start.year > 2026 and period.end.year > 2026):
        log.warning("target_skipped_out_of_2026", start=str(period.start), end=str(period.end))
        return None, None
    if not t.get("prorata", False):
        return t["target"], t["seuil"]
    scale = period.days / 30.0
    return t["target"] * scale, t["seuil"] * scale


def _compute_pct_atteinte(value: Optional[float], target: Optional[float], sens: Optional[str]) -> tuple:
    """Calcule le % atteint et le pct_status selon les seuils universels du brief.

    Logique :
    - sens=Haut → pct_atteinte = (value / target) * 100   (plus c'est haut, mieux c'est)
    - sens=Bas  → pct_atteinte = (target / value) * 100   (logique inversée : CPL, no_show, budget…)
    - target=None ou 0 ou value=None → pct_atteinte=None, pct_status='unknown'
    - Plafond stockage : 999 % (évite les valeurs aberrantes en cas de division par très petit nombre).
    - Plafond métier (Q4 verrouillé) : un KPI à 200 % compte comme 'atteint' (vert), pas plus.
      Le pct_status est donc déterminé par les seuils 100/80, sans pondération au-delà.
    """
    if value is None or target is None or target == 0:
        return None, "unknown"
    if not sens:
        return None, "unknown"
    if sens == "Haut":
        pct = (value / target) * 100
    else:
        if value == 0:
            pct = 999.0
        else:
            pct = (target / value) * 100
    pct = min(pct, 999.0)
    if pct >= 100:
        st = "green"
    elif pct >= 80:
        st = "orange"
    else:
        st = "red"
    return round(pct, 1), st


def _status(value: Optional[float], target: Optional[float], seuil: Optional[float], sens: Optional[str]) -> str:
    if value is None or target is None or seuil is None or not sens:
        return "unknown"
    if sens == "Haut":
        if value >= target:
            return "green"
        if value >= seuil:
            return "orange"
        return "red"
    else:  # Bas
        if value <= target:
            return "green"
        if value <= seuil:
            return "orange"
        return "red"


def _last_4_iso_weeks() -> List[tuple]:
    """Returns (monday, sunday) for the last 4 closed ISO weeks, oldest first."""
    today = date.today()
    last_sunday = today - timedelta(days=today.weekday() + 1)
    weeks = []
    for i in range(3, -1, -1):
        sunday = last_sunday - timedelta(weeks=i)
        monday = sunday - timedelta(days=6)
        weeks.append((monday, sunday))
    return weeks


def _trend_alert(sql_value: str, sql_from: str, period_col: str, sens: str = "Haut") -> bool:
    """True if the last 3 consecutive ISO weekly changes are all in the wrong direction."""
    weeks = _last_4_iso_weeks()
    values = []
    for monday, sunday in weeks:
        df = cache.query(
            f"SELECT COALESCE({sql_value}, 0) as v FROM {sql_from} WHERE {period_col} BETWEEN ? AND ?",
            [monday, sunday],
        )
        values.append(float(df["v"].iloc[0]) if not df.empty else 0)
    deltas = [values[i + 1] - values[i] for i in range(3)]
    if sens == "Bas":
        return all(d > 0 for d in deltas)
    return all(d < 0 for d in deltas)


def _n(val) -> Optional[float]:
    """Convert any numeric (incl. numpy) to Python float, or None."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if f != f else f  # NaN check
    except (TypeError, ValueError):
        return None


def _sparkline(metric_sql: str, table: str, date_col: str, period: Period) -> List[float]:
    end = period.end
    start = end - timedelta(days=29)
    df = cache.query(
        f"""
        SELECT {date_col} as d, {metric_sql} as v
        FROM {table}
        WHERE {date_col} BETWEEN ? AND ?
        GROUP BY {date_col}
        ORDER BY {date_col}
        """,
        [start, end],
    )
    return [round(float(v), 2) for v in df["v"].fillna(0)]


def _kpi_card(
    indicateur: str,
    value: Optional[float],
    comp_value: Optional[float],
    period: Period,
    fmt: str = "number",
    sparkline_vals: Optional[list] = None,
    trend_alert: bool = False,
    moving_avg_4w: Optional[float] = None,
) -> dict:
    t = _get_target(indicateur)
    scaled_target, scaled_seuil = _scale_target(t, period)
    sens = t["sens"] if t else None

    delta = None
    delta_pct = None
    if value is not None and comp_value is not None and comp_value != 0:
        delta = value - comp_value
        delta_pct = round((delta / comp_value) * 100, 1)
    elif value is not None and comp_value is not None:
        delta = value - comp_value

    st = _status(value, scaled_target, scaled_seuil, sens)
    if trend_alert and st != "red":
        st = "red"

    pct_atteinte, pct_st = _compute_pct_atteinte(value, scaled_target, sens)

    def _r(v):
        return round(float(v), 2) if v is not None else None

    return {
        "value": _r(value),
        "comparison_value": _r(comp_value),
        "delta": _r(delta),
        "delta_pct": float(delta_pct) if delta_pct is not None else None,
        "status": st,
        "trend_alert": bool(trend_alert),
        "target": _r(scaled_target),
        "seuil_critique": _r(scaled_seuil),
        "pct_atteinte": pct_atteinte,
        "pct_status": pct_st,
        "format": fmt,
        "sparkline": sparkline_vals or [],
        "moving_avg_4w": _r(moving_avg_4w),
    }


# ─── Core metrics ────────────────────────────────────────────────────────────

def ca_ht(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    sp = _sparkline("COALESCE(SUM(ca_ht),0)", "ventes", "date", period)
    weeks = _last_4_iso_weeks()
    weekly = [float(cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [m, s]) or 0) for m, s in weeks]
    mov4w = round(sum(weekly) / 4, 2) if len(weekly) == 4 else None
    ta = len(weekly) == 4 and all(weekly[i + 1] < weekly[i] for i in range(3))
    return _kpi_card("ca_ht", val, cval, period, fmt="currency", sparkline_vals=sp, trend_alert=ta, moving_avg_4w=mov4w)


def volume_leads(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    sp = _sparkline("COUNT(*)", "leads", "date", period)
    return _kpi_card("volume_leads", val, cval, period, fmt="number", sparkline_vals=sp)


def volume_leads_paid(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    return _kpi_card("volume_leads_paid", val, cval, period, fmt="number")


def volume_leads_organic(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ? AND canal = 'Organique'", [period.start, period.end])
    cval = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ? AND canal = 'Organique'", [comp.start, comp.end]) if comp else None
    return _kpi_card("volume_leads_organic", val, cval, period, fmt="number")


def mix_acquisition(period: Period) -> dict:
    df = cache.query(
        "SELECT canal, COUNT(*) as n FROM leads WHERE date BETWEEN ? AND ? GROUP BY canal",
        [period.start, period.end],
    )
    total = int(df["n"].sum()) if not df.empty else 0
    result = {"total": total}
    for _, row in df.iterrows():
        pct = round(float(row["n"]) / total * 100, 1) if total else 0
        result[str(row["canal"])] = {"count": int(row["n"]), "pct": pct}
    return result


def cpl_paid(period: Period, comp: Optional[Period] = None) -> dict:
    budget = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [period.start, period.end])
    leads = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(budget, leads)
    cval = None
    if comp:
        cb = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cl = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cb, cl)
    return _kpi_card("cpl_paid", val, cval, period, fmt="currency")


def cpl_by_canal(period: Period) -> List[dict]:
    rows = []
    for canal in ["Google", "Meta", "TikTok"]:
        budget = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ? AND sous_canal = ?", [period.start, period.end, canal])
        leads = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ? AND sous_canal = ?", [period.start, period.end, canal])
        cpl = _safe_div(budget, leads)
        rows.append({"canal": f"Paid/{canal}", "budget": budget or 0, "leads": leads or 0, "cpl": cpl})
    return rows


def booking_rate(period: Period, comp: Optional[Period] = None) -> dict:
    calls = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [period.start, period.end])
    leads = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(calls, leads)
    cval = None
    if comp:
        cc = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [comp.start, comp.end])
        cl = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cc, cl)
    weeks = _last_4_iso_weeks()
    weekly = []
    for m, s in weeks:
        c = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [m, s])
        l = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [m, s])
        r = _safe_div(c, l)
        if r is not None:
            weekly.append(r)
    mov4w = round(sum(weekly) / len(weekly), 4) if weekly else None
    ta = len(weekly) == 4 and all(weekly[i + 1] < weekly[i] for i in range(3))
    return _kpi_card("booking_rate", val, cval, period, fmt="percent", trend_alert=ta, moving_avg_4w=mov4w)


def calls_booked(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    return _kpi_card("calls_booked", val, cval, period, fmt="number")


def calls_completed(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [period.start, period.end])
    cval = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [comp.start, comp.end]) if comp else None
    return _kpi_card("calls_completed", val, cval, period, fmt="number")


def no_show_rate(period: Period, comp: Optional[Period] = None) -> dict:
    # Éligibles = calls dont le créneau est passé OU sans créneau confirmé (hors futurs)
    # No-show = sans créneau confirmé (date_call IS NULL) parmi les éligibles
    eligible = cache.query_one(
        "SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND (is_past = TRUE OR date_call IS NULL)",
        [period.start, period.end]
    )
    no_show = cache.query_one(
        "SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND date_call IS NULL",
        [period.start, period.end]
    )
    val = _safe_div(no_show, eligible)
    cval = None
    if comp:
        ce = cache.query_one(
            "SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND (is_past = TRUE OR date_call IS NULL)",
            [comp.start, comp.end]
        )
        cn = cache.query_one(
            "SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND date_call IS NULL",
            [comp.start, comp.end]
        )
        cval = _safe_div(cn, ce)
    weeks = _last_4_iso_weeks()
    weekly = []
    for m, s in weeks:
        el = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND (is_past = TRUE OR date_call IS NULL)", [m, s])
        ns = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND date_call IS NULL", [m, s])
        r = _safe_div(ns, el)
        if r is not None:
            weekly.append(r)
    mov4w = round(sum(weekly) / len(weekly), 4) if weekly else None
    ta = len(weekly) == 4 and all(weekly[i + 1] > weekly[i] for i in range(3))  # Bas: alert on 3 consecutive increases
    return _kpi_card("no_show_rate", val, cval, period, fmt="percent", trend_alert=ta, moving_avg_4w=mov4w)


def closing_rate(period: Period, comp: Optional[Period] = None) -> dict:
    """Taux de closing brut : ventes / calls réservés (inclut no-shows)."""
    sales = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    booked = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(sales, booked)
    cval = None
    if comp:
        cs = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cb = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cs, cb)
    weeks = _last_4_iso_weeks()
    weekly = []
    for m, s in weeks:
        sl = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [m, s])
        bk = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [m, s])
        r = _safe_div(sl, bk)
        if r is not None:
            weekly.append(r)
    mov4w = round(sum(weekly) / len(weekly), 4) if weekly else None
    ta = len(weekly) == 4 and all(weekly[i + 1] < weekly[i] for i in range(3))
    return _kpi_card("closing_rate", val, cval, period, fmt="percent", trend_alert=ta, moving_avg_4w=mov4w)


def closing_rate_net(period: Period, comp: Optional[Period] = None) -> dict:
    """Taux de closing net : ventes / calls passés (hors no-shows)."""
    sales = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    completed = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [period.start, period.end])
    val = _safe_div(sales, completed)
    cval = None
    if comp:
        cs = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cc = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [comp.start, comp.end])
        cval = _safe_div(cs, cc)
    return _kpi_card("closing_rate_net", val, cval, period, fmt="percent")


def booking_rate_paid(period: Period, comp: Optional[Period] = None) -> dict:
    calls = cache.query_one("SELECT COUNT(*) FROM calls_paid WHERE date_reservation BETWEEN ? AND ?", [period.start, period.end])
    leads = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(calls, leads)
    cval = None
    if comp:
        cc = cache.query_one("SELECT COUNT(*) FROM calls_paid WHERE date_reservation BETWEEN ? AND ?", [comp.start, comp.end])
        cl = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cc, cl)
    return _kpi_card("booking_rate_paid", val, cval, period, fmt="percent")


def booking_rate_organic(period: Period, comp: Optional[Period] = None) -> dict:
    calls = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND canal = 'Organique'", [period.start, period.end])
    leads = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ? AND canal = 'Organique'", [period.start, period.end])
    val = _safe_div(calls, leads)
    cval = None
    if comp:
        cc = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND canal = 'Organique'", [comp.start, comp.end])
        cl = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ? AND canal = 'Organique'", [comp.start, comp.end])
        cval = _safe_div(cc, cl)
    return _kpi_card("booking_rate_organic", val, cval, period, fmt="percent")


def closing_rate_by_closer(period: Period) -> List[dict]:
    df_sales = cache.query(
        "SELECT closer, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY closer",
        [period.start, period.end],
    )
    df_calls = cache.query(
        "SELECT closer, COUNT(*) as calls FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE GROUP BY closer",
        [period.start, period.end],
    )
    merged = df_sales.merge(df_calls, on="closer", how="outer").fillna(0)
    rows = []
    for _, row in merged.iterrows():
        sales = int(row.get("ventes", 0))
        calls = int(row.get("calls", 0))
        rows.append({
            "closer": str(row["closer"]),
            "calls": calls,
            "ventes": sales,
            "closing_rate": round(sales / calls * 100, 1) if calls else None,
            "ca": round(float(row.get("ca", 0)), 2),
            "acv": round(float(row.get("ca", 0)) / sales, 2) if sales else None,
        })
    return sorted(rows, key=lambda r: r["ca"], reverse=True)


def closing_rate_by_canal(period: Period) -> List[dict]:
    df_sales = cache.query(
        "SELECT canal, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY canal",
        [period.start, period.end],
    )
    df_calls = cache.query(
        "SELECT canal, COUNT(*) as calls FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE GROUP BY canal",
        [period.start, period.end],
    )
    merged = df_sales.merge(df_calls, on="canal", how="outer").fillna(0)
    rows = []
    for _, row in merged.iterrows():
        sales = int(row.get("ventes", 0))
        calls = int(row.get("calls", 0))
        rows.append({
            "canal": str(row["canal"]),
            "calls": calls,
            "ventes": sales,
            "closing_rate": round(sales / calls * 100, 1) if calls else None,
            "ca": round(float(row.get("ca", 0)), 2),
        })
    return sorted(rows, key=lambda r: r["ca"], reverse=True)


def acv(period: Period, comp: Optional[Period] = None) -> dict:
    ca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cnt = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(ca, cnt)
    cval = None
    if comp:
        cca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        ccnt = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cca, ccnt)
    return _kpi_card("acv", val, cval, period, fmt="currency")


def ventes_count(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    return _kpi_card("ventes_count", val, cval, period, fmt="number")


def ca_by_produit(period: Period) -> List[dict]:
    df = cache.query(
        "SELECT produit_nom, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY produit_nom ORDER BY ca DESC",
        [period.start, period.end],
    )
    return [{"produit": r["produit_nom"], "ventes": int(r["ventes"]), "ca": round(float(r["ca"]), 2), "acv": round(float(r["ca"]) / int(r["ventes"]), 2) if r["ventes"] else None} for _, r in df.iterrows()]


def ca_by_closer(period: Period) -> List[dict]:
    df = cache.query(
        "SELECT closer, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY closer ORDER BY ca DESC",
        [period.start, period.end],
    )
    return [{"closer": r["closer"], "ventes": int(r["ventes"]), "ca": round(float(r["ca"]), 2)} for _, r in df.iterrows()]


def ca_by_canal(period: Period) -> List[dict]:
    df = cache.query(
        "SELECT canal, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY canal ORDER BY ca DESC",
        [period.start, period.end],
    )
    return [{"canal": r["canal"], "ventes": int(r["ventes"]), "ca": round(float(r["ca"]), 2)} for _, r in df.iterrows()]


def ca_per_lead(period: Period, comp: Optional[Period] = None) -> dict:
    ca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    leads = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(ca, leads)
    cval = None
    if comp:
        cca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cl = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cca, cl)
    weeks = _last_4_iso_weeks()
    weekly = []
    for m, s in weeks:
        wca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [m, s])
        wl = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [m, s])
        r = _safe_div(wca, wl)
        if r is not None:
            weekly.append(r)
    mov4w = round(sum(weekly) / len(weekly), 4) if weekly else None
    ta = len(weekly) == 4 and all(weekly[i + 1] < weekly[i] for i in range(3))
    return _kpi_card("ca_per_lead", val, cval, period, fmt="currency", trend_alert=ta, moving_avg_4w=mov4w)


def ca_per_call(period: Period, comp: Optional[Period] = None) -> dict:
    ca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end])
    calls = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [period.start, period.end])
    val = _safe_div(ca, calls)
    cval = None
    if comp:
        cca = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cc = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [comp.start, comp.end])
        cval = _safe_div(cca, cc)
    return _kpi_card("ca_per_call", val, cval, period, fmt="currency")


# ─── Ads KPIs ────────────────────────────────────────────────────────────────

def budget_paid(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    sp = _sparkline("COALESCE(SUM(spend),0)", "budget", "date", period)
    return _kpi_card("budget_paid", val, cval, period, fmt="currency", sparkline_vals=sp)


def ca_paid(period: Period, comp: Optional[Period] = None) -> dict:
    val = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ?", [period.start, period.end])
    cval = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ?", [comp.start, comp.end]) if comp else None
    return _kpi_card("ca_ht", val, cval, period, fmt="currency")


def roas_paid(period: Period, comp: Optional[Period] = None) -> dict:
    b = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [period.start, period.end])
    r = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ?", [period.start, period.end])
    val = _safe_div(r, b)
    cval = None
    if comp:
        cb = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cr = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ?", [comp.start, comp.end])
        cval = _safe_div(cr, cb)
    sp = _sparkline("COALESCE(SUM(spend),0)", "budget", "date", period)
    weeks = _last_4_iso_weeks()
    weekly = []
    for m, s in weeks:
        wb = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ?", [m, s])
        wr = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ?", [m, s])
        ratio = _safe_div(wr, wb)
        if ratio is not None:
            weekly.append(ratio)
    mov4w = round(sum(weekly) / len(weekly), 4) if weekly else None
    ta = len(weekly) == 4 and all(weekly[i + 1] < weekly[i] for i in range(3))
    return _kpi_card("roas_paid", val, cval, period, fmt="number", sparkline_vals=sp, trend_alert=ta, moving_avg_4w=mov4w)


def benefice_net_for_period(start, end) -> dict:
    """Calcule le bénéfice net Paid pour une période donnée (agence réelle par canal)."""
    import calendar
    days_elapsed = (end - start).days + 1
    days_in_month = calendar.monthrange(start.year, start.month)[1]

    ca = float(cache.query_one(
        "SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ?", [start, end],
    ) or 0)
    google_spend = float(cache.query_one(
        "SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ? AND sous_canal = 'Google'", [start, end],
    ) or 0)
    meta_spend = float(cache.query_one(
        "SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ? AND sous_canal = 'Meta'", [start, end],
    ) or 0)

    agence_google = google_spend * 0.10
    agence_meta = max(meta_spend * 0.08, 1500 * (days_elapsed / days_in_month))
    total_spend = google_spend + meta_spend
    total_agence = agence_google + agence_meta
    val = ca - total_spend - total_agence
    marge = _safe_div(val, ca)

    return {
        "benefice_net": round(val, 2),
        "marge_pct": round(marge * 100, 1) if marge is not None else None,
        "mtd_label": f"{start.strftime('%d/%m')} → {end.strftime('%d/%m/%Y')}",
        "ca": round(ca, 2),
        "spend": round(total_spend, 2),
        "agence": round(total_agence, 2),
    }


def benefice_net_paid() -> dict:
    """Cumul mois en cours (MTD)."""
    from datetime import date as _date
    today = _date.today()
    return benefice_net_for_period(today.replace(day=1), today)


def roas_by_canal(period: Period) -> List[dict]:
    rows = []
    for canal in ["Google", "Meta"]:
        b = cache.query_one("SELECT COALESCE(SUM(spend),0) FROM budget WHERE date BETWEEN ? AND ? AND sous_canal = ?", [period.start, period.end, canal])
        r = cache.query_one("SELECT COALESCE(SUM(ca_ht),0) FROM ventes_paid WHERE date BETWEEN ? AND ? AND sous_canal = ?", [period.start, period.end, canal])
        l = cache.query_one("SELECT COUNT(*) FROM leads_paid WHERE date BETWEEN ? AND ? AND sous_canal = ?", [period.start, period.end, canal])
        rows.append({"canal": f"Paid/{canal}", "budget": b or 0, "ca": r or 0, "leads": l or 0, "roas": _safe_div(r, b), "cpl": _safe_div(b, l)})
    return rows


def creatives_table(period: Period) -> List[dict]:
    from .config import settings
    # Taux agence par canal (sans le minimum mensuel Meta, non imputables par créa)
    AGENCE_RATES = {"Google": 0.10, "Meta": 0.08}

    df_budget = cache.query(
        "SELECT creative_id, sous_canal, COALESCE(SUM(spend),0) as spend FROM budget WHERE date BETWEEN ? AND ? GROUP BY creative_id, sous_canal",
        [period.start, period.end],
    )
    df_leads = cache.query(
        "SELECT source as creative_id, COUNT(*) as leads FROM leads_paid WHERE date BETWEEN ? AND ? GROUP BY source",
        [period.start, period.end],
    )
    df_calls = cache.query(
        "SELECT source as creative_id, COUNT(*) as calls FROM calls_paid WHERE date_reservation BETWEEN ? AND ? GROUP BY source",
        [period.start, period.end],
    )
    df_ventes = cache.query(
        "SELECT source_initiale as creative_id, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes_paid WHERE date BETWEEN ? AND ? GROUP BY source_initiale",
        [period.start, period.end],
    )

    merged = df_budget.merge(df_leads, on="creative_id", how="left")
    merged = merged.merge(df_calls, on="creative_id", how="left")
    merged = merged.merge(df_ventes, on="creative_id", how="left")
    merged = merged.fillna(0)

    rows = []
    for _, r in merged.iterrows():
        spend = float(r["spend"])
        leads = int(r.get("leads", 0))
        calls = int(r.get("calls", 0))
        ventes = int(r.get("ventes", 0))
        ca = float(r.get("ca", 0))
        cpl = _safe_div(spend, leads)
        roas = _safe_div(ca, spend)
        canal_name = str(r.get("sous_canal", ""))
        agence_rate = AGENCE_RATES.get(canal_name, 0.10)
        agence_cost = spend * agence_rate
        benefice = ca - spend - agence_cost if ca > 0 else -spend - agence_cost
        marge = _safe_div(benefice, ca) if ca > 0 else None

        cpl_target = cache.query_one("SELECT seuil_critique FROM targets WHERE indicateur = 'cpl_paid'") or 30
        rows.append({
            "creative_id": str(r["creative_id"]),
            "canal": str(r.get("sous_canal", "")),
            "spend": round(spend, 2),
            "leads": leads,
            "cpl": round(cpl, 2) if cpl else None,
            "calls": calls,
            "ventes": ventes,
            "ca": round(ca, 2),
            "roas": round(roas, 2) if roas else None,
            "marge_pct": round(marge * 100, 1) if marge else None,
            "alert": cpl is not None and cpl > float(cpl_target),
        })

    return sorted(rows, key=lambda r: r["spend"], reverse=True)


# ─── Chart series ─────────────────────────────────────────────────────────────

def _date_trunc(col: str, granularity: str) -> str:
    if granularity == "weekly":
        return f"date_trunc('week', {col})"
    if granularity == "monthly":
        return f"date_trunc('month', {col})"
    return col


def chart_ca_series(period: Period, comp: Optional[Period] = None) -> List[dict]:
    grp = _date_trunc("date", period.granularity)
    df = cache.query(
        f"SELECT {grp} as d, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY {grp} ORDER BY {grp}",
        [period.start, period.end],
    )
    result = [{"date": str(r["d"])[:10], "value": round(float(r["ca"]), 2)} for _, r in df.iterrows()]

    if comp:
        grp_c = _date_trunc("date", comp.granularity)
        df_c = cache.query(
            f"SELECT {grp_c} as d, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY {grp_c} ORDER BY {grp_c}",
            [comp.start, comp.end],
        )
        comp_list = [round(float(r["ca"]), 2) for _, r in df_c.iterrows()]
        for i, item in enumerate(result):
            item["comparison_value"] = comp_list[i] if i < len(comp_list) else None

    return result


def chart_leads_by_canal(period: Period) -> List[dict]:
    grp = _date_trunc("date", period.granularity)
    df = cache.query(
        f"SELECT {grp} as d, canal, COUNT(*) as n FROM leads WHERE date BETWEEN ? AND ? GROUP BY {grp}, canal ORDER BY {grp}",
        [period.start, period.end],
    )
    return [{"date": str(r["d"])[:10], "canal": str(r["canal"]), "value": int(r["n"])} for _, r in df.iterrows()]


def chart_closing_rate_by_closer(period: Period) -> List[dict]:
    grp = _date_trunc("date", period.granularity)
    grp_r = _date_trunc("date_reservation", period.granularity)
    df_ventes = cache.query(
        f"SELECT {grp} as d, closer, COUNT(*) as ventes FROM ventes WHERE date BETWEEN ? AND ? GROUP BY {grp}, closer ORDER BY {grp}",
        [period.start, period.end],
    )
    df_calls = cache.query(
        f"SELECT {grp_r} as d, closer, COUNT(*) as calls FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE GROUP BY {grp_r}, closer ORDER BY {grp_r}",
        [period.start, period.end],
    )
    df_ventes = df_ventes.rename(columns={"d": "date"})
    df_calls = df_calls.rename(columns={"d": "date"})
    merged = df_ventes.merge(df_calls, on=["date", "closer"], how="outer").fillna(0)
    merged["closing_rate"] = merged.apply(lambda r: round(r["ventes"] / r["calls"] * 100, 1) if r["calls"] else None, axis=1)
    return [{"date": str(r["date"])[:10], "closer": str(r["closer"]), "closing_rate": r["closing_rate"]} for _, r in merged.iterrows()]


def chart_budget_ca_roas(period: Period) -> List[dict]:
    grp = _date_trunc("date", period.granularity)
    df_b = cache.query(
        f"SELECT {grp} as d, COALESCE(SUM(spend),0) as spend FROM budget WHERE date BETWEEN ? AND ? GROUP BY {grp} ORDER BY {grp}",
        [period.start, period.end],
    )
    df_v = cache.query(
        f"SELECT {grp} as d, COALESCE(SUM(ca_ht),0) as ca FROM ventes_paid WHERE date BETWEEN ? AND ? GROUP BY {grp} ORDER BY {grp}",
        [period.start, period.end],
    )
    df_b = df_b.rename(columns={"d": "date"})
    df_v = df_v.rename(columns={"d": "date"})
    merged = df_b.merge(df_v, on="date", how="outer").fillna(0)
    merged = merged.sort_values("date")
    rows = []
    for _, r in merged.iterrows():
        spend = float(r["spend"])
        ca = float(r["ca"])
        rows.append({"date": str(r["date"])[:10], "budget": round(spend, 2), "ca": round(ca, 2), "roas": round(ca / spend, 2) if spend else None})
    return rows


def funnel(period: Period) -> List[dict]:
    leads = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ?", [period.start, period.end]) or 0
    booked = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ?", [period.start, period.end]) or 0
    completed = cache.query_one("SELECT COUNT(*) FROM calls WHERE date_reservation BETWEEN ? AND ? AND is_past = TRUE", [period.start, period.end]) or 0
    sales = cache.query_one("SELECT COUNT(*) FROM ventes WHERE date BETWEEN ? AND ?", [period.start, period.end]) or 0

    steps = [
        ("Leads", leads),
        ("Calls réservés", booked),
        ("Calls passés", completed),
        ("Ventes", sales),
    ]
    result = []
    for i, (label, value) in enumerate(steps):
        prev = steps[i - 1][1] if i > 0 else None
        pct = round(value / prev * 100, 1) if prev and prev > 0 else None
        result.append({"label": label, "value": int(value), "pct": pct})
    return result


def top_sources(period: Period, limit: int = 5) -> List[dict]:
    df = cache.query(
        "SELECT source_initiale as source, canal, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY source_initiale, canal ORDER BY ca DESC LIMIT ?",
        [period.start, period.end, limit],
    )
    return [{"source": r["source"], "canal": r["canal"], "ventes": int(r["ventes"]), "ca": round(float(r["ca"]), 2)} for _, r in df.iterrows()]


def canal_performance(period: Period) -> List[dict]:
    df_leads = cache.query(
        "SELECT canal, sous_canal, COUNT(*) as leads FROM leads WHERE date BETWEEN ? AND ? GROUP BY canal, sous_canal",
        [period.start, period.end],
    )
    df_calls = cache.query(
        "SELECT canal, sous_canal, COUNT(*) as calls FROM calls WHERE date_reservation BETWEEN ? AND ? GROUP BY canal, sous_canal",
        [period.start, period.end],
    )
    df_ventes = cache.query(
        "SELECT canal, sous_canal, COUNT(*) as ventes, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? GROUP BY canal, sous_canal",
        [period.start, period.end],
    )
    df_budget = cache.query(
        "SELECT canal, sous_canal, COALESCE(SUM(spend),0) as budget FROM budget WHERE date BETWEEN ? AND ? GROUP BY canal, sous_canal",
        [period.start, period.end],
    )

    merged = df_leads.merge(df_calls, on=["canal", "sous_canal"], how="outer")
    merged = merged.merge(df_ventes, on=["canal", "sous_canal"], how="outer")
    merged = merged.merge(df_budget, on=["canal", "sous_canal"], how="outer")
    merged = merged.fillna(0)

    rows = []
    for _, r in merged.iterrows():
        leads = int(r.get("leads", 0))
        calls = int(r.get("calls", 0))
        ventes = int(r.get("ventes", 0))
        ca = float(r.get("ca", 0))
        budget = float(r.get("budget", 0))
        rows.append({
            "canal": str(r["canal"]),
            "sous_canal": str(r["sous_canal"]),
            "leads": leads,
            "cpl": round(budget / leads, 2) if leads and budget else None,
            "calls": calls,
            "booking_rate": round(calls / leads * 100, 1) if leads else None,
            "ventes": ventes,
            "ca": round(ca, 2),
            "roas": round(ca / budget, 2) if budget else None,
        })
    return sorted(rows, key=lambda r: r["ca"], reverse=True)


def organic_sources(period: Period, limit: int = 20) -> List[dict]:
    df = cache.query(
        "SELECT source, sous_canal, COUNT(*) as leads FROM leads WHERE date BETWEEN ? AND ? AND canal = 'Organique' GROUP BY source, sous_canal ORDER BY leads DESC LIMIT ?",
        [period.start, period.end, limit],
    )
    df_ca = cache.query(
        "SELECT source_initiale as source, COALESCE(SUM(ca_ht),0) as ca FROM ventes WHERE date BETWEEN ? AND ? AND canal = 'Organique' GROUP BY source_initiale",
        [period.start, period.end],
    )
    merged = df.merge(df_ca, on="source", how="left").fillna(0)
    return [{"source": r["source"], "sous_canal": r["sous_canal"], "leads": int(r["leads"]), "ca": round(float(r["ca"]), 2)} for _, r in merged.iterrows()]


def global_status(period: Period) -> dict:
    """Aggregate KPI statuses across all domains for the Overview dashboard."""
    computations = [
        (volume_leads,        "Volume Leads",       "marketing", "/marketing"),
        (booking_rate,        "Booking Rate",        "marketing", "/marketing"),
        (booking_rate_paid,   "Booking Rate Paid",   "marketing", "/marketing"),
        (ca_per_lead,         "CA / Lead",           "marketing", "/marketing"),
        (ca_ht,               "CA HT",               "sales",     "/sales"),
        (closing_rate,        "Closing brut",        "sales",     "/sales"),
        (closing_rate_net,    "Closing net",         "sales",     "/sales"),
        (no_show_rate,        "No-show Rate",        "sales",     "/sales"),
        (acv,                 "Panier moyen",        "sales",     "/sales"),
        (ca_per_call,         "CA / Call",           "sales",     "/sales"),
        (roas_paid,           "ROAS Paid",           "ads",       "/ads"),
        (cpl_paid,            "CPL Paid",            "ads",       "/ads"),
    ]

    all_kpis = []
    for fn, label, domain, href in computations:
        try:
            result = fn(period)
            all_kpis.append({
                "key": fn.__name__,
                "label": label,
                "domain": domain,
                "href": href,
                "value": result.get("value"),
                "target": result.get("target"),
                "format": result.get("format", "number"),
                "status": result.get("status", "unknown"),
                "pct_atteinte": result.get("pct_atteinte"),
                "pct_status": result.get("pct_status", "unknown"),
            })
        except Exception:
            pass

    # Bénéfice Net Paid (MTD, indépendant de la période — ne passe pas par _kpi_card())
    try:
        b = benefice_net_paid()
        t = _get_target("benefice_net_paid")
        b_target = t["target"] if t else None
        b_seuil = t["seuil"] if t else None
        b_sens = t["sens"] if t else None
        b_status = _status(b["benefice_net"], b_target, b_seuil, b_sens)
        b_pct, b_pct_status = _compute_pct_atteinte(b["benefice_net"], b_target, b_sens)
        all_kpis.append({
            "key": "benefice_net_paid",
            "label": "Bénéfice Net Paid (MTD)",
            "domain": "ads",
            "href": "/ads",
            "value": b["benefice_net"],
            "target": b_target,
            "format": "currency",
            "status": b_status,
            "pct_atteinte": b_pct,
            "pct_status": b_pct_status,
        })
    except Exception:
        pass

    # Domain summaries (rétro-compat : utilisé par <DomainSummary>)
    domains: dict = {}
    for kpi in all_kpis:
        d = kpi["domain"]
        if d not in domains:
            domains[d] = {"green": 0, "orange": 0, "red": 0, "unknown": 0, "total": 0}
        st = kpi["status"] if kpi["status"] in ("green", "orange", "red") else "unknown"
        domains[d][st] += 1
        domains[d]["total"] += 1

    critical_kpis = [k for k in all_kpis if k["status"] == "red"]
    warning_kpis = [k for k in all_kpis if k["status"] == "orange"]

    if critical_kpis:
        worst = "red"
        n = len(critical_kpis)
        phrase = f"{n} KPI{'s' if n > 1 else ''} au-dessus du seuil critique métier."
    elif warning_kpis:
        worst = "orange"
        n = len(warning_kpis)
        phrase = f"{n} KPI{'s' if n > 1 else ''} à surveiller."
    else:
        worst = "green"
        phrase = "Tous les KPIs sont dans les clous."

    # ── Score & top_alert (Q3 + Q4 verrouillés) ──
    # Score = N_verts (pct_status=green) / N_avec_objectif (pct_status != unknown).
    # KPIs sans objectif (pct_status=unknown) sont exclus du calcul, comptés comme "hors comparaison".
    with_target = [k for k in all_kpis if k.get("pct_status") in ("green", "orange", "red")]
    excluded = len(all_kpis) - len(with_target)
    green_pct = sum(1 for k in with_target if k["pct_status"] == "green")
    orange_pct = sum(1 for k in with_target if k["pct_status"] == "orange")
    red_pct = sum(1 for k in with_target if k["pct_status"] == "red")
    total = len(with_target)
    score_pct = round(green_pct / total * 100, 1) if total > 0 else None

    # top_alert : 2 tiers (Q3 verrouillé)
    # Tier 1 : argmin(pct_atteinte) parmi status=="red" (priorité métier — au-delà du seuil_critique)
    # Tier 2 : argmin(pct_atteinte) parmi pct_status=="red" (badge rouge universel <80 %)
    # Tier 3 : null (tout est nominal)
    def _alert_payload(k: dict, tier: int) -> dict:
        return {
            "key": k["key"],
            "label": k["label"],
            "domain": k["domain"],
            "href": k["href"],
            "value": k.get("value"),
            "target": k.get("target"),
            "format": k.get("format", "number"),
            "pct_atteinte": k.get("pct_atteinte"),
            "tier": tier,
        }

    top_alert = None
    tier1 = [k for k in critical_kpis if k.get("pct_atteinte") is not None]
    if tier1:
        worst_kpi = min(tier1, key=lambda k: k["pct_atteinte"])
        top_alert = _alert_payload(worst_kpi, 1)
    else:
        tier2 = [k for k in with_target if k.get("pct_status") == "red" and k.get("pct_atteinte") is not None]
        if tier2:
            worst_kpi = min(tier2, key=lambda k: k["pct_atteinte"])
            top_alert = _alert_payload(worst_kpi, 2)

    return {
        "worst_status": worst,
        "phrase": phrase,
        "critical_count": len(critical_kpis),
        "warning_count": len(warning_kpis),
        "critical_kpis": critical_kpis,
        "domains": domains,
        # ── Nouveaux champs (Axe 1) ──
        "total": total,
        "green": green_pct,
        "orange": orange_pct,
        "red": red_pct,
        "excluded": excluded,
        "score_pct": score_pct,
        "top_alert": top_alert,
    }


def youtube_concentration(period: Period) -> dict:
    total_organic = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ? AND canal = 'Organique'", [period.start, period.end]) or 0
    ytb = cache.query_one("SELECT COUNT(*) FROM leads WHERE date BETWEEN ? AND ? AND sous_canal = 'YouTube'", [period.start, period.end]) or 0
    pct = _safe_div(ytb, total_organic)
    return {"youtube_leads": int(ytb), "organic_total": int(total_organic), "concentration": round(pct * 100, 1) if pct is not None else None, "alert": pct is not None and pct > 0.70}
