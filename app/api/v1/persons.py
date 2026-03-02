from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException
from sqlmodel import Session, select
from app.db.session import get_session
from app.models.person import Person
from app.services.storage import save_person_photo  # Наш новый сервис

router = APIRouter()


@router.post("/upload")
def create_person(
        full_name: str = Form(...),
        short_info: str = Form(...),
        photo: UploadFile = File(...),
        db: Session = Depends(get_session)
):
    # ОДНА СТРОКА вместо всей возни с путями и буферами
    photo_url = save_person_photo(photo)

    new_person = Person(
        full_name=full_name,
        short_info=short_info,
        photo_path=photo_url  # Сохраняем уже готовый путь из сервиса
    )

    db.add(new_person)
    db.commit()
    db.refresh(new_person)
    return new_person

@router.get("/", response_model=list[Person])
def get_persons(
    offset: int = 0,
    limit: int = 10,
    db: Session = Depends(get_session)
):
    """Получаем список всех героев с пагинацией"""
    persons = db.exec(select(Person).offset(offset).limit(limit)).all()
    return persons

@router.get("/{person_id}", response_model=Person)
def get_person(person_id: int, db: Session = Depends(get_session)):
    """Получаем данные одного конкретного героя"""
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Герой не найден")
    return person