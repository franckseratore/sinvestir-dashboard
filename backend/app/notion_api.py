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
        "children": _page_blocks(kpis, week_start, week_end, meeting_date=meeting_date),
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


def _page_blocks(kpis: dict, week_start: date, week_end: date, meeting_date: Optional[date] = None) -> list:
    week_num_data = week_start.isocalendar()[1]
    start_str = week_start.strftime("%d/%m/%Y")
    end_str = week_end.strftime("%d/%m/%Y")
    meeting_str = meeting_date.strftime("%d/%m/%Y") if meeting_date else ""
    benefice = kpis.get("benefice_net", {})

    blocks = [
        # ── En-tête ──────────────────────────────────────────────────────────
        _callout(
            f"KPIs auto-générés depuis le dashboard S'investir · Données S{week_num_data} ({start_str} → {end_str})"
            + (f" · Réunion du {meeting_str}" if meeting_str else ""),
            emoji="📊",
        ),
        _callout(
            "⏱ 45 min — Vue d'ensemble 10' · Sales 10' · Paid Media 10' · Roadmap 10' · Clôture 5'",
            emoji="⏱",
            color="blue_background",
        ),
        _divider(),

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
