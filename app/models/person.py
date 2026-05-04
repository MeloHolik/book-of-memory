from sqlmodel import SQLModel, Field
from sqlalchemy import TEXT

class Person(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    full_name: str
    short_info: str = Field(sa_type=TEXT)
    photo_path: str | None = None