import json
from datetime import date
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from . import cache, kpis
from .auth_middleware import require_auth
from .period_resolver import resolve, comparison_period
from .source_classifier import get_unknown_sources

router = APIRouter(dependencies=[Depends(require_auth)])


def _sanitize(obj):
    """Recursively replace NaN/Inf and numpy scalars with JSON-safe Python types."""
    import math
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        f = float(obj)
        return None if not math.isfinite(f) else f
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "item"):
        return obj.item()
    return obj


def _json(data) -> Response:
    return Response(content=json.dumps(_sanitize(data)), media_type="application/json")


def _parse_period(period: str, start: Optional[str], end: Optional[str], compare: bool):
    custom_start = date.fromisoformat(start) if start else None
    custom_end = date.fromisoformat(end) if end else None
    p = resolve(period, custom_start, custom_end)
    comp = comparison_period(p) if compare else None
    return p, comp


@router.get("/api/overview")
def overview(
    period: str = Query("last_30_days"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    compare: bool = Query(False),
):
    p, comp = _parse_period(period, start, end, compare)
    return _json({
        "period": {"start": str(p.start), "end": str(p.end), "label": p.label},
        "comparison": {"start": str(comp.start), "end": str(comp.end)} if comp else None,
        "kpis": {
            "ca_ht": kpis.ca_ht(p, comp),
            "volume_leads": kpis.volume_leads(p, comp),
            "booking_rate": kpis.booking_rate(p, comp),
            "closing_rate": kpis.closing_rate(p, comp),
            "cpl_paid": kpis.cpl_paid(p, comp),
            "roas_paid": kpis.roas_paid(p, comp),
        },
        "chart_ca": kpis.chart_ca_series(p, comp),
        "funnel": kpis.funnel(p),
        "top_sources": kpis.top_sources(p),
    })


@router.get("/api/marketing")
def marketing(
    period: str = Query("last_30_days"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    compare: bool = Query(False),
):
    p, comp = _parse_period(period, start, end, compare)
    return _json({
        "period": {"start": str(p.start), "end": str(p.end), "label": p.label},
        "kpis": {
            "volume_leads": kpis.volume_leads(p, comp),
            "volume_leads_paid": kpis.volume_leads_paid(p, comp),
            "volume_leads_organic": kpis.volume_leads_organic(p, comp),
            "booking_rate": kpis.booking_rate(p, comp),
            "booking_rate_paid": kpis.booking_rate_paid(p, comp),
            "booking_rate_organic": kpis.booking_rate_organic(p, comp),
            "ca_per_lead": kpis.ca_per_lead(p, comp),
        },
        "mix_acquisition": kpis.mix_acquisition(p),
        "chart_leads_by_canal": kpis.chart_leads_by_canal(p),
        "canal_performance": kpis.canal_performance(p),
        "organic_sources": kpis.organic_sources(p),
        "youtube_concentration": kpis.youtube_concentration(p),
    })


@router.get("/api/sales")
def sales(
    period: str = Query("last_30_days"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    compare: bool = Query(False),
):
    p, comp = _parse_period(period, start, end, compare)
    from . import kpis_iclosed as ki
    return _json({
        "period": {"start": str(p.start), "end": str(p.end), "label": p.label},
        "kpis": {
            "ca_ht": kpis.ca_ht(p, comp),
            "ventes_count": kpis.ventes_count(p, comp),
            "ca_per_call": kpis.ca_per_call(p, comp),
            "closing_rate": kpis.closing_rate(p, comp),
            "calls_booked": kpis.calls_booked(p, comp),
            "calls_completed": kpis.calls_completed(p, comp),
            "no_show_rate": kpis.no_show_rate(p, comp),
            "acv": kpis.acv(p, comp),
            "cancellation_rate": ki.cancellation_rate(p, comp),
            "disqualification_rate": ki.disqualification_rate(p, comp),
        },
        "ca_lbd_app": kpis.ca_lbd_app_breakdown(p),
        "closers": kpis.closing_rate_by_closer(p),
        "chart_closing_rate": kpis.chart_closing_rate_by_closer(p),
        "produits": kpis.ca_by_produit(p),
        "closing_by_canal": kpis.closing_rate_by_canal(p),
        "closing_by_canal_detail": kpis.closing_rate_by_canal_detail(p),
    })


@router.get("/api/ads")
def ads(
    period: str = Query("last_30_days"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    compare: bool = Query(False),
):
    p, comp = _parse_period(period, start, end, compare)
    benefice = kpis.benefice_net_paid()
    return _json({
        "period": {"start": str(p.start), "end": str(p.end), "label": p.label},
        "kpis": {
            "budget_paid": kpis.budget_paid(p, comp),
            "ca_paid": kpis.ca_paid(p, comp),
            "roas_paid": kpis.roas_paid(p, comp),
            "cpl_paid": kpis.cpl_paid(p, comp),
            "benefice_net": benefice["benefice_net"],
            "marge_pct": benefice["marge_pct"],
            "benefice_mtd_label": benefice["mtd_label"],
            "benefice_ca": benefice["ca"],
            "benefice_spend": benefice["spend"],
            "benefice_agence": benefice["agence"],
        },
        "chart_budget_ca_roas": kpis.chart_budget_ca_roas(p),
        "meta_vs_google": kpis.roas_by_canal(p),
        "creatives": kpis.creatives_table(p),
    })


@router.get("/api/status")
def status():
    return _json(cache.get_status())


@router.post("/api/weekly-report/send")
def trigger_weekly_report():
    """Déclenche manuellement le rapport hebdo (test / rattrapage)."""
    from .weekly_report import send_weekly_report
    try:
        send_weekly_report()
        return _json({"ok": True})
    except Exception as e:
        return _json({"ok": False, "error": str(e)})


@router.get("/api/email")
def email():
    from . import kpis_email as ke
    return _json({
        "kpis": {
            "open_rate":        ke.open_rate(30),
            "ctor":             ke.ctor(30),
            "unsubscribe_rate": ke.unsubscribe_rate(30),
            "unsubscribes":     ke.unsubscribes(30),
            "total_sends":      ke.total_sends(30),
            "nb_campaigns":     ke.nb_campaigns(30),
        },
        "chart_open_rate": ke.chart_open_rate(90),
        "campaigns":       ke.campaigns_table(90, 50),
    })


@router.get("/api/iclosed")
def iclosed(
    period: str = Query("last_30_days"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    compare: bool = Query(False),
):
    from . import kpis_iclosed as ki
    p, comp = _parse_period(period, start, end, compare)
    return _json({
        "period": {"start": str(p.start), "end": str(p.end), "label": p.label},
        "comparison": {"start": str(comp.start), "end": str(comp.end)} if comp else None,
        "kpis": {
            "volume_calls":     ki.volume_calls(p, comp),
            "no_show_rate":     ki.no_show_rate(p, comp),
            "closing_rate_net": ki.closing_rate_net(p, comp),
            "revenue":          ki.revenue(p, comp),
            "acv":              ki.acv(p, comp),
            "ventes_count":     ki.ventes_count(p, comp),
        },
        "closers":            ki.closers_table(p),
        "outcomes_breakdown": ki.outcomes_breakdown(p),
        "chart_revenue":      ki.chart_revenue_by_day(p),
    })


@router.get("/api/global-status")
def global_status(
    period: str = Query("last_30_days"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    p, _ = _parse_period(period, start, end, compare=False)
    return _json({
        "period": {"start": str(p.start), "end": str(p.end), "label": p.label},
        **kpis.global_status(p),
    })


@router.get("/api/debug/unknown-sources")
def unknown_sources():
    return _json({"unknown_sources": get_unknown_sources()})


class TargetUpdate(BaseModel):
    target_mensuelle: Optional[float] = None
    seuil_critique: Optional[float] = None


@router.get("/api/admin/targets")
def admin_targets():
    df = cache.query(
        "SELECT indicateur, description, unite, sens, target_mensuelle, seuil_critique, owner, prorata FROM targets ORDER BY indicateur"
    )
    return _json(df.to_dict(orient="records"))


@router.put("/api/admin/targets/{indicateur}")
def admin_update_target(indicateur: str, body: TargetUpdate):
    if body.target_mensuelle is not None:
        cache.execute("UPDATE targets SET target_mensuelle = ? WHERE indicateur = ?", [body.target_mensuelle, indicateur])
    if body.seuil_critique is not None:
        cache.execute("UPDATE targets SET seuil_critique = ? WHERE indicateur = ?", [body.seuil_critique, indicateur])
    return _json({"ok": True})


@router.post("/api/admin/report/weekly")
def trigger_weekly_report():
    """Déclenche manuellement le rapport hebdo (Slack + Notion)."""
    from .weekly_report import send_weekly_report
    try:
        send_weekly_report()
        return _json({"ok": True, "report": "weekly"})
    except Exception as e:
        return _json({"ok": False, "error": str(e)})


@router.post("/api/admin/report/monthly")
def trigger_monthly_report():
    """Déclenche manuellement le rapport mensuel (Slack + Notion)."""
    from .weekly_report import send_monthly_report
    try:
        send_monthly_report()
        return _json({"ok": True, "report": "monthly"})
    except Exception as e:
        return _json({"ok": False, "error": str(e)})


@router.post("/api/admin/refresh")
def trigger_refresh():
    """Force le rechargement immédiat des données depuis Google Sheets."""
    import asyncio
    from .main import _rebuild, _rebuild_external
    try:
        _rebuild()
        return _json({"ok": True, "message": "Données rechargées depuis Google Sheets"})
    except Exception as e:
        return _json({"ok": False, "error": str(e)})

