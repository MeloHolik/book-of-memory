from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi import Request

from wtforms import FileField

from sqladmin import Admin, ModelView

from app.core.config import settings
from app.db.session import init_db
from app.models.person import Person
from app.api.v1 import persons
from app.db.session import engine
from app.services.storage import save_person_photo



@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    # --- STARTUP ---
    # 1. Создаем папки для фото
    os.makedirs(settings.PHOTOS_DIR, exist_ok=True)
    # 2. Инициализируем БД
    init_db()

    print("Сервер запущен, папки созданы, база готова")

    yield  # Здесь приложение "живет" и принимает запросы

    # --- SHUTDOWN ---
    # Тут можно закрывать тяжелые соединения, если появятся (например, Redis или HttpClient)
    print("Сервер останавливается...")


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)
app.include_router(persons.router, prefix="/api/v1/persons", tags=["Persons"])
# Статика и роутеры остаются как были
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")

# Настраиваем, как Hero будет выглядеть в админке
class PersonAdmin(ModelView, model=Person):
    column_list = [Person.id, Person.full_name, Person.short_info]
    # Можно даже добавить поиск
    column_searchable_list = [Person.full_name]
    form_overrides = {
        "photo_path": FileField
    }
    form_args = {
        "photo_path": {"label": "Загрузить фото"}
    }


    async def on_model_change(self, data, model, is_created, request):
        # Проверяем, пришел ли файл из формы
        if "photo_path" in data and data["photo_path"]:
            file = data["photo_path"]
            if hasattr(file, "filename"):
                photo_url = save_person_photo(file)
                data["photo_path"] = photo_url

# Создаем саму админку
admin = Admin(app, engine)
admin.add_view(PersonAdmin)


templates = Jinja2Templates(directory="app/templates")

@app.get("/", response_class=HTMLResponse)
async def get_book(request: Request):
    # Мы просто отдаем пустой файл, JS сам заберет данные через API
    return templates.TemplateResponse("index.html", {"request": request})