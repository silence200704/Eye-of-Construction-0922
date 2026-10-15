from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZHUTONG_", env_file=BACKEND_ROOT / ".env")

    runtime_dir: Path = BACKEND_ROOT / ".runtime"
    database_url: str = f"sqlite:///{(BACKEND_ROOT / '.runtime/zhutong.sqlite').as_posix()}"
    secret_key: str = ""
    demo_mode: bool = True
    session_ttl_seconds: int = Field(default=28800, ge=60)
    media_max_bytes: int = Field(default=32 * 1024 * 1024, ge=1)
    import_max_bytes: int = Field(default=80 * 1024 * 1024, ge=1)
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
