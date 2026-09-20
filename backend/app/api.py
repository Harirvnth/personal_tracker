import base64
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import EntryModel, TrackerModel, UserModel
from app.schemas import (
    AuthRequest,
    AuthResponse,
    EntryCreate,
    EntryResponse,
    TrackerCreate,
    TrackerResponse,
)

router = APIRouter(prefix="/api/v1", tags=["trackers"])
bearer = HTTPBearer()


def current_user_id(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> UUID:
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
        )
        return UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, KeyError, ValueError) as error:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from error


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    encoded_salt = base64.urlsafe_b64encode(salt).decode()
    encoded_hash = base64.urlsafe_b64encode(derived).decode()
    return f"scrypt${encoded_salt}${encoded_hash}"


def password_matches(password: str, stored: str) -> bool:
    try:
        scheme, encoded_salt, encoded_hash = stored.split("$", 2)
        if scheme != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(encoded_salt)
        expected = base64.urlsafe_b64decode(encoded_hash)
        actual = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def issue_token(user_id: UUID) -> str:
    settings = get_settings()
    expires = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expires}, settings.jwt_secret, algorithm="HS256")


@router.post("/auth/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: AuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    username = payload.username.lower()
    if db.scalar(select(UserModel).where(UserModel.username == username)) is not None:
        raise HTTPException(status_code=409, detail="Username is already taken")
    user = UserModel(username=username, password_hash=password_hash(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(access_token=issue_token(user.id))


@router.post("/auth/signin", response_model=AuthResponse)
def signin(payload: AuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = db.scalar(select(UserModel).where(UserModel.username == payload.username.lower()))
    if user is None or not password_matches(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return AuthResponse(access_token=issue_token(user.id))


@router.get("/trackers", response_model=list[TrackerResponse])
def list_trackers(
    db: Session = Depends(get_db), user_id: UUID = Depends(current_user_id)
) -> list[TrackerModel]:
    return list(db.scalars(
        select(TrackerModel)
        .where(TrackerModel.owner_id == user_id)
        .order_by(TrackerModel.created_at)
    ).all())


@router.post("/trackers", response_model=TrackerResponse, status_code=status.HTTP_201_CREATED)
def create_tracker(
    payload: TrackerCreate,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> TrackerModel:
    tracker = TrackerModel(owner_id=user_id, **payload.model_dump())
    db.add(tracker)
    db.commit()
    db.refresh(tracker)
    return tracker


@router.patch("/trackers/{tracker_id}", response_model=TrackerResponse)
def update_tracker(
    tracker_id: UUID,
    payload: TrackerCreate,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> TrackerModel:
    tracker = db.scalar(select(TrackerModel).where(
        TrackerModel.id == tracker_id, TrackerModel.owner_id == user_id
    ))
    if tracker is None:
        raise HTTPException(status_code=404, detail="Tracker not found")
    for key, value in payload.model_dump().items():
        setattr(tracker, key, value)
    db.commit()
    db.refresh(tracker)
    return tracker


@router.delete("/trackers/{tracker_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tracker(
    tracker_id: UUID,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> None:
    tracker = db.scalar(select(TrackerModel).where(
        TrackerModel.id == tracker_id, TrackerModel.owner_id == user_id
    ))
    if tracker is None:
        raise HTTPException(status_code=404, detail="Tracker not found")
    db.delete(tracker)
    db.commit()


@router.get("/trackers/{tracker_id}/entries", response_model=list[EntryResponse])
def list_entries(
    tracker_id: UUID,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> list[EntryModel]:
    if db.scalar(select(TrackerModel).where(
        TrackerModel.id == tracker_id, TrackerModel.owner_id == user_id
    )) is None:
        raise HTTPException(status_code=404, detail="Tracker not found")
    return list(db.scalars(
        select(EntryModel)
        .where(EntryModel.tracker_id == tracker_id, EntryModel.deleted.is_(False))
        .order_by(EntryModel.at.desc())
    ).all())


@router.post(
    "/trackers/{tracker_id}/entries",
    response_model=EntryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_entry(
    tracker_id: UUID,
    payload: EntryCreate,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> EntryModel:
    if db.scalar(select(TrackerModel).where(
        TrackerModel.id == tracker_id, TrackerModel.owner_id == user_id
    )) is None:
        raise HTTPException(status_code=404, detail="Tracker not found")
    entry = EntryModel(tracker_id=tracker_id, **payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: UUID,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> None:
    entry = db.scalar(select(EntryModel).join(TrackerModel).where(
        EntryModel.id == entry_id, TrackerModel.owner_id == user_id
    ))
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.deleted = True
    db.commit()