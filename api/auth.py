"""
SismoWatch Backend - Authentication & RBAC Module
Handles password hashing (bcrypt), JWT generation/verification,
and role-based access control (RBAC) dependencies.
"""
from datetime import datetime, timedelta, timezone
import logging
import os
from typing import Any, Dict, Optional
import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from database import get_db_cursor

logger = logging.getLogger(__name__)

# Security settings
SECRET_KEY = os.getenv("SECRET_KEY", "sismowatch_jwt_super_secret_production_key_32bytes_min_2026!")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None


class UserCredentials(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against the bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generates a bcrypt password hash."""
    return pwd_context.hash(password)


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticates username and password against database."""
    user = get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user["hashed_password"]):
        return None
    return user


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Creates a signed JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Retrieves a user record from curated.users."""
    with get_db_cursor() as cur:
        cur.execute(
            "SELECT id, username, hashed_password, role FROM curated.users WHERE username = %s LIMIT 1;",
            (username,)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def seed_default_users():
    """
    Seeds admin and viewer accounts from environment variables into curated.users.
    Prevents hardcoding passwords in repository.
    """
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD", "admin123")
    viewer_user = os.getenv("VIEWER_USERNAME", "viewer")
    viewer_pass = os.getenv("VIEWER_PASSWORD", "viewer123")

    users_to_seed = [
        (admin_user, admin_pass, "admin"),
        (viewer_user, viewer_pass, "viewer"),
    ]

    try:
        with get_db_cursor(commit=True) as cur:
            for username, plain_pass, role in users_to_seed:
                hashed = get_password_hash(plain_pass)
                cur.execute(
                    """
                    INSERT INTO curated.users (username, hashed_password, role)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (username) DO UPDATE 
                    SET hashed_password = EXCLUDED.hashed_password,
                        role = EXCLUDED.role;
                    """,
                    (username, hashed, role)
                )
        logger.info("Default users seeded successfully (admin and viewer).")
    except Exception as e:
        logger.error("Error seeding default users: %s", e)


async def get_current_user(
    token_header: Optional[str] = Depends(oauth2_scheme),
    token_query: Optional[str] = Query(None, alias="token"),
) -> Dict[str, Any]:
    """
    Validates the JWT token from Authorization header or URL query parameter (for SSE / WebSockets)
    and returns the authenticated user dictionary.
    Raises 401 Unauthorized if invalid, missing or expired.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales de autenticación inválidas o sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    raw_token = token_header or token_query
    if not raw_token:
        raise credentials_exception

    try:
        payload = jwt.decode(raw_token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = get_user_by_username(username)
    if user is None:
        raise credentials_exception
    return user


async def require_viewer(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Dependency allowing access to authenticated users with 'viewer' or 'admin' roles.
    """
    if current_user.get("role") not in ("viewer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso restringido: Se requiere al menos rol de Viewer",
        )
    return current_user


async def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Dependency restricting access exclusively to users with 'admin' role.
    Rejects 'viewer' with clear 403 Forbidden.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: Esta acción requiere permisos de Administrador",
        )
    return current_user
