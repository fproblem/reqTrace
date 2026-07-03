import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import get_current_user
from app.routers import auth, users, pages, highlights, diff, projects
from app.routers.pages import confluence_proxy_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="ReqTrace API",
    description="Requirements traceability tool for QA teams",
    version="1.0.0",
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


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
