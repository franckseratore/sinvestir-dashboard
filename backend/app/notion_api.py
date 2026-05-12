import json
import urllib.request
import urllib.error
from datetime import date
from typing import Optional
import structlog

log = structlog.get_logger()

_BASE = "https://api.notion.com/v1"
_NOTION_VERSION = "2022-06-28"


def _request(method: str, path: str, token: str, payload: Optional[dict] = None) -> dict:
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"{_BASE}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Notion-Version", _NOTION_VERSION)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        log.error("notion_api_error", path=path, status=e.code, body=body[:400])
        raise RuntimeError(f"Notion API {e.code}: {body[:200]}")


def create_weekly_entry(
    token: str,
    database_id: str,
    title: str,
    week_start: date,
    week_end: date,
    kpis: dict,
    dashboard_url: str = "",
    meeting_date: Optional[date] = None,
    data_period_label: str = "",
    mtd_kpis: Optional[dict] = None,
) -> str:
    """Create a page in the Revues hebdo database. Returns the page URL."""
    payload = {
        "parent": {"database_id": database_id},
        "properties": {
            "Titre": {"title": [{"text": {"content": title}}]},
            "Date": {"date": {"start": str(week_start), "end": str(week_end)}},
            "Statut": {"select": {"name": "À venir"}},
            "Participants": {"multi_select": [
                {"name": "Matthieu"}, {"name": "Franck"},
                {"name": "Mohammed"}, {"name": "Léo"},
            ]},
            **({"Lien reporting hebdo": {"url": dashboard_url}} if dashboard_url else {}),
            **({"Période analysée": {"rich_text": [{"text": {"content": data_period_label}}]}} if data_period_label else {}),
        },
        "children": _page_blocks(kpis, week_start, week_end, meeting_date=meeting_date, mtd_kpis=mtd_kpis),
    }
    result = _request("POST", "/pages", token, payload)
    return result.get("url", "")


# ─── Block builders ───────────────────────────────────────────────────────────

def _h(text: str, level: int = 2) -> dict:
    t = f"heading_{level}"
    return {"object": "block", "type": t, t: {
        "rich_text": [{"type": "text", "text": {"content": text}}]
    }}

def _bullet(text: str) -> dict:
    return {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {
        "rich_text": [{"type": "text", "text": {"content": text}}]
    }}

def _todo(text: str) -> dict:
    return {"object": "block", "type": "to_do", "to_do": {
        "checked": False,
        "rich_text": [{"type": "text", "text": {"content": text}}],
    }}

def _para(text: str, italic: bool = True, color: str = "gray") -> dict:
    return {"object": "block", "type": "paragraph", "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": text, "link": None},
                       "annotations": {"italic": italic, "color": color}}]
    }}

def _divider() -> dict:
    return {"object": "block", "type": "divider", "divider": {}}

def _callout(text: str, emoji: str = "📊", color: str = "gray_background") -> dict:
    return {"object": "block", "type": "callout", "callout": {
        "icon": {"type": "emoji", "emoji": emoji},
        "color": color,
        "rich_text": [{"type": "text", "text": {"content": text}}],
    }}

def _comment_block() -> list:
    """Empty comment block to fill during the meeting."""
    return [
        _h("💬 Commentaires", 3),
        _para("→ À compléter en réunion"),
    ]


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


def _kpi_line(label: str, kpi: dict, fmt_fn) -> str:
    val = fmt_fn(kpi.get("value"))
    delta = _delta(kpi)
    em = _em(kpi.get("status", ""))
    return f"{em} {label} : {val}{delta}"


def _format_alert_value(value, fmt: str) -> str:
    if value is None:
        return "—"
    if fmt == "currency":
        return _fc(value)
    if fmt == "percent":
        return _fp(value)
    if fmt == "number":
        return _fn(value)
    return _fx(value)


def _score_callout_text(global_status: dict) -> Optional[str]:
    """Build a single-line summary text for the Score callout at the top of the Notion page.

    Lecture seule sur global_status() — pas de modif logique.
    Returns None if no objectives are defined for the period.
    """
    if not global_status:
        return None
    total = global_status.get("total", 0) or 0
    if total == 0:
        return "Pas d'objectif défini pour cette période."

    green = global_status.get("green", 0) or 0
    orange = global_status.get("orange", 0) or 0
    red = global_status.get("red", 0) or 0
    excluded = global_status.get("excluded", 0) or 0
    score_pct = global_status.get("score_pct")
    top_alert = global_status.get("top_alert")

    score_str = f"{int(round(score_pct))} %" if score_pct is not None else "—"
    parts = [
        f"Score : {green} / {total} atteints — {score_str}",
        f"🟢 {green}  •  🟡 {orange}  •  🔴 {red}",
    ]
    if excluded > 0:
        parts.append(f"({excluded} KPI{'s' if excluded > 1 else ''} hors comparaison)")

    line = "   ·   ".join(parts)

    if top_alert:
        label = top_alert.get("label", "")
        fmt = top_alert.get("format", "number")
        value_str = _format_alert_value(top_alert.get("value"), fmt)
        target_str = _format_alert_value(top_alert.get("target"), fmt)
        pct = top_alert.get("pct_atteinte")
        pct_str = f"{int(round(pct))} %" if pct is not None else "—"
        line += f"\n⚠️ Plus en alerte : {label} — {value_str} vs objectif {target_str} ({pct_str} atteint)"

    return line


_MTD_ADDITIVE_LABELS = [
    ("ca_ht",             "CA HT",        "currency"),
    ("volume_leads",      "Leads",        "number"),
    ("volume_leads_paid", "Leads paid",   "number"),
    ("calls_completed",   "Calls passés", "number"),
    ("budget_paid",       "Budget paid",  "currency"),
]


def _format_kpi_value(value, fmt: str) -> str:
    if value is None:
        return "—"
    if fmt == "currency":
        return _fc(value)
    if fmt == "percent":
        return _fp(value)
    return _fn(value)


def _mtd_pacing_blocks(mtd: dict) -> list:
    """Section "Pacing du mois" insérée en tête du body pour la revue mardi."""
    if not mtd:
        return []
    month_start = mtd.get("month_start")
    month_end = mtd.get("month_end")
    days_elapsed = mtd.get("days_elapsed")
    days_in_month = mtd.get("days_in_month")
    benefice = mtd.get("benefice_net", {}) or {}

    bullets: list = []
    for indicateur, label, fmt in _MTD_ADDITIVE_LABELS:
        kpi = mtd.get(indicateur) or {}
        em = _em(kpi.get("projection_status") or kpi.get("pct_status") or "")
        mtd_str = _format_kpi_value(kpi.get("value"), fmt)
        proj_str = _format_kpi_value(kpi.get("projection"), fmt)
        target_str = _format_kpi_value(kpi.get("monthly_target"), fmt)
        pct = kpi.get("projection_pct")
        pct_str = f" — {int(round(pct))}% de l'objectif" if pct is not None else ""
        bullets.append(_bullet(
            f"{em} {label} : {mtd_str} MTD → ~{proj_str} fin de mois{pct_str} "
            f"(objectif mensuel : {target_str})"
        ))

    rates_line = (
        f"Booking {_fp((mtd.get('booking_rate') or {}).get('value'))}  ·  "
        f"Closing net {_fp((mtd.get('closing_rate_net') or {}).get('value'))}  ·  "
        f"No-show {_fp((mtd.get('no_show_rate') or {}).get('value'))}  ·  "
        f"ACV {_fc((mtd.get('acv') or {}).get('value'))}  ·  "
        f"CPL paid {_fc((mtd.get('cpl_paid') or {}).get('value'))}  ·  "
        f"ROAS paid {_fx((mtd.get('roas_paid') or {}).get('value'))}"
    )
    benefice_label = benefice.get("mtd_label", "MTD")
    benefice_line = f"Bénéfice net ({benefice_label}) : {_fc(benefice.get('benefice_net'), signed=True)}"

    period_label = ""
    if month_start and days_elapsed and days_in_month:
        period_label = (
            f"MTD au {month_end.strftime('%d/%m/%Y')} — jour {days_elapsed} / {days_in_month}. "
            f"Projection = extrapolation linéaire."
        )

    return [
        _h("📈 Pacing du mois — vue Matthieu / Mohammed"),
        _para(period_label) if period_label else _para(""),
        *bullets,
        _para(f"Indicateurs de qualité (MTD) — {rates_line}", italic=False, color="default"),
        _para(benefice_line, italic=False, color="default"),
        _divider(),
    ]


def _page_blocks(kpis: dict, week_start: date, week_end: date, meeting_date: Optional[date] = None, mtd_kpis: Optional[dict] = None) -> list:
    week_num_data = week_start.isocalendar()[1]
    start_str = week_start.strftime("%d/%m/%Y")
    end_str = week_end.strftime("%d/%m/%Y")
    meeting_str = meeting_date.strftime("%d/%m/%Y") if meeting_date else ""
    benefice = kpis.get("benefice_net", {})

    # Axe 1 : callout Score en haut de page (avant tout autre contenu)
    score_text = _score_callout_text(kpis.get("global_status") or {})
    score_callout: list = []
    if score_text:
        score_callout = [_callout(score_text, emoji="📊", color="gray_background")]

    blocks = [
        *score_callout,
        # ── En-tête ──────────────────────────────────────────────────────────
        _callout(
            f"KPIs auto-générés depuis le dashboard S'investir · Données S{week_num_data} ({start_str} → {end_str})"
            + (f" · Réunion du {meeting_str}" if meeting_str else ""),
            emoji="📊",
        ),
        _callout(
            "⏱ 45 min — Pacing du mois 10' · Vue d'ensemble 10' · Sales 5' · Paid Media 5' · Roadmap 10' · Clôture 5'",
            emoji="⏱",
            color="blue_background",
        ),
        _divider(),

        # ── Pacing du mois · 10 min (inséré pour la revue Matthieu/Mohammed) ─
        *(_mtd_pacing_blocks(mtd_kpis) if mtd_kpis else []),

        # ── Vue d'ensemble · 10 min ──────────────────────────────────────────
        _h("📊 Vue d'ensemble · 10 min"),
        _bullet(_kpi_line("CA HT", kpis.get("ca_ht", {}), _fc)),
        _bullet(_kpi_line("Volume leads", kpis.get("volume_leads", {}), _fn)),
        _bullet(_kpi_line("  dont Paid", kpis.get("volume_leads_paid", {}), _fn)),
        _bullet(_kpi_line("Booking rate", kpis.get("booking_rate", {}), _fp)),
        _bullet(_kpi_line("Closing net", kpis.get("closing_rate_net", {}), _fp)),
        *_comment_block(),
        _divider(),

        # ── Sales · 10 min ───────────────────────────────────────────────────
        _h("📞 Sales · 10 min"),
        _bullet(_kpi_line("Calls passés", kpis.get("calls_completed", {}), _fn)),
        _bullet(_kpi_line("No-show", kpis.get("no_show_rate", {}), _fp)),
        _bullet(_kpi_line("ACV", kpis.get("acv", {}), _fc)),
        *_comment_block(),
        _divider(),

        # ── Paid Media · 10 min ──────────────────────────────────────────────
        _h("💰 Paid Media · 10 min"),
        _bullet(_kpi_line("Budget", kpis.get("budget_paid", {}), _fc)),
        _bullet(_kpi_line("CPL", kpis.get("cpl_paid", {}), _fc)),
        _bullet(_kpi_line("ROAS", kpis.get("roas_paid", {}), _fx)),
        _bullet(f"Bénéfice net ({benefice.get('mtd_label', 'MTD')}) : {_fc(benefice.get('benefice_net'), signed=True)}"),
        *_comment_block(),
        _divider(),

        # ── Avancement roadmap macro · 10 min ────────────────────────────────
        _h("🗺️ Avancement roadmap macro · 10 min"),
        _para("Passer en revue les chantiers en cours et les blocages."),
        _todo(""),
        _todo(""),
        _todo(""),
        _divider(),

        # ── Décisions & clôture · 5 min ──────────────────────────────────────
        _h("✅ Décisions & clôture · 5 min"),
        _h("Décisions prises", 3),
        _para("→ À compléter en réunion"),
        _h("Actions à suivre", 3),
        _todo(""),
        _todo(""),
    ]
    return blocks
