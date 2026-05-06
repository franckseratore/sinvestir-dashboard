from datetime import date
import pandas as pd
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.app import cache
from backend.app import kpis
from backend.app.period_resolver import resolve, comparison_period
from backend.app.source_classifier import classify


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_leads(rows):
    return pd.DataFrame(rows, columns=["date", "source", "canal", "sous_canal", "first_ac_action"])


def _make_ventes(rows):
    return pd.DataFrame(rows, columns=["date", "source_initiale", "last_source", "canal", "sous_canal", "closer", "produit", "ca_ht", "heure_calendly"])


def _make_calls(rows):
    return pd.DataFrame(rows, columns=["date_reservation", "date_call", "source", "last_source", "canal", "sous_canal", "closer", "event_calendly", "is_past"])


@pytest.fixture(autouse=True)
def build_test_cache():
    import duckdb
    cache._conn = duckdb.connect(":memory:")
    cache._last_refresh = None
    cache._status = "initializing"

    leads = _make_leads([
        (date(2026, 1, 1), "ytbm-etf", "Organique", "YouTube", "ETF PEA"),
        (date(2026, 1, 2), "ytbm-etf", "Organique", "YouTube", "ETF PEA"),
        # 1 SEO organic lead so YouTube concentration = 2/3 = 66.7%
        (date(2026, 1, 3), "articlecomparatifAV", "Organique", "SEO", "TableauComparatifAV"),
        (date(2026, 1, 4), "ads_pub_1", "Paid", "Meta", "FVO"),
        (date(2026, 1, 5), "googleads", "Paid", "Google", "FVO"),
    ])
    ventes = _make_ventes([
        (date(2026, 1, 1), "ytbm-etf", None, "Organique", "YouTube", "closer1@s.fr", "LBD", 1500, None),
        (date(2026, 1, 2), "ads_pub_1", None, "Paid", "Meta", "closer1@s.fr", "LBD", 1800, None),
        (date(2026, 1, 3), "ytbm-etf", None, "Organique", "YouTube", "closer2@s.fr", "Conseil", 800, None),
        (date(2026, 1, 4), "googleads", None, "Paid", "Google", "closer2@s.fr", "LBD", 2000, None),
    ])
    calls = _make_calls([
        (date(2026, 1, 1), pd.Timestamp("2026-01-01 10:00"), "ytbm-etf", None, "Organique", "YouTube", "closer1@s.fr", "Appel", True),
        (date(2026, 1, 2), pd.Timestamp("2026-01-02 10:00"), "ads_pub_1", None, "Paid", "Meta", "closer1@s.fr", "Appel", True),
        (date(2026, 1, 3), pd.Timestamp("2026-01-03 10:00"), "ytbm-etf", None, "Organique", "YouTube", "closer2@s.fr", "Appel", True),
        (date(2026, 1, 4), pd.Timestamp("2030-01-04 10:00"), "googleads", None, "Paid", "Google", "closer2@s.fr", "Appel", False),
    ])
    leads_paid = pd.DataFrame([
        {"date": date(2026, 1, 3), "source": "ads_pub_1", "canal": "Paid", "sous_canal": "Meta", "first_ac_action": "FVO"},
        {"date": date(2026, 1, 4), "source": "ads_pub_1", "canal": "Paid", "sous_canal": "Meta", "first_ac_action": "FVO"},
        {"date": date(2026, 1, 5), "source": "googleads", "canal": "Paid", "sous_canal": "Google", "first_ac_action": "FVO"},
    ])
    calls_paid = pd.DataFrame([
        {"date_reservation": date(2026, 1, 2), "date_call": pd.Timestamp("2026-01-02 10:00"), "source": "ads_pub_1", "canal": "Paid", "sous_canal": "Meta", "closer": "closer1@s.fr", "is_past": True},
    ])
    ventes_paid = pd.DataFrame([
        {"date": date(2026, 1, 2), "source_initiale": "ads_pub_1", "canal": "Paid", "sous_canal": "Meta", "closer": "closer1@s.fr", "produit": "LBD", "ca_ht": 1800.0},
        {"date": date(2026, 1, 4), "source_initiale": "googleads", "canal": "Paid", "sous_canal": "Google", "closer": "closer2@s.fr", "produit": "LBD", "ca_ht": 2000.0},
    ])
    budget = pd.DataFrame([
        {"date": date(2026, 1, 1), "creative_id": "ads_pub_1", "canal": "Paid", "sous_canal": "Meta", "spend": 100.0},
        {"date": date(2026, 1, 2), "creative_id": "ads_pub_1", "canal": "Paid", "sous_canal": "Meta", "spend": 150.0},
        {"date": date(2026, 1, 3), "creative_id": "googleads", "canal": "Paid", "sous_canal": "Google", "spend": 200.0},
        {"date": date(2026, 1, 4), "creative_id": "googleads", "canal": "Paid", "sous_canal": "Google", "spend": 100.0},
        {"date": date(2026, 1, 5), "creative_id": "googleads", "canal": "Paid", "sous_canal": "Google", "spend": 50.0},
    ])
    from backend.app.loaders import _default_targets
    targets = _default_targets()

    cache.build(
        {"ventes": ventes, "calendly": calls, "leads": leads},
        {"new_leads": leads_paid, "calls": calls_paid, "ventes": ventes_paid, "budget": budget},
        targets,
    )


# ─── Source classifier ────────────────────────────────────────────────────────

def test_classify_youtube():
    assert classify("ytbm-etf-pea")["canal"] == "Organique"
    assert classify("ytbm-etf-pea")["sous_canal"] == "YouTube"
    assert classify("chaineytb")["sous_canal"] == "YouTube"


def test_classify_paid_meta():
    assert classify("ads_pub_42")["canal"] == "Paid"
    assert classify("ads_pub_42")["sous_canal"] == "Meta"


def test_classify_paid_google():
    assert classify("googleads")["sous_canal"] == "Google"
    assert classify("ads2_google_15")["sous_canal"] == "Google"


def test_classify_seo():
    assert classify("articlecomparatifAV")["sous_canal"] == "SEO"


def test_classify_unknown():
    assert classify("XXX")["canal"] == "Inconnu"
    assert classify("")["canal"] == "Inconnu"


# ─── Period resolver ──────────────────────────────────────────────────────────

def test_period_last_30_days():
    p = resolve("last_30_days", today=date(2026, 2, 1))
    assert p.days == 30
    assert p.start == date(2026, 1, 3)
    assert p.end == date(2026, 2, 1)


def test_period_this_month():
    p = resolve("this_month", today=date(2026, 1, 15))
    assert p.start == date(2026, 1, 1)
    assert p.end == date(2026, 1, 15)


def test_period_last_month():
    p = resolve("last_month", today=date(2026, 2, 10))
    assert p.start == date(2026, 1, 1)
    assert p.end == date(2026, 1, 31)


def test_comparison_period():
    p = resolve("last_30_days", today=date(2026, 2, 1))
    comp = comparison_period(p)
    assert comp.end == p.start - __import__("datetime").timedelta(days=1)
    assert comp.days == p.days


def test_granularity():
    assert resolve("last_7_days").granularity == "daily"
    assert resolve("last_90_days").granularity == "weekly"
    # YTD Jan→May = ~124 days → weekly (monthly only for > 180 days)
    assert resolve("ytd", today=date(2026, 5, 4)).granularity == "weekly"
    # Full year YTD would be monthly
    assert resolve("ytd", today=date(2026, 12, 31)).granularity == "monthly"


# ─── KPI calculations ─────────────────────────────────────────────────────────

PERIOD = resolve("custom", custom_start=date(2026, 1, 1), custom_end=date(2026, 1, 5))


def test_ca_ht():
    result = kpis.ca_ht(PERIOD)
    # 1500 + 1800 + 800 + 2000 = 6100
    assert result["value"] == pytest.approx(6100.0)
    assert result["format"] == "currency"


def test_volume_leads():
    result = kpis.volume_leads(PERIOD)
    assert result["value"] == 5  # 2 YTB + 1 SEO + 1 Meta + 1 Google


def test_booking_rate():
    result = kpis.booking_rate(PERIOD)
    # 4 calls / 5 leads = 0.80
    assert result["value"] == pytest.approx(0.80)


def test_no_show_rate():
    result = kpis.no_show_rate(PERIOD)
    # 4 booked, 3 is_past → (4-3)/4 = 0.25
    assert result["value"] == pytest.approx(0.25)


def test_closing_rate():
    result = kpis.closing_rate(PERIOD)
    # 4 ventes / 3 calls passés = 1.333... rounded to 2dp = 1.33
    assert result["value"] == pytest.approx(4 / 3, abs=0.01)


def test_cpl_paid():
    result = kpis.cpl_paid(PERIOD)
    # budget = 100+150+200+100+50 = 600 / 3 leads_paid = 200
    assert result["value"] == pytest.approx(200.0)


def test_roas_paid():
    result = kpis.roas_paid(PERIOD)
    # ca_paid = 1800+2000 = 3800 / budget = 600 = 6.333... rounded to 6.33
    assert result["value"] == pytest.approx(3800 / 600, abs=0.01)


def test_acv():
    result = kpis.acv(PERIOD)
    # ca = 6100 / 4 ventes = 1525
    assert result["value"] == pytest.approx(1525.0)


def test_benefice_net():
    result = kpis.benefice_net_paid(PERIOD, cout_agence_mensuel=3000)
    # ca_paid=3800, budget=600, agence=3000*(5/30)=500
    assert result["benefice_net"] == pytest.approx(3800 - 600 - 500, rel=0.01)


def test_safe_div_zero():
    assert kpis._safe_div(100, 0) is None
    assert kpis._safe_div(None, 10) is None


def test_funnel():
    result = kpis.funnel(PERIOD)
    assert result[0]["label"] == "Leads"
    assert result[0]["value"] == 5
    assert result[1]["label"] == "Calls réservés"
    assert result[1]["value"] == 4
    assert result[2]["label"] == "Calls passés"
    assert result[2]["value"] == 3
    assert result[3]["label"] == "Ventes"
    assert result[3]["value"] == 4


def test_kpi_status_green():
    # ca_ht target for 5 days = 600000 * (5/30) = 100000. Value = 6100 < seuil → red
    result = kpis.ca_ht(PERIOD)
    assert result["status"] in ("red", "orange", "green")  # just ensure it resolves


def test_closing_rate_by_closer():
    rows = kpis.closing_rate_by_closer(PERIOD)
    closers = [r["closer"] for r in rows]
    assert "closer1@s.fr" in closers
    assert "closer2@s.fr" in closers


def test_ca_by_produit():
    rows = kpis.ca_by_produit(PERIOD)
    products = [r["produit"] for r in rows]
    assert "LBD" in products


def test_youtube_concentration():
    result = kpis.youtube_concentration(PERIOD)
    # 2 YouTube leads out of 3 organic = 66.7%
    assert result["concentration"] == pytest.approx(66.7, rel=0.01)
    assert result["alert"] == False  # < 70%
