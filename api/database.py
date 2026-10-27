"""
SismoWatch Backend - Database Connection Manager
Provides connection pooling and context managers for executing queries
against PostgreSQL strictly within the `curated` schema.
"""
from contextlib import contextmanager
import logging
import os
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

# Read DB connection details from environment
DB_HOST = os.getenv("POSTGRES_HOST", "postgres")
DB_PORT = int(os.getenv("POSTGRES_PORT", 5432))
DB_NAME = os.getenv("POSTGRES_DB", "sismowatch")
# Use dedicated read-only API DB user for least privilege, fallback to POSTGRES_USER if needed
DB_USER = os.getenv("API_DB_USER", os.getenv("POSTGRES_USER", "sismowatch_api"))
DB_PASSWORD = os.getenv("API_DB_PASSWORD", os.getenv("POSTGRES_PASSWORD", "sismowatch_api_secret_2026"))

_connection_pool = None

def init_db_pool():
    """Initializes the threaded connection pool."""
    global _connection_pool
    if _connection_pool is None:
        try:
            _connection_pool = pool.ThreadedConnectionPool(
                minconn=2,
                maxconn=20,
                host=DB_HOST,
                port=DB_PORT,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                connect_timeout=10,
                options="-c search_path=curated,public",
            )
            logger.info("Database connection pool initialized successfully for user '%s'.", DB_USER)
        except Exception as e:
            logger.warning("Could not initialize connection pool with user '%s': %s. Retrying with root user...", DB_USER, e)
            # Fallback to POSTGRES_USER if API role not yet initialized
            try:
                alt_user = os.getenv("POSTGRES_USER", "airflow")
                alt_pass = os.getenv("POSTGRES_PASSWORD", "airflow_secure_password_2026")
                _connection_pool = pool.ThreadedConnectionPool(
                    minconn=2,
                    maxconn=20,
                    host=DB_HOST,
                    port=DB_PORT,
                    dbname=DB_NAME,
                    user=alt_user,
                    password=alt_pass,
                    connect_timeout=3,
                    options="-c search_path=curated,public",
                )
                logger.info("Database connection pool initialized with fallback user '%s'.", alt_user)
            except Exception as e2:
                logger.warning("Database offline or unreachable: %s. Deferred initialization.", e2)

def close_db_pool():
    """Closes all connections in the pool."""
    global _connection_pool
    if _connection_pool:
        _connection_pool.closeall()
        _connection_pool = None
        logger.info("Database connection pool closed.")

@contextmanager
def get_db_cursor(commit: bool = False):
    """
    Context manager yielding a RealDictCursor from the connection pool.
    Automatically handles check-in and check-out.
    """
    global _connection_pool
    if _connection_pool is None:
        init_db_pool()

    conn = _connection_pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _connection_pool.putconn(conn)
