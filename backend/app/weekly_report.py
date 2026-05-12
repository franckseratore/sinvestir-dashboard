"""
Rapport hebdo automatique — chaque lundi 09h00 (Europe/Paris).

Audience: DM Slack interne Franck+Léo (env SLACK_WEBHOOK_INTERNAL). Préparation
de la revue équipe du mardi avec Matthieu/Mohammed/Léo. Contenu en 2 sections :
  1. Performances semaine passée vs semaine d'avant (S vs S-1)
  2. Pacing du mois en cours (MTD + projection fin de mois)
La page Notion correspondante est créée pour la réunion du mardi.

Le récap mensuel (1er du mois 9h Paris) reste sur SLACK_WEBHOOK_URL → #marketing.
"""
from calendar import monthrange
from datetime import date, timedelta
from typing import Optional, Tuple
import structlog

from . import kpis as kpi_module
from .kpis import _get_target  # accès au target_mensuelle non-prorate pour la projection
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


# ─── MTD + projection fin de mois ────────────────────────────────────────────

# KPIs additifs : on peut extrapoler linéairement la valeur MTD jusqu'à la fin du mois.
# Les KPIs de ratio (booking_rate, closing_rate, no_show, ACV, CPL, ROAS) ne se projettent
# pas linéairement — on les affiche en MTD sans extrapolation.
_ADDITIVE_KPIS = ("ca_ht", "volume_leads", "volume_leads_paid", "calls_completed", "budget_paid")


def _projection_eom(value: Optional[float], today: date) -> Optional[float]:
    """Extrapolation linéaire MTD → fin de mois : value * total_days / days_elapsed."""
    if value is None:
        return None
    days_in_month = monthrange(today.year, today.month)[1]
    days_elapsed = today.day
    if days_elapsed <= 0:
        return None
    return value * days_in_month / days_elapsed


def _projection_pct_atteinte(projection: Optional[float], monthly_target: Optional[float], sens: Optional[str]) -> Tuple[Optional[float], str]:
    """Réutilise la logique de _compute_pct_atteinte mais sur projection vs target NON-prorata."""
    if projection is None or monthly_target is None or monthly_target == 0 or not sens:
        return None, "unknown"
    if sens == "Haut":
        pct = (projection / monthly_target) * 100
    else:
        pct = 999.0 if projection == 0 else (monthly_target / projection) * 100
    pct = min(pct, 999.0)
    if pct >= 100:
        st = "green"
    elif pct >= 80:
        st = "orange"
    else:
        st = "red"
    return round(pct, 1), st


def compute_mtd_pacing() -> dict:
    """Compute KPIs from 1st of month → today, with projection on additive KPIs.

    Pour chaque KPI additif, on ajoute :
      - projection : valeur extrapolée à la fin du mois courant
      - monthly_target : target_mensuelle pleine (non prorata)
      - projection_pct, projection_status : pacing vs target_mensuelle
    """
    today = date.today()
    month_start = today.replace(day=1)
    days_in_month = monthrange(today.year, today.month)[1]
    p = Period(start=month_start, end=today, label="Mois en cours (MTD)", granularity="daily")

    raw = {
        "ca_ht":            kpi_module.ca_ht(p, None),
        "volume_leads":     kpi_module.volume_leads(p, None),
        "volume_leads_paid":kpi_module.volume_leads_paid(p, None),
        "booking_rate":     kpi_module.booking_rate(p, None),
        "closing_rate_net": kpi_module.closing_rate_net(p, None),
        "no_show_rate":     kpi_module.no_show_rate(p, None),
        "calls_completed":  kpi_module.calls_completed(p, None),
        "acv":              kpi_module.acv(p, None),
        "cpl_paid":         kpi_module.cpl_paid(p, None),
        "roas_paid":        kpi_module.roas_paid(p, None),
        "budget_paid":      kpi_module.budget_paid(p, None),
        "benefice_net":     kpi_module.benefice_net_paid(),
    }

    for indicateur in _ADDITIVE_KPIS:
        kpi = raw.get(indicateur) or {}
        value = kpi.get("value")
        projection = _projection_eom(value, today)
        t = _get_target(indicateur) or {}
        monthly_target = t.get("target")
        sens = t.get("sens")
        proj_pct, proj_st = _projection_pct_atteinte(projection, monthly_target, sens)
        kpi["projection"] = round(projection, 2) if projection is not None else None
        kpi["monthly_target"] = monthly_target
        kpi["projection_pct"] = proj_pct
        kpi["projection_status"] = proj_st

    return {
        "month_start":  month_start,
        "month_end":    today,
        "days_elapsed": today.day,
        "days_in_month": days_in_month,
        **raw,
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


def _score_blocks(global_status: dict, period_label: str, dashboard_url: str = "", period_filter: str = "") -> list:
    """Build Slack Block Kit fragments for the 'Score de la semaine/du mois' header.

    Lecture seule sur le résultat de global_status() — pas de modif logique.
    Position attendue : tout en haut du récap (avant le header existant).

    `dashboard_url` doit être l'URL de base (sans query string). Si `period_filter`
    est fourni, on append `?period=<period_filter>` au href du top_alert link
    pour que le clic atterrisse sur la page filtrée sur la période du récap.
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
        if dashboard_url and href:
            if period_filter:
                separator = "&" if "?" in href else "?"
                link = f"<{dashboard_url}{href}{separator}period={period_filter}|→ voir>"
            else:
                link = f"<{dashboard_url}{href}|→ voir>"
        else:
            link = ""
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

_KPI_FMT = {
    "ca_ht":             ("CA HT",        "currency"),
    "volume_leads":      ("Leads",        "number"),
    "volume_leads_paid": ("Leads paid",   "number"),
    "calls_completed":   ("Calls passés", "number"),
    "budget_paid":       ("Budget paid",  "currency"),
}


def _format_value(value, fmt: str) -> str:
    if value is None:
        return "—"
    if fmt == "currency":
        return _fc(value)
    if fmt == "percent":
        return _fp(value)
    return _fn(value)


def _mtd_pacing_line(label: str, kpi: dict, fmt: str) -> str:
    """One-line MTD pacing summary : `🟢 *CA HT* — 120k MTD → ~310k EoM (62% target)`."""
    em = _em(kpi.get("projection_status") or kpi.get("pct_status") or "")
    mtd_str = _format_value(kpi.get("value"), fmt)
    proj_str = _format_value(kpi.get("projection"), fmt)
    target_str = _format_value(kpi.get("monthly_target"), fmt)
    pct = kpi.get("projection_pct")
    pct_str = f" ({int(round(pct))}% target)" if pct is not None else ""
    return f"{em} *{label}*\n{mtd_str} MTD → ~{proj_str} fin de mois{pct_str}\nObjectif mensuel : {target_str}"


def build_slack_blocks(weekly: dict, mtd: dict, dashboard_url: str = "", dashboard_url_filtered: str = "", notion_url: str = "") -> dict:
    """Build the Monday DM payload : 2 sections (S vs S-1 + MTD pacing)."""
    week_start: date = weekly["week_start"]
    week_end: date = weekly["week_end"]
    week_num = week_start.isocalendar()[1]
    benefice_w = weekly["benefice_net"]
    benefice_m = mtd["benefice_net"]
    days_elapsed = mtd["days_elapsed"]
    days_in_month = mtd["days_in_month"]

    s = f"{week_start.day} {MONTH_FR_SHORT[week_start.month]}"
    e = f"{week_end.day} {MONTH_FR_SHORT[week_end.month]} {week_end.year}"
    month_label = f"{MONTH_FR[mtd['month_start'].month].capitalize()} {mtd['month_end'].year}"

    def field(label, kpi, fmt_fn):
        return {"type": "mrkdwn", "text": _line(label, kpi, fmt_fn)}

    def plain_field(label, value):
        return {"type": "mrkdwn", "text": _plain(label, value)}

    # Score header (lecture seule sur global_status hebdo)
    score_section = _score_blocks(weekly.get("global_status") or {}, "de la semaine", dashboard_url, period_filter="last_week")

    blocks: list = [
        *score_section,
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📊 Récap hebdo S{week_num} — {s} → {e}", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": (
                "Hello Léo,\n"
                "voici les performances de la semaine passée (vs S-1) et où on en est sur le mois en cours.\n"
                "On en discute mardi en revue équipe — la page Notion est dispo ci-dessous."
            )},
        },
        {"type": "divider"},

        # ── Section 1 : S vs S-1 ─────────────────────────────────────────────
        {"type": "section", "text": {"type": "mrkdwn", "text": "*1️⃣ Performances semaine vs semaine d'avant*"}},
        {
            "type": "section",
            "fields": [
                field("CA HT", weekly["ca_ht"], _fc),
                field("Volume leads", weekly["volume_leads"], _fn),
                field("Booking rate", weekly["booking_rate"], _fp),
                field("Closing net", weekly["closing_rate_net"], _fp),
            ],
        },
        {
            "type": "section",
            "fields": [
                field("Calls passés", weekly["calls_completed"], _fn),
                field("No-show", weekly["no_show_rate"], _fp),
                field("ACV", weekly["acv"], _fc),
                plain_field(
                    f"Bénéfice net ({benefice_w.get('mtd_label', 'MTD')})",
                    _fc(benefice_w.get("benefice_net"), signed=True),
                ),
            ],
        },
        {
            "type": "section",
            "fields": [
                plain_field("Budget paid", _fc(weekly["budget_paid"].get("value"))),
                field("CPL paid", weekly["cpl_paid"], _fc),
                field("ROAS paid", weekly["roas_paid"], _fx),
            ],
        },
        {"type": "divider"},

        # ── Section 2 : Pacing du mois (MTD + projection) ────────────────────
        {"type": "section", "text": {"type": "mrkdwn", "text": (
            f"*2️⃣ Pacing du mois — {month_label}*\n"
            f"_MTD au jour {days_elapsed} / {days_in_month}. Projection = extrapolation linéaire._"
        )}},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": _mtd_pacing_line(label, mtd[k], fmt)}
                for k, (label, fmt) in _KPI_FMT.items()
            ],
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": (
            "*Indicateurs de qualité (MTD, pas de projection linéaire)*\n"
            f"Booking {_fp(mtd['booking_rate'].get('value'))}  ·  "
            f"Closing net {_fp(mtd['closing_rate_net'].get('value'))}  ·  "
            f"No-show {_fp(mtd['no_show_rate'].get('value'))}  ·  "
            f"ACV {_fc(mtd['acv'].get('value'))}  ·  "
            f"CPL paid {_fc(mtd['cpl_paid'].get('value'))}  ·  "
            f"ROAS paid {_fx(mtd['roas_paid'].get('value'))}\n"
            f"Bénéfice net ({benefice_m.get('mtd_label', 'MTD')}) : {_fc(benefice_m.get('benefice_net'), signed=True)}"
        )}},
        {"type": "divider"},
    ]

    links = []
    if dashboard_url_filtered:
        links.append(f"<{dashboard_url_filtered}|→ Dashboard semaine dernière>")
    if dashboard_url:
        links.append(f"<{dashboard_url}/?period=this_month|→ Dashboard mois en cours>")
    if notion_url:
        links.append(f"<{notion_url}|→ Page Notion de la revue mardi>")
    if links:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "  ".join(links)},
        })

    return {"blocks": blocks}


# ─── Main entry point ────────────────────────────────────────────────────────

def send_weekly_report() -> None:
    from .config import settings

    log.info("weekly_report_start")

    weekly = compute_last_week()
    mtd = compute_mtd_pacing()
    week_start: date = weekly["week_start"]
    week_end: date = weekly["week_end"]

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
    dashboard_base = settings.DASHBOARD_URL.rstrip("/") if settings.DASHBOARD_URL else ""
    dashboard_url_filtered = f"{dashboard_base}/?period=last_week" if dashboard_base else ""

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
                kpis=weekly,
                mtd_kpis=mtd,
                dashboard_url=dashboard_url_filtered,
            )
            log.info("weekly_report_notion", page_url=notion_url)
        except Exception as e:
            log.error("weekly_report_notion_error", error=str(e))
    else:
        log.warning("weekly_report_notion_skipped", reason="NOTION_API_KEY or DB_ID not set")

    # ── Slack DM Franck+Léo (webhook interne) ─────────────────────────────
    # Le webhook public marketing (SLACK_WEBHOOK_URL) reste réservé au récap
    # mensuel. Si SLACK_WEBHOOK_INTERNAL n'est pas défini, on ne tombe PAS en
    # fallback sur le webhook public — préfère un silence visible (warning logs)
    # à un envoi accidentel dans #marketing.
    if settings.SLACK_WEBHOOK_INTERNAL:
        payload = build_slack_blocks(weekly, mtd, dashboard_base, dashboard_url_filtered, notion_url=notion_url)
        ok = post_webhook(settings.SLACK_WEBHOOK_INTERNAL, payload)
        log.info("weekly_report_slack", sent=ok, target="internal_dm")
    else:
        log.warning("weekly_report_slack_skipped", reason="SLACK_WEBHOOK_INTERNAL not set")

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
    score_section = _score_blocks(data.get("global_status") or {}, "du mois", dashboard_url, period_filter="last_month")

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
