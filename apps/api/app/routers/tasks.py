from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionDep
from app.models import Task, utc_now
from app.schemas import TaskCreate, TaskRead, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskRead])
def list_tasks(
    session: SessionDep,
    completed: bool | None = None,
) -> list[Task]:
    statement = select(Task).order_by(Task.completed_at.is_not(None), Task.created_at.desc())
    if completed is True:
        statement = statement.where(Task.completed_at.is_not(None))
    elif completed is False:
        statement = statement.where(Task.completed_at.is_(None))
    return list(session.scalars(statement))


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, session: SessionDep) -> Task:
    task = Task(**payload.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("/{task_id}", response_model=TaskRead)
def get_task(task_id: int, session: SessionDep) -> Task:
    return find_task(task_id, session)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    session: SessionDep,
) -> Task:
    task = find_task(task_id, session)
    changes = payload.model_dump(exclude_unset=True)
    completed = changes.pop("completed", None)

    for field, value in changes.items():
        if field == "title" and value is None:
            raise HTTPException(status_code=422, detail="Task title cannot be null")
        setattr(task, field, value)

    if completed is not None:
        task.completed_at = utc_now() if completed else None
        task.status = "done" if completed else ("backlog" if task.status == "done" else task.status)
    elif "status" in changes:
        task.completed_at = utc_now() if task.status == "done" else None

    session.commit()
    session.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, session: SessionDep) -> Response:
    task = find_task(task_id, session)
    session.delete(task)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def find_task(task_id: int, session: Session) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
