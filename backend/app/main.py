from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router as tracker_router
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="My Trackers API",
    version="0.1.0",
    openapi_url="/api/v1/openapi.json",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        *[str(origin) for origin in settings.cors_origin_list],
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5176",
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tracker_router)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}


