import time
import unicodedata
from pathlib import Path
from typing import Optional, Union

import pandas as pd
import structlog

from .source_classifier import classify

log = structlog.get_logger()

_RETRY_DELAYS = [1, 3, 9]

Source = Union[Path, str]  # Path → Excel file, str → Google Sheets ID


# ─── Low-level readers ────────────────────────────────────────────────────────

def _read_excel_with_retry(path: Path, sheet_name: str, **kwargs) -> pd.DataFrame:
    for attempt, delay in enumerate([0] + _RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            return pd.read_excel(path, sheet_name=sheet_name, **kwargs)
        except Exception as e:
            if attempt == len(_RETRY_DELAYS):
                raise
            log.warning("excel_read_retry", path=str(path), sheet=sheet_name, attempt=attempt + 1, error=str(e))
    raise RuntimeError(f"Impossible de lire {path}:{sheet_name} après 3 tentatives")


def _read_source(source: Source, sheet_name: str, creds_path: Optional[str] = None, **kwargs) -> pd.DataFrame:
    """Dispatch to Google Sheets or Excel depending on source type."""
    if creds_path and isinstance(source, str):
        from .gsheets import read_tab
        return read_tab(source, sheet_name, creds_path, **kwargs)
    return _read_excel_with_retry(Path(source), sheet_name, **kwargs)


# ─── GSheets string-format helpers ───────────────────────────────────────────

def _to_date(series: pd.Series) -> pd.Series:
    """Parse dates from either datetime objects (Excel) or DD/MM/YYYY strings (GSheets)."""
    return pd.to_datetime(series, errors="coerce", dayfirst=True).dt.date


def _to_datetime(series: pd.Series) -> pd.Series:
    """Parse datetimes from either datetime objects or French-format strings.
    Handles both DD/MM/YYYY HH:MM:SS and DD/MM/YYYY HH:MM (without seconds).
    """
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    # Try each format explicitly to avoid pandas inferring from first rows
    result = pd.to_datetime(series, format="%d/%m/%Y %H:%M:%S", errors="coerce")
    mask = result.isna() & series.notna() & (series.astype(str) != "None")
    if mask.any():
        result.loc[mask] = pd.to_datetime(series.loc[mask], format="%d/%m/%Y %H:%M", errors="coerce")
    if result.isna().all():
        result = pd.to_datetime(series, errors="coerce", dayfirst=True)
    return result


def _to_numeric(series: pd.Series) -> pd.Series:
    """Parse numbers from either floats (Excel) or '1 234,56 €' strings (GSheets)."""
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")
    return pd.to_numeric(
        series.astype(str)
            .str.replace(r"[€$\s\xa0]", "", regex=True)  # remove currency symbols & spaces
            .str.replace(",", ".", regex=False)            # French decimal comma → dot
            .str.replace(r"[^\d.\-]", "", regex=True),    # remove remaining non-numeric chars
        errors="coerce",
    )


# ─── Shared transforms ────────────────────────────────────────────────────────

def _add_classification(df: pd.DataFrame, source_col: str) -> pd.DataFrame:
    df = df.copy()
    classifications = df[source_col].map(lambda s: classify(str(s) if pd.notna(s) else ""))
    df["canal"] = classifications.map(lambda c: c["canal"])
    df["sous_canal"] = classifications.map(lambda c: c["sous_canal"])
    return df


# ─── Loaders ──────────────────────────────────────────────────────────────────

def load_ventes(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df = _read_source(
        source, "VENTES", creds_path,
        usecols=["Date", "Mail", "Source initiale", "Last Source", "Heure Calendly", "Produit", "Produit.1", "TOTAL HT", "CLOSER"],
    )
    df = df.rename(columns={
        "Source initiale": "source_initiale",
        "Last Source": "last_source",
        "Heure Calendly": "heure_calendly",
        "TOTAL HT": "ca_ht",
        "CLOSER": "closer",
        "Produit": "produit",
        "Produit.1": "produit_nom",
    })
    df["date"] = _to_date(df["Date"])
    df["heure_calendly"] = _to_datetime(df["heure_calendly"])
    df["ca_ht"] = _to_numeric(df["ca_ht"]).fillna(0)
    df = df.dropna(subset=["date"])
    df = df[df["ca_ht"] > 0]
    df["produit_nom"] = df["produit_nom"].fillna("Inconnu").astype(str)
    df = _add_classification(df, "source_initiale")
    return df[["date", "source_initiale", "last_source", "canal", "sous_canal", "closer", "produit", "produit_nom", "ca_ht", "heure_calendly"]]


def load_calendly(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df = _read_source(source, "CALENDLY", creds_path)

    # Fix header: second column may be read as integer count of rows instead of 'Mail'
    cols = list(df.columns)
    if "Mail" not in cols and len(cols) > 1 and not isinstance(cols[1], str):
        cols[1] = "Mail"
        df.columns = cols

    keep = {
        "DATE": "date_reservation",
        "Heure et date Calendly": "date_call",
        "Closer": "closer",
        "Source": "source",
        "Last_source": "last_source",
        "Event Calendly": "event_calendly",
    }
    available = {k: v for k, v in keep.items() if k in df.columns}
    df = df.rename(columns=available)
    df["date_reservation"] = _to_date(df["date_reservation"])
    df["date_call"] = _to_datetime(df["date_call"])
    df = df.dropna(subset=["date_reservation"])
    df["source"] = df.get("source", pd.Series(dtype=str)).fillna("")
    df["closer"] = df.get("closer", pd.Series(dtype=str)).fillna("")
    df["is_past"] = df["date_call"] < pd.Timestamp.now()
    df = _add_classification(df, "source")
    return df[["date_reservation", "date_call", "source", "last_source", "canal", "sous_canal", "closer", "event_calendly", "is_past"]]


def load_leads(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df = _read_source(source, "LEADS", creds_path, usecols=[0, 1, 2, 3], header=0)
    df = df.iloc[:, :4]
    df.columns = ["date", "mail", "source", "first_ac_action"]
    df["date"] = _to_date(df["date"])
    df = df.dropna(subset=["date"])
    df["source"] = df["source"].fillna("").astype(str)
    df = _add_classification(df, "source")
    return df[["date", "source", "canal", "sous_canal", "first_ac_action"]]


def load_ads_new_leads(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df = _read_source(source, "NEW LEADS", creds_path)
    df = df.iloc[:, :3]
    df.columns = ["date", "source", "first_ac_action"]
    df["date"] = _to_date(df["date"])
    df = df.dropna(subset=["date"])
    df["source"] = df["source"].fillna("").astype(str)
    df = _add_classification(df, "source")
    return df[["date", "source", "canal", "sous_canal", "first_ac_action"]]


def load_ads_calls(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df = _read_source(source, "CALLS", creds_path)
    df = df.rename(columns={
        "Date Calendly": "date_reservation",
        "Heure et date Calendly": "date_call",
        "Closer": "closer",
        "Source": "source",
        "Last_source": "last_source",
    })
    df["date_reservation"] = _to_date(df["date_reservation"])
    df["date_call"] = _to_datetime(df["date_call"])
    df = df.dropna(subset=["date_reservation"])
    df["source"] = df["source"].fillna("").astype(str)
    df["closer"] = df["closer"].fillna("").astype(str)
    df["is_past"] = df["date_call"] < pd.Timestamp.now()
    df = _add_classification(df, "source")
    return df[["date_reservation", "date_call", "source", "canal", "sous_canal", "closer", "is_past"]]


def load_ads_ventes(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df = _read_source(
        source, "VENTES", creds_path,
        usecols=["Date", "Source initiale", "Last Source", "Produit", "TOTAL HT", "CLOSER"],
    )
    df = df.rename(columns={
        "Source initiale": "source_initiale",
        "Last Source": "last_source",
        "TOTAL HT": "ca_ht",
        "CLOSER": "closer",
        "Produit": "produit",
    })
    df["date"] = _to_date(df["Date"])
    df["ca_ht"] = _to_numeric(df["ca_ht"]).fillna(0)
    df = df.dropna(subset=["date"])
    df = df[df["ca_ht"] > 0]
    df = _add_classification(df, "source_initiale")
    return df[["date", "source_initiale", "canal", "sous_canal", "closer", "produit", "ca_ht"]]


def load_budget(source: Source, creds_path: Optional[str] = None) -> pd.DataFrame:
    df_raw = _read_source(source, "BUDGET", creds_path, header=None)

    # Row index 2 = headers row (row 3 in Excel / GSheets)
    headers = df_raw.iloc[2].tolist()
    creative_names = {
        i: str(headers[i])
        for i in range(2, len(headers))
        if pd.notna(headers[i]) and str(headers[i]) not in ("nan", "Budget", "None", "")
    }

    data = df_raw.iloc[3:].copy()
    data["date"] = _to_datetime(data[1])
    data = data.dropna(subset=["date"])
    data = data[data["date"] <= pd.Timestamp.now()]

    rows = []
    for _, row in data.iterrows():
        dt = row["date"].date()
        for col_idx, creative_id in creative_names.items():
            spend = _to_numeric(pd.Series([row.iloc[col_idx] if col_idx < len(row) else None])).iloc[0]
            if spend and spend > 0:
                cls = classify(creative_id)
                rows.append({
                    "date": dt,
                    "creative_id": creative_id,
                    "canal": cls["canal"],
                    "sous_canal": cls["sous_canal"],
                    "spend": float(spend),
                })

    if not rows:
        return pd.DataFrame(columns=["date", "creative_id", "canal", "sous_canal", "spend"])
    return pd.DataFrame(rows)


def _normalize_col(s: str) -> str:
    """Lowercase + strip accents + spaces→underscore."""
    nfd = unicodedata.normalize("NFD", str(s))
    ascii_s = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return ascii_s.lower().replace(" ", "_")


def load_targets(path: Path) -> pd.DataFrame:
    """Load targets from Excel, merging with defaults.

    The defaults (_default_targets) are the canonical source for all metadata
    (sens, prorata, description, owner). The Excel file can override
    target_mensuelle and seuil_critique per indicateur. Missing rows in Excel
    are filled from defaults.
    """
    defaults = _default_targets()
    if not path.exists():
        log.warning("targets_file_missing", path=str(path))
        return defaults
    try:
        df = _read_excel_with_retry(path, "Targets")
        df.columns = [_normalize_col(c) for c in df.columns]

        # Only import rows from Excel that are NOT already in defaults
        # Defaults are the canonical source; the admin page (DuckDB UPDATE) handles overrides
        default_indicateurs = set(defaults["indicateur"].tolist())
        extra_rows = []
        if "indicateur" in df.columns:
            for _, row in df.iterrows():
                ind = str(row.get("indicateur", "")).strip()
                if ind and ind not in default_indicateurs:
                    extra_rows.append(row.to_dict())

        result = defaults.copy()
        if extra_rows:
            extra_df = pd.DataFrame(extra_rows)
            result = pd.concat([result, extra_df], ignore_index=True)

        log.info("targets_loaded", from_excel=len(overrides), total=len(result))
        return result
    except Exception as e:
        log.warning("targets_load_error", error=str(e))
        return defaults


def _default_targets() -> pd.DataFrame:
    # prorata=True → target is scaled by period length (absolute KPIs: CA, volume, bénéfice)
    # prorata=False → target stays as-is regardless of period (% / ratio / unit price KPIs)
    return pd.DataFrame([
        # ── Funnel CA ──
        {"indicateur": "ca_ht",               "description": "CA par funnel total",              "unite": "€",  "sens": "Haut", "target_2026": 9000000, "target_mensuelle": 500000,  "seuil_critique": 400000,  "owner": "",         "prorata": True},
        {"indicateur": "ca_per_lead",         "description": "CA par lead",                      "unite": "€",  "sens": "Haut", "target_2026": 30,      "target_mensuelle": 30,      "seuil_critique": 20,      "owner": "",         "prorata": False},
        {"indicateur": "ca_per_call",         "description": "CA par call réalisé",              "unite": "€",  "sens": "Haut", "target_2026": 650,     "target_mensuelle": 650,     "seuil_critique": 350,     "owner": "",         "prorata": False},
        # ── Volume leads ──
        {"indicateur": "volume_leads",        "description": "Volume leads total",               "unite": "nb", "sens": "Haut", "target_2026": 60000,   "target_mensuelle": 5000,    "seuil_critique": 3000,    "owner": "Matthieu", "prorata": True},
        {"indicateur": "volume_leads_paid",   "description": "Volume leads Paid",                "unite": "nb", "sens": "Haut", "target_2026": 40000,   "target_mensuelle": 3333,    "seuil_critique": 1500,    "owner": "Marketing","prorata": True},
        # ── Booking rates ──
        {"indicateur": "booking_rate",        "description": "Booking rate global",              "unite": "%",  "sens": "Haut", "target_2026": 0.08,    "target_mensuelle": 0.08,    "seuil_critique": 0.05,    "owner": "Matthieu", "prorata": False},
        {"indicateur": "booking_rate_paid",   "description": "Booking rate Paid",                "unite": "%",  "sens": "Haut", "target_2026": 0.08,    "target_mensuelle": 0.08,    "seuil_critique": 0.05,    "owner": "Matthieu", "prorata": False},
        {"indicateur": "booking_rate_organic","description": "Booking rate Organique",           "unite": "%",  "sens": "Haut", "target_2026": 0.08,    "target_mensuelle": 0.08,    "seuil_critique": 0.05,    "owner": "Matthieu", "prorata": False},
        # ── Sales ──
        {"indicateur": "no_show_rate",        "description": "No-show rate",                     "unite": "%",  "sens": "Bas",  "target_2026": 0.20,    "target_mensuelle": 0.20,    "seuil_critique": 0.40,    "owner": "Sales",    "prorata": False},
        {"indicateur": "closing_rate",        "description": "Taux de closing brut (/ réservés)","unite": "%",  "sens": "Haut", "target_2026": 0.25,    "target_mensuelle": 0.25,    "seuil_critique": 0.15,    "owner": "Mohammed", "prorata": False},
        {"indicateur": "closing_rate_net",    "description": "Taux de closing net (/ passés)",   "unite": "%",  "sens": "Haut", "target_2026": 0.60,    "target_mensuelle": 0.60,    "seuil_critique": 0.20,    "owner": "Mohammed", "prorata": False},
        {"indicateur": "acv",                 "description": "Panier moyen (ACV)",               "unite": "€",  "sens": "Haut", "target_2026": 1900,    "target_mensuelle": 1900,    "seuil_critique": 1000,    "owner": "Sales",    "prorata": False},
        # ── Ads ──
        {"indicateur": "cpl_paid",            "description": "CPL Paid global",                  "unite": "€",  "sens": "Bas",  "target_2026": 8,       "target_mensuelle": 8,       "seuil_critique": 10,      "owner": "Léo",      "prorata": False},
        {"indicateur": "cpl_meta",            "description": "CPL Meta Ads",                     "unite": "€",  "sens": "Bas",  "target_2026": 8,       "target_mensuelle": 8,       "seuil_critique": 10,      "owner": "Léo",      "prorata": False},
        {"indicateur": "cpl_google",          "description": "CPL Google Ads",                   "unite": "€",  "sens": "Bas",  "target_2026": 8,       "target_mensuelle": 8,       "seuil_critique": 15,      "owner": "Léo",      "prorata": False},
        {"indicateur": "roas_paid",           "description": "ROAS Paid global",                 "unite": "x",  "sens": "Haut", "target_2026": 3.50,    "target_mensuelle": 3.50,    "seuil_critique": 3.50,    "owner": "",         "prorata": False},
        {"indicateur": "benefice_net_paid",   "description": "Bénéfice net Paid mensuel",        "unite": "€",  "sens": "Haut", "target_2026": 600000,  "target_mensuelle": 50000,   "seuil_critique": 50000,   "owner": "Matthieu", "prorata": True},
        {"indicateur": "budget_paid",         "description": "Budget Paid total",                "unite": "€",  "sens": "Bas",  "target_2026": 420000,  "target_mensuelle": 35000,   "seuil_critique": 60000,   "owner": "Marketing","prorata": True},
        # ── Email ──
        {"indicateur": "open_rate_email",     "description": "Taux d'ouverture email",           "unite": "%",  "sens": "Haut", "target_2026": 0.39,    "target_mensuelle": 0.39,    "seuil_critique": 0.31,    "owner": "",         "prorata": False},
        {"indicateur": "taux_conversion_lp",  "description": "Taux de conversion LP",            "unite": "%",  "sens": "Haut", "target_2026": 0.35,    "target_mensuelle": 0.35,    "seuil_critique": 0.25,    "owner": "",         "prorata": False},
    ])
