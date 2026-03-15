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


settings = Settings()
