import os
from pathlib import Path

class Settings:
    PROJECT_NAME: str = "Книга Памяти"
    PROJECT_VERSION: str = "0.1.0"

    # Определяем базовую директорию проекта (где лежит main.py)
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent

    # Настройки базы данных
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./database.db")

    # Папка для статики (фотографий)
    STATIC_DIR: str = "app/static"
    PHOTOS_DIR: str = "app/static/photos"

settings = Settings()