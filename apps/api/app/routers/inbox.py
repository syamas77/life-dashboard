from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionDep
from app.models import InboxItem, utc_now
from app.schemas import InboxItemCreate, InboxItemRead, InboxItemUpdate

router = APIRouter(prefix="/inbox", tags=["inbox"])


@router.get("", response_model=list[InboxItemRead])
def list_inbox_items(
    session: SessionDep,
    processed: bool | None = None,
) -> list[InboxItem]:
    statement = select(InboxItem).order_by(InboxItem.created_at.desc())
    if processed is True:
        statement = statement.where(InboxItem.processed_at.is_not(None))
    elif processed is False:
        statement = statement.where(InboxItem.processed_at.is_(None))
    return list(session.scalars(statement))


@router.post("", response_model=InboxItemRead, status_code=status.HTTP_201_CREATED)
def create_inbox_item(
    payload: InboxItemCreate,
    session: SessionDep,
) -> InboxItem:
    item = InboxItem(**payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.patch("/{item_id}", response_model=InboxItemRead)
def update_inbox_item(
    item_id: int,
    payload: InboxItemUpdate,
    session: SessionDep,
) -> InboxItem:
    item = find_inbox_item(item_id, session)
    changes = payload.model_dump(exclude_unset=True)
    processed = changes.pop("processed", None)

    if changes.get("content") is None and "content" in changes:
        raise HTTPException(status_code=422, detail="Inbox content cannot be null")
    for field, value in changes.items():
        setattr(item, field, value)

    if processed is not None:
        item.processed_at = utc_now() if processed else None

    session.commit()
    session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inbox_item(item_id: int, session: SessionDep) -> Response:
    item = find_inbox_item(item_id, session)
    session.delete(item)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def find_inbox_item(item_id: int, session: Session) -> InboxItem:
    item = session.get(InboxItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    return item
