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
    os.makedirs(settings.PHOTOS_DIR, exist_ok=True)
    init_db()

    print("Сервер запущен, папки созданы, база готова")

    yield

    # --- SHUTDOWN ---
    print("Сервер останавливается...")


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)
app.include_router(persons.router, prefix="/api/v1/persons", tags=["Persons"])
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")


class PersonAdmin(ModelView, model=Person):
    column_list = [Person.id, Person.full_name, Person.short_info, Person.photo_path]
    column_searchable_list = [Person.full_name]

    # На создании показываем загрузку фото
    form_create_rules = ["full_name", "short_info", "photo_path"]

    # На редактировании фото не показываем:
    # это и убирает падение на строковом photo_path
    form_edit_rules = ["full_name", "short_info"]

    form_overrides = {
        "photo_path": FileField
    }

    form_args = {
        "full_name": {"label": "Имя"},
        "short_info": {"label": "Текст записи"},
        "photo_path": {"label": "Загрузить фото"}
    }

    async def on_model_change(self, data, model, is_created, request):
        file = data.get("photo_path")

        # Если реально пришёл новый файл — сохраняем и кладём путь в БД
        if hasattr(file, "filename") and file.filename:
            data["photo_path"] = save_person_photo(file)
        else:
            # Если файла нет, не даём пустому значению перетереть существующий путь
            data.pop("photo_path", None)


admin = Admin(app, engine)
admin.add_view(PersonAdmin)

templates = Jinja2Templates(directory="app/templates")


@app.get("/", response_class=HTMLResponse)
async def get_book(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})