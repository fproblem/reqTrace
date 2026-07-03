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

    class Config:
        env_file = ".env"


settings = Settings()
