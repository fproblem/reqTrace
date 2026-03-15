import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import users, pages, highlights, diff, settings
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

app.include_router(users.router)
app.include_router(pages.router)
app.include_router(confluence_proxy_router)
app.include_router(highlights.router)
app.include_router(diff.router)
app.include_router(settings.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
