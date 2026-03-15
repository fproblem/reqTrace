from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("", response_model=UserResponse)
async def create_or_login_user(data: UserCreate, db: AsyncSession = Depends(get_db)):
    """Create a new user or return existing one by name."""
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    result = await db.execute(select(User).where(User.name == name))
    user = result.scalar_one_or_none()

    if user:
        return user

    user = User(name=name)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.get("", response_model=list[UserResponse])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()
