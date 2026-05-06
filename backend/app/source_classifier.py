from functools import lru_cache

_UNKNOWN: dict = {"canal": "Inconnu", "sous_canal": "Inconnu"}

_unknown_log: set[str] = set()


@lru_cache(maxsize=2048)
def classify(source: str) -> dict:
    s = str(source or "").lower().strip()
    if not s or s in ("nan", "none", "xxx", "...", "axel", "bannarti", "source-3"):
        return _UNKNOWN

    # --- Paid ---
    if s.startswith("ads_pub_") or s == "ads_retargeting":
        return {"canal": "Paid", "sous_canal": "Meta"}
    if s.startswith("ads2_google") or "googleads" in s or "google-ads" in s or "google ads" in s:
        return {"canal": "Paid", "sous_canal": "Google"}
    if "tiktok" in s:
        return {"canal": "Paid", "sous_canal": "TikTok"}
    if s.startswith("meta") or s.startswith("fb-"):
        return {"canal": "Paid", "sous_canal": "Meta"}

    # --- YouTube ---
    if (
        s.startswith("ytb")
        or s.startswith("yt-")
        or s in ("chaineytb", "post-youtube", "linktree", "linktre")
    ):
        return {"canal": "Organique", "sous_canal": "YouTube"}

    # --- SEO / Blog ---
    if any(
        x in s
        for x in [
            "seo",
            "article",
            "comparatif",
            "banniere_art",
            "modele_art",
            "liste_etf",
            "comment-investir",
            "simulateur",
            "investir1000e",
            "commencez-ici",
            "investissement",
        ]
    ):
        return {"canal": "Organique", "sous_canal": "SEO"}

    # --- Podcast ---
    if any(x in s for x in ["podcast", "ausha", "detente-financiere"]):
        return {"canal": "Organique", "sous_canal": "Podcast"}

    # --- Newsletter ---
    if any(x in s for x in ["substack", "sequencelbd", "mail"]):
        return {"canal": "Organique", "sous_canal": "Newsletter"}

    # --- Webinaire ---
    if s.startswith("webi-"):
        return {"canal": "Organique", "sous_canal": "Webinaire"}

    # --- Social ---
    if any(x in s for x in ["linkedin", "bio-insta", "bio-facebook"]):
        return {"canal": "Organique", "sous_canal": "Social"}

    # --- Affiliation ---
    if s.startswith("aff-"):
        return {"canal": "Organique", "sous_canal": "Affiliation"}

    # --- Owned (pages site) ---
    if any(
        x in s
        for x in [
            "popup",
            "livre",
            "accueilsite",
            "tlmpreb",
            "page-outils",
            "page-parrainage",
            "footer",
            "page-contact",
            "page-a-propos",
            "page-recherche",
            "chatbot",
            "bio-facebook",
            "legend",
        ]
    ):
        return {"canal": "Organique", "sous_canal": "Owned"}

    # --- Direct ---
    if any(x in s for x in ["mon-compte", "pdv", "r2", "direct", "menu", "site"]):
        return {"canal": "Direct", "sous_canal": "Direct"}

    _unknown_log.add(source)
    return _UNKNOWN


def get_unknown_sources() -> list[str]:
    return sorted(_unknown_log)
