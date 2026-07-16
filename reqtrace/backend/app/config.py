from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://reqtrace:reqtrace_secret@localhost:5432/reqtrace"
    DATABASE_URL_SYNC: str = "postgresql://reqtrace:reqtrace_secret@localhost:5432/reqtrace"

    GOOGLE_CLIENT_ID: str = ""
    SESSION_SECRET: str = ""
    ALLOWED_EMAIL_DOMAIN: str = "surf.dev"
    SESSION_TTL_DAYS: int = 7
    COOKIE_SECURE: bool = False

    # Ключ Fernet для шифрования паролей кред проектов (v1.5.1). Генерация:
    # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    CREDENTIALS_KEY: str = ""

    # Ночное автообновление (v1.6.2, план — auto-refresh-plan-v1.6.md).
    # AUTO_REFRESH_AT — местное время старта в зоне AUTO_REFRESH_TZ: контейнер
    # живёт в UTC, и без явной зоны «03:00» превратилось бы в 06:00 МСК.
    AUTO_REFRESH_ENABLED: bool = True
    AUTO_REFRESH_AT: str = "03:00"
    AUTO_REFRESH_TZ: str = "Europe/Moscow"
    # Пауза между запросами к Confluence внутри прогона — бережём сервер ночью.
    AUTO_REFRESH_PAGE_DELAY_MS: int = 300

    class Config:
        env_file = ".env"


settings = Settings()
