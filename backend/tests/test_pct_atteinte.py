"""Tests pour le badge % atteint et le widget Score (Axe 1)."""
from datetime import date
import pandas as pd
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.app import cache
from backend.app import kpis
from backend.app.kpis import _compute_pct_atteinte, _scale_target
from backend.app.period_resolver import Period


# ─── Tests purs sur _compute_pct_atteinte ────────────────────────────────────

def test_pct_atteinte_haut_below_80():
    pct, st = _compute_pct_atteinte(value=70, target=100, sens="Haut")
    assert pct == 70.0
    assert st == "red"


def test_pct_atteinte_haut_orange_zone():
    pct, st = _compute_pct_atteinte(value=85, target=100, sens="Haut")
    assert pct == 85.0
    assert st == "orange"


def test_pct_atteinte_haut_green_at_target():
    pct, st = _compute_pct_atteinte(value=100, target=100, sens="Haut")
    assert pct == 100.0
    assert st == "green"


def test_pct_atteinte_haut_capped_at_999():
    # Un KPI à 200% atteint compte comme green (plafond métier 100%, plafond stockage 999)
    pct, st = _compute_pct_atteinte(value=250, target=100, sens="Haut")
    assert pct == 250.0
    assert pct <= 999.0
    assert st == "green"


def test_pct_atteinte_haut_extreme_capped():
    pct, st = _compute_pct_atteinte(value=100000, target=10, sens="Haut")
    assert pct == 999.0
    assert st == "green"


def test_pct_atteinte_bas_value_better_than_target():
    # CPL = 20€ avec objectif 30€ → on est meilleur que l'objectif → vert
    pct, st = _compute_pct_atteinte(value=20, target=30, sens="Bas")
    assert pct == 150.0
    assert st == "green"


def test_pct_atteinte_bas_value_worse_than_target():
    # CPL = 50€ avec objectif 30€ → on est pire que l'objectif → 60% atteint → rouge
    pct, st = _compute_pct_atteinte(value=50, target=30, sens="Bas")
    assert pct == 60.0
    assert st == "red"


def test_pct_atteinte_bas_value_zero():
    # CPL=0 (parfait, division par 0 évitée) → 999%
    pct, st = _compute_pct_atteinte(value=0, target=30, sens="Bas")
    assert pct == 999.0
    assert st == "green"


def test_pct_atteinte_no_target():
    pct, st = _compute_pct_atteinte(value=100, target=None, sens="Haut")
    assert pct is None
    assert st == "unknown"


def test_pct_atteinte_target_zero():
    pct, st = _compute_pct_atteinte(value=100, target=0, sens="Haut")
    assert pct is None
    assert st == "unknown"


def test_pct_atteinte_no_value():
    pct, st = _compute_pct_atteinte(value=None, target=100, sens="Haut")
    assert pct is None
    assert st == "unknown"


def test_pct_atteinte_no_sens():
    pct, st = _compute_pct_atteinte(value=100, target=100, sens=None)
    assert pct is None
    assert st == "unknown"


# ─── Tests garde année hors-2026 ─────────────────────────────────────────────

def _period(start, end):
    return Period(start=start, end=end, label="test", granularity="daily")


def test_scale_target_period_in_2026_ok():
    t = {"target": 1500, "seuil": 1000, "prorata": True, "sens": "Haut"}
    p = _period(date(2026, 5, 1), date(2026, 5, 30))  # 30 jours dans 2026
    target, seuil = _scale_target(t, p)
    assert target == 1500.0
    assert seuil == 1000.0


def test_scale_target_period_entirely_in_2025_blocked():
    t = {"target": 1500, "seuil": 1000, "prorata": True, "sens": "Haut"}
    p = _period(date(2025, 5, 1), date(2025, 5, 30))
    target, seuil = _scale_target(t, p)
    assert target is None
    assert seuil is None


def test_scale_target_period_entirely_in_2027_blocked():
    t = {"target": 1500, "seuil": 1000, "prorata": True, "sens": "Haut"}
    p = _period(date(2027, 1, 1), date(2027, 1, 31))
    target, seuil = _scale_target(t, p)
    assert target is None
    assert seuil is None


def test_scale_target_period_overlap_2025_2026_kept():
    # Période chevauchante 2025/2026 → comparaison conservée (validé Franck)
    t = {"target": 1500, "seuil": 1000, "prorata": False, "sens": "Haut"}
    p = _period(date(2025, 12, 20), date(2026, 1, 18))
    target, seuil = _scale_target(t, p)
    assert target == 1500.0
    assert seuil == 1000.0


def test_scale_target_prorata_7_days():
    # volume_leads target_mensuelle=5000, sur 7 jours → ~5000*7/30 ≈ 1166.67
    t = {"target": 5000, "seuil": 3000, "prorata": True, "sens": "Haut"}
    p = _period(date(2026, 5, 1), date(2026, 5, 7))  # 7 jours
    target, seuil = _scale_target(t, p)
    assert target == pytest.approx(5000 * 7 / 30, rel=0.01)
    assert seuil == pytest.approx(3000 * 7 / 30, rel=0.01)


# ─── Tests intégration global_status ─────────────────────────────────────────

PERIOD = Period(start=date(2026, 1, 1), end=date(2026, 1, 5), label="test", granularity="daily")


@pytest.fixture(autouse=True)
def build_test_cache():
    """Reuse the same test fixture pattern as test_kpis.py."""
    import duckdb
    cache._conn = duckdb.connect(":memory:")
    cache._last_refresh = None
    cache._status = "initializing"

    leads = pd.DataFrame([
        {"date": date(2026, 1, 1), "source": "x", "canal": "Organique", "sous_canal": "YouTube", "first_ac_action": "FVO"},
        {"date": date(2026, 1, 2), "source": "x", "canal": "Organique", "sous_canal": "YouTube", "first_ac_action": "FVO"},
        {"date": date(2026, 1, 3), "source": "y", "canal": "Paid", "sous_canal": "Meta", "first_ac_action": "FVO"},
    ])
    ventes = pd.DataFrame([
        {"date": date(2026, 1, 1), "source_initiale": "x", "last_source": None, "canal": "Organique", "sous_canal": "YouTube", "closer": "a", "produit": "LBD", "ca_ht": 1500.0, "heure_calendly": None},
        {"date": date(2026, 1, 2), "source_initiale": "y", "last_source": None, "canal": "Paid", "sous_canal": "Meta", "closer": "b", "produit": "LBD", "ca_ht": 1800.0, "heure_calendly": None},
    ])
    calls = pd.DataFrame([
        {"date_reservation": date(2026, 1, 1), "date_call": pd.Timestamp("2026-01-01 10:00"), "source": "x", "last_source": None, "canal": "Organique", "sous_canal": "YouTube", "closer": "a", "event_calendly": "Appel", "is_past": True},
        {"date_reservation": date(2026, 1, 2), "date_call": pd.Timestamp("2026-01-02 10:00"), "source": "y", "last_source": None, "canal": "Paid", "sous_canal": "Meta", "closer": "b", "event_calendly": "Appel", "is_past": True},
    ])
    leads_paid = pd.DataFrame([
        {"date": date(2026, 1, 3), "source": "y", "canal": "Paid", "sous_canal": "Meta", "first_ac_action": "FVO"},
    ])
    calls_paid = pd.DataFrame([
        {"date_reservation": date(2026, 1, 2), "date_call": pd.Timestamp("2026-01-02 10:00"), "source": "y", "canal": "Paid", "sous_canal": "Meta", "closer": "b", "is_past": True},
    ])
    ventes_paid = pd.DataFrame([
        {"date": date(2026, 1, 2), "source_initiale": "y", "canal": "Paid", "sous_canal": "Meta", "closer": "b", "produit": "LBD", "ca_ht": 1800.0},
    ])
    budget = pd.DataFrame([
        {"date": date(2026, 1, 1), "creative_id": "y", "canal": "Paid", "sous_canal": "Meta", "spend": 100.0},
    ])

    from backend.app.loaders import _default_targets
    targets = _default_targets()

    cache.build(
        {"ventes": ventes, "calendly": calls, "leads": leads},
        {"new_leads": leads_paid, "calls": calls_paid, "ventes": ventes_paid, "budget": budget},
        targets,
    )


def test_kpi_card_includes_pct_fields():
    """Toutes les cards KPI doivent désormais inclure pct_atteinte et pct_status."""
    result = kpis.ca_ht(PERIOD)
    assert "pct_atteinte" in result
    assert "pct_status" in result
    assert result["pct_status"] in ("green", "orange", "red", "unknown")


def test_kpi_card_pct_with_target():
    """ca_ht (sens=Haut, prorata=True) sur 5 jours : target=500000*5/30≈83333. Value=3300 → ~4% → red."""
    result = kpis.ca_ht(PERIOD)
    assert result["pct_atteinte"] is not None
    assert result["pct_status"] == "red"


def test_global_status_score_fields():
    gs = kpis.global_status(PERIOD)
    assert "total" in gs
    assert "green" in gs
    assert "orange" in gs
    assert "red" in gs
    assert "excluded" in gs
    assert "score_pct" in gs
    assert "top_alert" in gs
    # Les champs rétro-compat sont conservés
    assert "worst_status" in gs
    assert "phrase" in gs
    assert "critical_kpis" in gs
    assert "domains" in gs


def test_global_status_score_pct_consistency():
    """score_pct = green / total * 100, et green + orange + red = total."""
    gs = kpis.global_status(PERIOD)
    if gs["total"] > 0:
        assert gs["green"] + gs["orange"] + gs["red"] == gs["total"]
        expected = round(gs["green"] / gs["total"] * 100, 1)
        assert gs["score_pct"] == expected


def test_global_status_top_alert_payload_shape_when_present():
    gs = kpis.global_status(PERIOD)
    if gs["top_alert"] is not None:
        ta = gs["top_alert"]
        # Champs requis par <ScoreWidget>
        for key in ("key", "label", "domain", "href", "value", "target", "format", "pct_atteinte", "tier"):
            assert key in ta, f"top_alert missing field {key}"
        assert ta["tier"] in (1, 2)


def test_global_status_top_alert_tier_priority():
    """Sur ce dataset (tout en rouge — funnel naissant), top_alert doit être de tier 1
    (au moins un KPI a status=red, qui prime sur pct_status=red)."""
    gs = kpis.global_status(PERIOD)
    if gs["critical_count"] > 0 and gs["top_alert"] is not None:
        assert gs["top_alert"]["tier"] == 1


def test_global_status_excluded_count_non_negative():
    gs = kpis.global_status(PERIOD)
    assert gs["excluded"] >= 0


def test_global_status_benefice_uses_period_not_mtd():
    """Le récap mensuel exécuté le 1er du mois doit afficher le bénéfice DU MOIS RÉCAPÉ,
    pas le MTD du mois en cours (qui serait ~0€). Test critique pour le récap automatique
    Slack/Notion qui sort le 1er juin sur #marketing."""
    # Période simulée : avril 2026 (mois "récapé")
    p_avril = Period(start=date(2026, 4, 1), end=date(2026, 4, 30), label="Avril 2026", granularity="monthly")
    gs = kpis.global_status(p_avril)
    benefice_kpi = next((k for k in gs.get("critical_kpis", []) + [k for k in gs.get("domains", {}).get("ads", {}) if isinstance(k, dict)] if isinstance(k, dict) and k.get("key") == "benefice_net_paid"), None)
    # Le bénéfice doit être calculé sur avril (1-30), pas sur juin MTD.
    # Avec le test fixture (données seulement début janvier 2026), benefice avril = 0 sans MTD parasite.
    # Vérification indirecte : on s'assure que le label NE contient PAS "(MTD)".
    # (Test plus précis impossible sans mock du calendrier.)
    # On parcourt tous les KPIs de la période pour trouver benefice_net_paid.
    # Solution : appeler global_status puis chercher dans les structures internes.
    found = False
    for kpi_list in (gs.get("critical_kpis", []),):
        for k in kpi_list:
            if k.get("key") == "benefice_net_paid":
                assert "(MTD)" not in k.get("label", ""), "Label benefice_net_paid ne doit plus contenir (MTD)"
                found = True
    # Si non trouvé dans critical_kpis (status != red), on vérifie via top_alert ou via un appel direct
    # à benefice_net_for_period pour confirmer que la fonction est bien appelée avec la période.
    from backend.app.kpis import benefice_net_for_period
    direct = benefice_net_for_period(p_avril.start, p_avril.end)
    assert "benefice_net" in direct
    assert "mtd_label" in direct
    # Le label doit refléter la période demandée (01/04 → 30/04/2026), pas la date du jour.
    assert "04/2026" in direct["mtd_label"], f"mtd_label devrait contenir la période avril 2026, got: {direct['mtd_label']}"
