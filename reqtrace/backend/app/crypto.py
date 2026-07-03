"""Шифрование секретов приложения (пароли кред проектов) — Fernet.

Ключ берётся из CREDENTIALS_KEY в .env. Генерация:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Без ключа функции бросают RuntimeError — приложение не должно уметь
молча сохранить пароль открытым текстом.
"""
from cryptography.fernet import Fernet

from app.config import settings


def _fernet() -> Fernet:
    key = (settings.CREDENTIALS_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "CREDENTIALS_KEY не задан в .env — работа с кредами проектов невозможна"
        )
    return Fernet(key.encode())


def encrypt_secret(plain: str) -> str:
    """Зашифровать секрет для хранения в БД (str → str, base64)."""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Расшифровать секрет из БД. InvalidToken — если сменился ключ или данные битые."""
    return _fernet().decrypt(token.encode()).decode()
