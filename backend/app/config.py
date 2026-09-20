from functools import lru_cache

from pydantic import AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "postgresql+psycopg://trackers:trackers@postgres:5432/trackers"
    cors_origins: str = "http://localhost:5173"
    jwt_secret: str = "dev-only-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 7

    @property
    def cors_origin_list(self) -> list[str | AnyHttpUrl]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
