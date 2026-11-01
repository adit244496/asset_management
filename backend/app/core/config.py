import os

from dotenv import load_dotenv

load_dotenv()

PLACEHOLDER_SECRET_KEY = "change-me-in-.env"
MIN_SECRET_KEY_LENGTH = 32


class Settings:
    def __init__(self):
        self.PROJECT_NAME: str = "IT Asset Engine API"

        self.DATABASE_URL: str = os.getenv(
            "DATABASE_URL",
            "postgresql+pg8000://postgres:postgres@localhost:5432/asset_management",
        )

        self.SECRET_KEY: str = os.getenv("SECRET_KEY", PLACEHOLDER_SECRET_KEY)
        self.ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
        self.ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720"))

        self.ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "superadmin")
        self.ADMIN_FULL_NAME: str = os.getenv("ADMIN_FULL_NAME", "Super Administrator")

        self.ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")

        self.NEW_USER_DEFAULT_PASSWORD: str = os.getenv(
            "NEW_USER_DEFAULT_PASSWORD", "Welcome@123"
        )

        self.ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
        self.ASSISTANT_BASE_URL: str = os.getenv("ASSISTANT_BASE_URL", "")
        self.ASSISTANT_MODEL: str = os.getenv("ASSISTANT_MODEL", "claude-opus-5-5")
        self.ASSISTANT_EFFORT: str = os.getenv("ASSISTANT_EFFORT", "medium")

        self.ASSISTANT_PROVIDER: str = os.getenv("ASSISTANT_PROVIDER", "gemini").strip().lower()
        self.GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
        self.GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
        self.GEMINI_BASE_URL: str = os.getenv("GEMINI_BASE_URL", "")

        self.VERIFY_NEW_RECORDS: bool = os.getenv("VERIFY_NEW_RECORDS", "true").strip().lower() not in (
            "0", "false", "no", "off")

        self.CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "")


settings = Settings()

