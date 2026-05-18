-- Schema initial pour la migration sinvestir-dashboard
-- backend Python+DuckDB -> Cloudflare Workers + Supabase Postgres.
--
-- Conventions :
--   - Tous les noms en snake_case (cohérent avec les noms DuckDB existants côté kpis.py)
--   - Les tables issues d'Excel n'ont pas de PK naturelle : on ajoute un id BIGSERIAL.
--   - Les tables externes (ic_*, ac_*) ont un id naturel (TEXT) venant de l'API source.
--   - Tous les champs date / datetime sont sans timezone (cohérent avec les calculs
--     en Europe/Paris côté code applicatif, comme aujourd'hui).
--   - Pas de FK entre tables (les datasets sont indépendants côté logique métier).
--   - Index sur (date, canal) et (date, sous_canal) car ce sont les axes principaux
--     des queries KPIs.
--
-- À exécuter une fois sur la base Supabase via la SQL Editor du dashboard.

-- ─── Schéma de travail ──────────────────────────────────────────────────────
-- Toutes les tables vivent dans le schema `public` par défaut (compatible PostgREST).

-- ─── Données stats (S'investir Statistiques - 2026.xlsx) ────────────────────

CREATE TABLE IF NOT EXISTS ventes (
  id              BIGSERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  mail            TEXT,
  source_initiale TEXT,
  last_source     TEXT,
  canal           TEXT,                  -- "Paid" | "Organique" | "Direct" | "Inconnu"
  sous_canal      TEXT,                  -- ex : "Meta", "Google", "YouTube", "SEO", ...
  closer          TEXT,
  produit         TEXT,
  produit_nom     TEXT,
  ca_ht           NUMERIC(12,2),
  heure_calendly  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ventes_date            ON ventes (date);
CREATE INDEX IF NOT EXISTS idx_ventes_canal_date      ON ventes (canal, date);
CREATE INDEX IF NOT EXISTS idx_ventes_sous_canal_date ON ventes (sous_canal, date);
CREATE INDEX IF NOT EXISTS idx_ventes_closer_date     ON ventes (closer, date);

CREATE TABLE IF NOT EXISTS calls (
  id                BIGSERIAL PRIMARY KEY,
  date_reservation  DATE NOT NULL,
  date_call         TIMESTAMP,
  closer            TEXT,
  source            TEXT,
  last_source       TEXT,
  canal             TEXT,
  sous_canal        TEXT,
  event_calendly    TEXT,
  is_past           BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_calls_date_reservation ON calls (date_reservation);
CREATE INDEX IF NOT EXISTS idx_calls_is_past_date     ON calls (is_past, date_reservation);
CREATE INDEX IF NOT EXISTS idx_calls_canal_date       ON calls (canal, date_reservation);
CREATE INDEX IF NOT EXISTS idx_calls_closer_date      ON calls (closer, date_reservation);

CREATE TABLE IF NOT EXISTS leads (
  id               BIGSERIAL PRIMARY KEY,
  date             DATE NOT NULL,
  mail             TEXT,
  source           TEXT,
  canal            TEXT,
  sous_canal       TEXT,
  first_ac_action  TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_date            ON leads (date);
CREATE INDEX IF NOT EXISTS idx_leads_canal_date      ON leads (canal, date);
CREATE INDEX IF NOT EXISTS idx_leads_sous_canal_date ON leads (sous_canal, date);

-- ─── Données ads (Statistiques Publicités S'investir.xlsx) ──────────────────

CREATE TABLE IF NOT EXISTS leads_paid (
  id               BIGSERIAL PRIMARY KEY,
  date             DATE NOT NULL,
  source           TEXT,
  canal            TEXT,
  sous_canal       TEXT,
  first_ac_action  TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_paid_date            ON leads_paid (date);
CREATE INDEX IF NOT EXISTS idx_leads_paid_sous_canal_date ON leads_paid (sous_canal, date);

CREATE TABLE IF NOT EXISTS calls_paid (
  id                BIGSERIAL PRIMARY KEY,
  date_reservation  DATE NOT NULL,
  date_call         TIMESTAMP,
  closer            TEXT,
  source            TEXT,
  last_source       TEXT,
  canal             TEXT,
  sous_canal        TEXT,
  is_past           BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_calls_paid_date_reservation ON calls_paid (date_reservation);
CREATE INDEX IF NOT EXISTS idx_calls_paid_is_past_date     ON calls_paid (is_past, date_reservation);

CREATE TABLE IF NOT EXISTS ventes_paid (
  id              BIGSERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  mail            TEXT,
  source_initiale TEXT,
  last_source     TEXT,
  canal           TEXT,
  sous_canal      TEXT,
  closer          TEXT,
  produit         TEXT,
  produit_nom     TEXT,
  ca_ht           NUMERIC(12,2),
  heure_calendly  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ventes_paid_date            ON ventes_paid (date);
CREATE INDEX IF NOT EXISTS idx_ventes_paid_sous_canal_date ON ventes_paid (sous_canal, date);

CREATE TABLE IF NOT EXISTS budget (
  id           BIGSERIAL PRIMARY KEY,
  date         DATE NOT NULL,
  creative_id  TEXT NOT NULL,
  canal        TEXT,
  sous_canal   TEXT,
  spend        NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_budget_date            ON budget (date);
CREATE INDEX IF NOT EXISTS idx_budget_sous_canal_date ON budget (sous_canal, date);

-- ─── Targets (targets_2026.xlsx) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS targets (
  indicateur        TEXT PRIMARY KEY,
  description       TEXT,
  unite             TEXT,
  sens              TEXT NOT NULL CHECK (sens IN ('Haut','Bas')),
  target_2026       NUMERIC,
  target_mensuelle  NUMERIC,
  seuil_critique    NUMERIC,
  owner             TEXT,
  prorata           BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─── ActiveCampaign ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ac_campaigns (
  id                TEXT PRIMARY KEY,
  name              TEXT,
  sdate             DATE,
  send_amt          INTEGER,
  uniqueopens       INTEGER,
  uniquelinkclicks  INTEGER,
  unsubscribes      INTEGER,
  hardbounces       INTEGER,
  type              TEXT,
  open_rate         NUMERIC,
  ctr               NUMERIC,
  ctor              NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_ac_campaigns_sdate ON ac_campaigns (sdate);

CREATE TABLE IF NOT EXISTS ac_lists (
  id    TEXT PRIMARY KEY,
  name  TEXT
);

-- ─── iClosed ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ic_calls (
  id              TEXT PRIMARY KEY,
  date            DATE,
  user_id         TEXT,
  closer          TEXT,
  closer_email    TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  outcome         TEXT,            -- "NO_SHOW" | "SOLD" | etc.
  no_sale_reason  TEXT,
  objection       TEXT,
  has_deal        BOOLEAN,
  deal_value      NUMERIC(12,2),
  call_type       TEXT,
  duration        INTEGER          -- seconds
);
CREATE INDEX IF NOT EXISTS idx_ic_calls_date    ON ic_calls (date);
CREATE INDEX IF NOT EXISTS idx_ic_calls_closer  ON ic_calls (closer);
CREATE INDEX IF NOT EXISTS idx_ic_calls_outcome ON ic_calls (outcome);

CREATE TABLE IF NOT EXISTS ic_deals (
  id                TEXT PRIMARY KEY,
  date              DATE,
  user_id           TEXT,
  closer            TEXT,
  closer_email      TEXT,
  value             NUMERIC(12,2),
  transaction_type  TEXT,          -- "WON" | "RECURRING" | "DEPOSIT"
  product_id        TEXT,
  event_name        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ic_deals_date             ON ic_deals (date);
CREATE INDEX IF NOT EXISTS idx_ic_deals_transaction_type ON ic_deals (transaction_type);
CREATE INDEX IF NOT EXISTS idx_ic_deals_closer           ON ic_deals (closer);

-- ─── Sécurité RLS ───────────────────────────────────────────────────────────
-- Toutes les requêtes serveur passeront par le service_role key depuis le Workers
-- backend, qui bypass RLS par défaut. On laisse RLS désactivé pour simplifier ;
-- si on expose un jour Supabase directement au browser (Supabase Auth), il faudra
-- réactiver RLS + écrire les policies appropriées.

ALTER TABLE ventes        DISABLE ROW LEVEL SECURITY;
ALTER TABLE calls         DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads         DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads_paid    DISABLE ROW LEVEL SECURITY;
ALTER TABLE calls_paid    DISABLE ROW LEVEL SECURITY;
ALTER TABLE ventes_paid   DISABLE ROW LEVEL SECURITY;
ALTER TABLE budget        DISABLE ROW LEVEL SECURITY;
ALTER TABLE targets       DISABLE ROW LEVEL SECURITY;
ALTER TABLE ac_campaigns  DISABLE ROW LEVEL SECURITY;
ALTER TABLE ac_lists      DISABLE ROW LEVEL SECURITY;
ALTER TABLE ic_calls      DISABLE ROW LEVEL SECURITY;
ALTER TABLE ic_deals      DISABLE ROW LEVEL SECURITY;
