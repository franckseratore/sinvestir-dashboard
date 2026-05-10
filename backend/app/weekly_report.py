"""
Rapport hebdo automatique — chaque lundi 09h00 (Europe/Paris).
Envoie un résumé Slack + crée une entrée Notion dans "Revues hebdo équipe".
"""
from datetime import date, timedelta
import structlog

from . import kpis as kpi_module
from .period_resolver import Period, comparison_period
from .slack_client import post_webhook
from .notion_api import create_weekly_entry

MONTH_FR = {
    1:"janvier",2:"février",3:"mars",4:"avril",5:"mai",6:"juin",
    7:"juillet",8:"août",9:"septembre",10:"octobre",11:"novembre",12:"décembre"
}
MONTH_FR_SHORT = {
    1:"jan",2:"fév",3:"mar",4:"avr",5:"mai",6:"juin",
    7:"juil",8:"aoû",9:"sep",10:"oct",11:"nov",12:"déc"
}

log = structlog.get_logger()


# ─── KPI computation ─────────────────────────────────────────────────────────

def compute_last_week() -> dict:
    """Compute key KPIs for the week that just ended (Mon → Sun)."""
    today = date.today()
    # Last week: the Monday-to-Sunday period just before today
    week_end = today - timedelta(days=today.weekday() + 1)   # last Sunday
    week_start = week_end - timedelta(days=6)                  # last Monday

    p = Period(start=week_start, end=week_end, label="Semaine dernière", granularity="daily")
    comp = comparison_period(p)

    return {
        "week_start": week_start,
        "week_end": week_end,
        "ca_ht":            kpi_module.ca_ht(p, comp),
        "volume_leads":     kpi_module.volume_leads(p, comp),
        "volume_leads_paid":kpi_module.volume_leads_paid(p, comp),
        "booking_rate":     kpi_module.booking_rate(p, comp),
        "closing_rate_net": kpi_module.closing_rate_net(p, comp),
        "no_show_rate":     kpi_module.no_show_rate(p, comp),
        "calls_completed":  kpi_module.calls_completed(p, comp),
        "acv":              kpi_module.acv(p, comp),
        "cpl_paid":         kpi_module.cpl_paid(p, comp),
        "roas_paid":        kpi_module.roas_paid(p, comp),
        "budget_paid":      kpi_module.budget_paid(p, comp),
        "benefice_net":     kpi_module.benefice_net_paid(),
        # Axe 1 : score & top alert sur la même période (lecture seule, pas de modif logique)
        "global_status":    kpi_module.global_status(p),
    }


# ─── Formatters ──────────────────────────────────────────────────────────────

def _fc(v, signed: bool = False) -> str:
    if v is None: return "—"
    v = float(v)
    sign = "−" if v < 0 else ("+" if (v > 0 and signed) else "")
    return f"{sign}{int(abs(v)):,} €".replace(",", " ")

def _fp(v) -> str:
    if v is None: return "—"
    return f"{float(v)*100:.1f} %".replace(".", ",")

def _fn(v) -> str:
    if v is None: return "—"
    return f"{int(float(v)):,}".replace(",", " ")

def _fx(v) -> str:
    if v is None: return "—"
    return f"{float(v):.2f}x".replace(".", ",")

def _delta(kpi: dict) -> str:
    pct = kpi.get("delta_pct")
    if pct is None: return ""
    sign = "+" if pct >= 0 else "−"
    return f" ({sign}{abs(pct):.1f}%)".replace(".", ",")

def _em(status: str) -> str:
    return {"green": "🟢", "orange": "🟡", "red": "🔴"}.get(status or "", "⚪")

def _line(label: str, kpi: dict, fmt_fn) -> str:
    em = _em(kpi.get("status", ""))
    val = fmt_fn(kpi.get("value"))
    d = _delta(kpi)
    return f"{em} *{label}*\n{val}{d}"

def _plain(label: str, value: str) -> str:
    return f"*{label}*\n{value}"


def _format_alert_value(value, fmt: str) -> str:
    """Format a top_alert value depending on its KPI format (currency / percent / number)."""
    if value is None:
        return "—"
    if fmt == "currency":
        return _fc(value)
    if fmt == "percent":
        return _fp(value)
    if fmt == "number":
        return _fn(value)
    # ratio / 'x' format
    return _fx(value)


def _score_blocks(global_status: dict, period_label: str, dashboard_url: str = "") -> list:
    """Build Slack Block Kit fragments for the 'Score de la semaine/du mois' header.

    Lecture seule sur le résultat de global_status() — pas de modif logique.
    Position attendue : tout en haut du récap (avant le header existant).
    """
    if not global_status:
        return []

    total = global_status.get("total", 0) or 0
    green = global_status.get("green", 0) or 0
    orange = global_status.get("orange", 0) or 0
    red = global_status.get("red", 0) or 0
    excluded = global_status.get("excluded", 0) or 0
    score_pct = global_status.get("score_pct")
    top_alert = global_status.get("top_alert")

    blocks: list = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📊 Score {period_label}", "emoji": True},
        },
    ]

    if total > 0:
        score_str = f"{int(round(score_pct))} %" if score_pct is not None else "—"
        score_line = f"*{green} / {total} atteints* — {score_str}"
        counts_line = f"🟢 {green}    🟡 {orange}    🔴 {red}"
        if excluded > 0:
            counts_line += f"    _( {excluded} KPI{'s' if excluded > 1 else ''} hors comparaison )_"
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"{score_line}\n{counts_line}"},
        })
    else:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "_Pas d'objectif défini pour cette période._"},
        })

    if top_alert:
        label = top_alert.get("label", "")
        href = top_alert.get("href", "")
        value_str = _format_alert_value(top_alert.get("value"), top_alert.get("format", "number"))
        target_str = _format_alert_value(top_alert.get("target"), top_alert.get("format", "number"))
        pct = top_alert.get("pct_atteinte")
        pct_str = f"{int(round(pct))} %" if pct is not None else "—"
        link = f"<{dashboard_url}{href}|→ voir>" if dashboard_url and href else ""
        alert_text = (
            f"⚠️ *Plus en alerte : {label}*\n"
            f"{value_str} vs objectif {target_str} ({pct_str} atteint)"
        )
        if link:
            alert_text += f"   {link}"
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": alert_text},
        })

    blocks.append({"type": "divider"})
    return blocks


# ─── Slack Block Kit ─────────────────────────────────────────────────────────

def build_slack_blocks(data: dict, dashboard_url: str = "", notion_url: str = "") -> dict:
    week_start: date = data["week_start"]
    week_end: date = data["week_end"]
    week_num = week_start.isocalendar()[1]
    benefice = data["benefice_net"]

    s = f"{week_start.day} {MONTH_FR_SHORT[week_start.month]}"
    e = f"{week_end.day} {MONTH_FR_SHORT[week_end.month]} {week_end.year}"

    def field(label, kpi, fmt_fn):
        return {"type": "mrkdwn", "text": _line(label, kpi, fmt_fn)}

    def plain_field(label, value):
        return {"type": "mrkdwn", "text": _plain(label, value)}

    # Axe 1 : Score de la semaine en tête de récap
    score_section = _score_blocks(data.get("global_status") or {}, "de la semaine", dashboard_url)

    blocks = [
        *score_section,
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📊 Revue hebdo S{week_num} — {s} → {e}", "emoji": True}
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "Hello la team,\nvoici les performances de la semaine.\nJe vous laisse ajouter vos commentaires dans le Notion en prévision de notre point hebdo.\nBelle journée à tous :wave:"}
        },
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Funnel complet*"}},
        {
            "type": "section",
            "fields": [
                field("CA HT", data["ca_ht"], _fc),
                field("Volume leads", data["volume_leads"], _fn),
                field("Booking rate", data["booking_rate"], _fp),
                field("Closing net", data["closing_rate_net"], _fp),
            ]
        },
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Sales*"}},
        {
            "type": "section",
            "fields": [
                field("Calls passés", data["calls_completed"], _fn),
                field("No-show", data["no_show_rate"], _fp),
                field("ACV", data["acv"], _fc),
            ]
        },
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Paid Media*"}},
        {
            "type": "section",
            "fields": [
                plain_field("Budget", _fc(data["budget_paid"].get("value"))),
                field("CPL", data["cpl_paid"], _fc),
                field("ROAS", data["roas_paid"], _fx),
                plain_field(
                    f"Bénéfice net ({benefice.get('mtd_label', 'MTD')})",
                    _fc(benefice.get("benefice_net"), signed=True)
                ),
            ]
        },
        {"type": "divider"},
    ]

    links = []
    if dashboard_url:
        links.append(f"<{dashboard_url}/?period=last_week|→ Dashboard last week>")
    if notion_url:
        links.append(f"<{notion_url}|→ Ouvrir la revue Notion>")
    if links:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "  ".join(links)}
        })

    return {"blocks": blocks}


# ─── Main entry point ────────────────────────────────────────────────────────

def send_weekly_report() -> None:
    from .config import settings

    log.info("weekly_report_start")

    data = compute_last_week()
    week_start: date = data["week_start"]
    week_end: date = data["week_end"]

    # Mardi de la semaine courante — robuste peu importe le jour d'appel
    today = date.today()
    monday_this_week = today - timedelta(days=today.weekday())
    tuesday = monday_this_week + timedelta(days=1)
    current_week_num = monday_this_week.isocalendar()[1]
    notion_title = f"Revue équipe — S{current_week_num}"

    # Label de la période analysée (semaine précédente)
    week_num_data = week_start.isocalendar()[1]
    s = f"{week_start.day} {MONTH_FR_SHORT[week_start.month]}"
    e = f"{week_end.day} {MONTH_FR_SHORT[week_end.month]} {week_end.year}"
    data_period_label = f"S{week_num_data} ({s} → {e})"
    dashboard_url = f"{settings.DASHBOARD_URL}/?period=last_week" if settings.DASHBOARD_URL else ""

    # ── Notion d'abord pour récupérer l'URL à inclure dans Slack ──────────
    notion_url = ""
    if settings.NOTION_API_KEY and settings.NOTION_WEEKLY_DB_ID:
        try:
            notion_url = create_weekly_entry(
                token=settings.NOTION_API_KEY,
                database_id=settings.NOTION_WEEKLY_DB_ID,
                title=notion_title,
                week_start=tuesday,
                week_end=tuesday,
                meeting_date=tuesday,
                data_period_label=data_period_label,
                kpis=data,
                dashboard_url=dashboard_url,
            )
            log.info("weekly_report_notion", page_url=notion_url)
        except Exception as e:
            log.error("weekly_report_notion_error", error=str(e))
    else:
        log.warning("weekly_report_notion_skipped", reason="NOTION_API_KEY or DB_ID not set")

    # ── Slack avec lien Notion ─────────────────────────────────────────────
    if settings.SLACK_WEBHOOK_URL:
        payload = build_slack_blocks(data, dashboard_url, notion_url=notion_url)
        ok = post_webhook(settings.SLACK_WEBHOOK_URL, payload)
        log.info("weekly_report_slack", sent=ok)
    else:
        log.warning("weekly_report_slack_skipped", reason="SLACK_WEBHOOK_URL not set")

    log.info("weekly_report_done")


# ─── Rapport mensuel ──────────────────────────────────────────────────────────

def compute_last_month() -> dict:
    """Compute key KPIs for the full calendar month that just ended."""
    today = date.today()
    last_day = today.replace(day=1) - timedelta(days=1)   # dernier jour du mois précédent
    first_day = last_day.replace(day=1)                    # 1er jour du mois précédent

    p = Period(start=first_day, end=last_day, label="Mois dernier", granularity="monthly")
    comp_end = first_day - timedelta(days=1)
    comp = Period(start=comp_end.replace(day=1), end=comp_end, label="Mois précédent", granularity="monthly")

    return {
        "month_start": first_day,
        "month_end":   last_day,
        "ca_ht":            kpi_module.ca_ht(p, comp),
        "volume_leads":     kpi_module.volume_leads(p, comp),
        "volume_leads_paid":kpi_module.volume_leads_paid(p, comp),
        "booking_rate":     kpi_module.booking_rate(p, comp),
        "closing_rate_net": kpi_module.closing_rate_net(p, comp),
        "no_show_rate":     kpi_module.no_show_rate(p, comp),
        "calls_completed":  kpi_module.calls_completed(p, comp),
        "acv":              kpi_module.acv(p, comp),
        "cpl_paid":         kpi_module.cpl_paid(p, comp),
        "roas_paid":        kpi_module.roas_paid(p, comp),
        "budget_paid":      kpi_module.budget_paid(p, comp),
        "benefice_net":     kpi_module.benefice_net_for_period(first_day, last_day),
        # Axe 1 : score & top alert sur la même période (lecture seule, pas de modif logique)
        "global_status":    kpi_module.global_status(p),
    }


def build_slack_blocks_monthly(data: dict, dashboard_url: str = "") -> dict:
    month_start: date = data["month_start"]
    month_end:   date = data["month_end"]
    benefice = data["benefice_net"]
    month_label = f"{MONTH_FR[month_start.month].capitalize()} {month_end.year}"

    def field(label, kpi, fmt_fn):
        return {"type": "mrkdwn", "text": _line(label, kpi, fmt_fn)}

    def plain_field(label, value):
        return {"type": "mrkdwn", "text": _plain(label, value)}

    # Axe 1 : Score du mois en tête de récap
    score_section = _score_blocks(data.get("global_status") or {}, "du mois", dashboard_url)

    blocks = [
        *score_section,
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📅 Revue mensuelle — {month_label}", "emoji": True}
        },
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Funnel complet*"}},
        {
            "type": "section",
            "fields": [
                field("CA HT", data["ca_ht"], _fc),
                field("Volume leads", data["volume_leads"], _fn),
                field("Booking rate", data["booking_rate"], _fp),
                field("Closing net", data["closing_rate_net"], _fp),
            ]
        },
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Sales*"}},
        {
            "type": "section",
            "fields": [
                field("Calls passés", data["calls_completed"], _fn),
                field("No-show", data["no_show_rate"], _fp),
                field("ACV", data["acv"], _fc),
            ]
        },
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Paid Media*"}},
        {
            "type": "section",
            "fields": [
                plain_field("Budget", _fc(data["budget_paid"].get("value"))),
                field("CPL", data["cpl_paid"], _fc),
                field("ROAS", data["roas_paid"], _fx),
                plain_field(
                    f"Bénéfice net ({month_label})",
                    _fc(benefice.get("benefice_net"), signed=True)
                ),
            ]
        },
    ]

    if dashboard_url:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn",
                     "text": f"<{dashboard_url}/?period=last_month|→ Voir le dashboard last month>"}
        })

    return {"blocks": blocks}


def send_monthly_report() -> None:
    from .config import settings

    log.info("monthly_report_start")

    data = compute_last_month()
    month_start: date = data["month_start"]
    month_end:   date = data["month_end"]
    month_label = f"{MONTH_FR[month_start.month].capitalize()} {month_end.year}"
    notion_title = f"Revue mensuelle — {month_label}"

    # ── Slack ──────────────────────────────────────────────────────────────
    if settings.SLACK_WEBHOOK_URL:
        payload = build_slack_blocks_monthly(data, settings.DASHBOARD_URL)
        ok = post_webhook(settings.SLACK_WEBHOOK_URL, payload)
        log.info("monthly_report_slack", sent=ok)
    else:
        log.warning("monthly_report_slack_skipped", reason="SLACK_WEBHOOK_URL not set")

    # ── Notion ─────────────────────────────────────────────────────────────
    if settings.NOTION_API_KEY and settings.NOTION_WEEKLY_DB_ID:
        dashboard_url = (
            f"{settings.DASHBOARD_URL}/?period=last_month" if settings.DASHBOARD_URL else ""
        )
        try:
            page_url = create_weekly_entry(
                token=settings.NOTION_API_KEY,
                database_id=settings.NOTION_WEEKLY_DB_ID,
                title=notion_title,
                week_start=month_start,
                week_end=month_end,
                kpis=data,
                dashboard_url=dashboard_url,
            )
            log.info("monthly_report_notion", page_url=page_url)
        except Exception as e:
            log.error("monthly_report_notion_error", error=str(e))
    else:
        log.warning("monthly_report_notion_skipped", reason="NOTION_API_KEY or DB_ID not set")

    log.info("monthly_report_done")
