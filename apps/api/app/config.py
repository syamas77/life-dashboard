from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "Life Dashboard API"
    environment: str = "development"
    database_url: str = "sqlite:///./data/life.db"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    agent_command: str = str(PROJECT_ROOT / "apps/agent/node_modules/.bin/pi-acp")
    agent_pi_command: str = str(PROJECT_ROOT / ".pi/bin/life-pi")
    agent_cwd: str = str(PROJECT_ROOT)
    agent_timeout_seconds: float = 120.0
    agent_internal_api_url: str = "http://127.0.0.1:8000/api/v1"
    mcp_config_path: str = str(PROJECT_ROOT / "apps/api/data/mcp-servers.json")
    mcp_node_command: str = "node"
    mcp_gateway_script: str = str(
        PROJECT_ROOT / "apps/mcp-apple-reminders/dist/src/gateway-cli.js"
    )
    mcp_apple_reminders_script: str = str(
        PROJECT_ROOT / "apps/mcp-apple-reminders/dist/src/index.js"
    )
    mcp_timeout_seconds: float = 45.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="LIFE_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
