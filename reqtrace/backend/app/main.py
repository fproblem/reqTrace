import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import get_current_user
from app.config import settings
from app.jobs.scheduler import auto_refresh_loop
from app.routers import auth, users, pages, highlights, diff, projects, notifications
from app.routers.pages import confluence_proxy_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ночное автообновление (v1.6.2): планировщик — фоновая задача процесса
    # приложения; от двойного запуска (--reload, второй инстанс) страхует
    # advisory-lock внутри самого прогона. TestClient без контекст-менеджера
    # lifespan не исполняет — юнит-тесты задачу не запускают.
    task = asyncio.create_task(auto_refresh_loop()) if settings.AUTO_REFRESH_ENABLED else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="ReqTrace API",
    description="Requirements traceability tool for QA teams",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Все роутеры, кроме auth, закрыты сессией на уровне include_router —
# новый эндпоинт в любом из них защищён автоматически (страховка — обход
# app.routes в tests/test_auth.py).
protected = [Depends(get_current_user)]

app.include_router(auth.router)
app.include_router(users.router, dependencies=protected)
app.include_router(pages.router, dependencies=protected)
app.include_router(confluence_proxy_router, dependencies=protected)
app.include_router(highlights.router, dependencies=protected)
app.include_router(diff.router, dependencies=protected)
app.include_router(projects.router, dependencies=protected)
app.include_router(notifications.router, dependencies=protected)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
