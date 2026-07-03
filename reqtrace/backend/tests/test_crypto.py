"""Тесты шифрования кред (v1.5.1, этап 0): симметрия и отказ без ключа.

Запуск: python -m unittest discover tests  (внутри backend-контейнера)
"""
import unittest

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.crypto import encrypt_secret, decrypt_secret


class TestCrypto(unittest.TestCase):
    def setUp(self):
        self._old_key = settings.CREDENTIALS_KEY
        settings.CREDENTIALS_KEY = Fernet.generate_key().decode()

    def tearDown(self):
        settings.CREDENTIALS_KEY = self._old_key

    def test_roundtrip(self):
        secret = "p@ssw0rd — секрет"
        token = encrypt_secret(secret)
        self.assertNotEqual(token, secret)
        self.assertNotIn(secret, token)
        self.assertEqual(decrypt_secret(token), secret)

    def test_ciphertexts_differ_between_calls(self):
        # Fernet использует случайный IV — одинаковые пароли не должны давать
        # одинаковые записи в БД (иначе по БД видно, у кого пароли совпадают).
        self.assertNotEqual(encrypt_secret("same"), encrypt_secret("same"))

    def test_no_key_raises(self):
        settings.CREDENTIALS_KEY = ""
        with self.assertRaises(RuntimeError):
            encrypt_secret("x")
        with self.assertRaises(RuntimeError):
            decrypt_secret("x")

    def test_wrong_key_raises_invalid_token(self):
        token = encrypt_secret("secret")
        settings.CREDENTIALS_KEY = Fernet.generate_key().decode()
        with self.assertRaises(InvalidToken):
            decrypt_secret(token)


if __name__ == "__main__":
    unittest.main()
