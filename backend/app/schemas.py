from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

FieldType = Literal["text", "longtext", "number", "money", "date", "choice", "yesno", "rating"]


class AuthRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=6, max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TrackerFieldSchema(BaseModel):
    key: str | None = None
    label: str
    type: FieldType
    required: bool = False
    options: list[str] = Field(default_factory=list)
    archived: bool = False


class TrackerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    icon: str = Field(min_length=1, max_length=16)
    color: str = Field(min_length=1, max_length=16)
    fields: list[TrackerFieldSchema]


class TrackerResponse(TrackerCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class EntryCreate(BaseModel):
    at: datetime
    data: dict[str, Any]


class EntryResponse(EntryCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tracker_id: UUID
    deleted: bool