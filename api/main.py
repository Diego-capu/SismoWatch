"""
SismoWatch Backend - FastAPI Application Entrypoint
Exposes REST and SSE endpoints for the SismoWatch Seismic Monitoring Platform.
"""
from contextlib import asynccontextmanager
import logging
import os
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from auth import (
    authenticate_user,
    create_access_token,
    get_password_hash,
    get_user_by_username,
    seed_default_users,
    Token,
    UserCredentials,
    verify_password,
)
from database import init_db_pool, close_db_pool
from routes import events, reports, quality, chat

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("sismowatch-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager: initializes DB pool and seeds users on startup."""
    logger.info("Initializing SismoWatch API Database Pool...")
    try:
        init_db_pool()
        seed_default_users()
    except Exception as e:
        logger.warning("Database initialization deferred: %s", e)
    yield
    logger.info("Shutting down SismoWatch API Database Pool...")
    close_db_pool()


app = FastAPI(
    title="SismoWatch API",
    description="Plataforma de Monitoreo Sísmico Global con Airflow, Pandera y LLM Grounding",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS Configuration - Restricted strictly to frontend origins
raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
allowed_origins = [orig.strip() for orig in raw_origins.split(",") if orig.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(events.router)
app.include_router(reports.router)
app.include_router(quality.router)
app.include_router(chat.router)


@app.get("/", tags=["health"])
async def root():
    return {
        "service": "SismoWatch API",
        "version": "1.0.0",
        "status": "OPERATIONAL",
        "docs": "/docs",
    }


@app.get("/health", tags=["health"])
async def health_check():
    return {
        "status": "UP",
        "database": "CONNECTED",
        "architecture": "raw -> in-memory Pandera -> curated",
    }


@app.post("/auth/login", response_model=Token, tags=["auth"])
async def login(request: Request):
    """
    Authenticates user and returns signed JWT token with role claim.
    Supports both OAuth2 form data and JSON payload.
    """
    content_type = request.headers.get("content-type", "")
    username = None
    password = None

    if "application/json" in content_type:
        try:
            body = await request.json()
            username = body.get("username")
            password = body.get("password")
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            username = form.get("username")
            password = form.get("password")
        except Exception:
            pass

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Se requieren usuario y contraseña",
        )

    user = get_user_by_username(username)
    if not user or not verify_password(password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas (usuario o contraseña no válidos)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": user["username"], "role": user["role"]}
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        username=user["username"],
        role=user["role"],
    )
