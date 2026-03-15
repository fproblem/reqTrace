from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://reqtrace:reqtrace_secret@localhost:5432/reqtrace"
    DATABASE_URL_SYNC: str = "postgresql://reqtrace:reqtrace_secret@localhost:5432/reqtrace"
    CONFLUENCE_BASE_URL: str = "http://confluence.local"
    CONFLUENCE_USERNAME: str = ""
    CONFLUENCE_PASSWORD: str = ""
    JIRA_BASE_URL: str = "http://jira.local"

    class Config:
        env_file = ".env"


_PLACEHOLDER_VALUES = {
    "https://confluence.example.com",
    "https://jira.example.com",
    "http://confluence.local",
    "http://jira.local",
    "your_username",
    "your_password",
    "secret_password",
}


def normalize_setting(value: str | None) -> str:
    return (value or "").strip()


def is_placeholder_setting(value: str | None) -> bool:
    normalized = normalize_setting(value)
    return bool(normalized) and normalized in _PLACEHOLDER_VALUES


def resolve_setting(*values: str | None) -> str:
    for value in values:
        normalized = normalize_setting(value)
        if normalized and not is_placeholder_setting(normalized):
            return normalized
    return ""


settings = Settings()
