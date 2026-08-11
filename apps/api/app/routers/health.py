from fastapi import APIRouter
from sqlalchemy import text

from app.database import SessionDep
from app.schemas import HealthRead

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthRead)
def health(session: SessionDep) -> HealthRead:
    session.execute(text("SELECT 1"))
    return HealthRead(status="ok", database="connected")
