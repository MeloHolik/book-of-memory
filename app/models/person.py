from sqlmodel import SQLModel, Field

class Person(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    full_name: str
    short_info: str
    photo_path: str | None = None