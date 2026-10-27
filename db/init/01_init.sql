-- SismoWatch Database Initialization Script
-- Schemas: raw and curated (Strict Separation of Concerns)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Create schemas
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS curated;

-- 2. Raw Layer: Store original, intact USGS GeoJSON payloads
CREATE TABLE IF NOT EXISTS raw.earthquakes (
    id VARCHAR(100) PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_earthquakes_event_time ON raw.earthquakes(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_raw_earthquakes_ingested_at ON raw.earthquakes(ingested_at DESC);

-- 3. Curated Layer: Clean, validated, typed seismic data ready for consumption
CREATE TABLE IF NOT EXISTS curated.earthquakes (
    id VARCHAR(100) PRIMARY KEY,
    magnitude NUMERIC(4,2),
    mag_type VARCHAR(20),
    place TEXT,
    event_time TIMESTAMPTZ NOT NULL,
    updated_time TIMESTAMPTZ,
    longitude NUMERIC(10,6) NOT NULL,
    latitude NUMERIC(10,6) NOT NULL,
    depth_km NUMERIC(8,2) NOT NULL,
    tsunami INTEGER DEFAULT 0,
    sig INTEGER,
    status VARCHAR(50),
    event_type VARCHAR(50),
    url TEXT,
    region VARCHAR(150),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curated_earthquakes_time ON curated.earthquakes(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_curated_earthquakes_mag ON curated.earthquakes(magnitude DESC);
CREATE INDEX IF NOT EXISTS idx_curated_earthquakes_region ON curated.earthquakes(region);
CREATE INDEX IF NOT EXISTS idx_curated_earthquakes_tsunami ON curated.earthquakes(tsunami) WHERE tsunami > 0;

-- 4. Curated Quality Metrics: In-memory evaluation audit (No physical quarantine table)
CREATE TABLE IF NOT EXISTS curated.quality_metrics (
    id SERIAL PRIMARY KEY,
    dag_run_id VARCHAR(255),
    execution_time TIMESTAMPTZ DEFAULT NOW(),
    total_evaluated INT NOT NULL DEFAULT 0,
    total_valid INT NOT NULL DEFAULT 0,
    total_discarded INT NOT NULL DEFAULT 0,
    quality_score NUMERIC(5,2) NOT NULL DEFAULT 100.00,
    discard_reasons JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_curated_quality_exec_time ON curated.quality_metrics(execution_time DESC);

-- 5. Curated AI Reports: Daily structured executive summaries generated with AI + Grounding
CREATE TABLE IF NOT EXISTS curated.ai_reports (
    id SERIAL PRIMARY KEY,
    report_date DATE UNIQUE NOT NULL,
    executive_summary TEXT NOT NULL,
    high_activity_zones JSONB NOT NULL DEFAULT '[]'::jsonb,
    notable_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_events INT NOT NULL DEFAULT 0,
    max_magnitude NUMERIC(4,2) NOT NULL DEFAULT 0.0,
    avg_magnitude NUMERIC(4,2) NOT NULL DEFAULT 0.0,
    tsunami_alerts INT NOT NULL DEFAULT 0,
    anomalies_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
    source VARCHAR(50) NOT NULL DEFAULT 'deterministic_fallback',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curated_ai_reports_date ON curated.ai_reports(report_date DESC);

-- 6. Curated AI Execution Logs: Full audit of tokens, latency, cost, and provider execution
CREATE TABLE IF NOT EXISTS curated.ai_execution_logs (
    id SERIAL PRIMARY KEY,
    report_id INT REFERENCES curated.ai_reports(id) ON DELETE SET NULL,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    latency_ms INT DEFAULT 0,
    estimated_cost_usd NUMERIC(8,6) DEFAULT 0.0,
    status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Curated Users & RBAC for Platform
CREATE TABLE IF NOT EXISTS curated.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('viewer', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default users with valid bcrypt hashes
INSERT INTO curated.users (username, hashed_password, role)
VALUES 
    ('admin', '$2b$12$/9ym9IeGaCHGnj4Jf32NdO3dokIytjLHBSoBMhIKbtOmtUhQiDeIO', 'admin'),
    ('viewer', '$2b$12$JL/HAUgiM5BC.Zo8oz9Q6eoYzMyBMD7AqaZTtaRsj8XaAcol5pFCu', 'viewer')
ON CONFLICT (username) DO UPDATE 
SET hashed_password = EXCLUDED.hashed_password,
    role = EXCLUDED.role;

-- 8. Least Privilege Database Roles
-- Airflow user role (Full CRUD on raw and curated schemas)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'airflow_role') THEN
        CREATE ROLE airflow_role;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'api_role') THEN
        CREATE ROLE api_role;
    END IF;
END
$$;

-- Grant permissions to airflow_role
GRANT USAGE, CREATE ON SCHEMA raw TO airflow_role;
GRANT USAGE, CREATE ON SCHEMA curated TO airflow_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA raw TO airflow_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA curated TO airflow_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA raw TO airflow_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA curated TO airflow_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA raw GRANT ALL PRIVILEGES ON TABLES TO airflow_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA curated GRANT ALL PRIVILEGES ON TABLES TO airflow_role;

-- Grant permissions to api_role (STRICTLY READ-ONLY ON CURATED, NO ACCESS TO RAW)
GRANT USAGE ON SCHEMA curated TO api_role;
GRANT SELECT ON ALL TABLES IN SCHEMA curated TO api_role;
GRANT SELECT, INSERT, UPDATE ON curated.users TO api_role;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA curated TO api_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA curated GRANT SELECT ON TABLES TO api_role;
REVOKE ALL ON SCHEMA raw FROM api_role;

-- Assign api_role to dedicated API user if created
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sismowatch_api') THEN
        CREATE USER sismowatch_api WITH PASSWORD 'sismowatch_api_secret_2026';
    END IF;
    GRANT api_role TO sismowatch_api;
END
$$;
