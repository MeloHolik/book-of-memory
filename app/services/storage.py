import os
import shutil
from uuid import uuid4
from app.core.config import settings

def save_person_photo(file) -> str:
    # 1. Генерируем уникальное имя
    # Извлекаем расширение (например, .jpg)
    original_filename = getattr(file, "filename", "image.jpg")
    file_extension = os.path.splitext(original_filename)[1]
    unique_filename = f"{uuid4()}{file_extension}"

    # 2. Полный путь для сохранения на диске
    file_path = os.path.join(settings.PHOTOS_DIR, unique_filename)

    # 3. Подготовка файла (ВАЖНО для Админки)
    # Если файл уже "трогали" до этого, возвращаем "курсор" в начало
    if hasattr(file, "seek"):
        file.seek(0)

    # 4. Сохраняем физически
    with open(file_path, "wb") as buffer:
        # Пытаемся взять сырой поток данных (.file), если он есть
        # Если нет (как в некоторых объектах WTForms) — берем сам объект
        source = getattr(file, "file", file)
        shutil.copyfileobj(source, buffer)

    # Возвращаем путь, который запишется в БД (относительно корня сайта)
    return f"/static/photos/{unique_filename}"