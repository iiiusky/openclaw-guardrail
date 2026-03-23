"""
OpenClaw 企业安全服务

功能：扫描报告接收、安全策略下发（全局+设备级）、违规记录、AIG 情报代理、Marketplace 分发。
启动: uv run serve
"""

from __future__ import annotations

import argparse
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import init_db
from routers.activation import router as activation_router
from routers.policy import router as policy_router
from routers.reports import router as reports_router
from routers.violations import router as violations_router
from routers.intel_router import router as intel_router
from routers.marketplace import router as marketplace_router
from routers.asset_report import router as asset_report_router
from routers.llm_check import router as llm_check_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("openclaw-guardrail")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        from cache import redis_delete
        redis_delete("policy")
    except Exception:
        pass
    yield


app = FastAPI(title="OpenClaw 安全围栏系统", version="0.2.0", lifespan=lifespan)

# ── CORS middleware (development) ─────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(activation_router)
app.include_router(policy_router)
app.include_router(reports_router)
app.include_router(violations_router)
app.include_router(intel_router)
app.include_router(marketplace_router)
app.include_router(asset_report_router)
app.include_router(llm_check_router)

# ── Static file hosting (production: serve built Vue app) ──
web_dist = os.environ.get("WEB_DIST_DIR") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "web", "dist")
if os.path.isdir(web_dist):
    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(web_dist, "index.html"))

    app.mount("/assets", StaticFiles(directory=os.path.join(web_dist, "assets")), name="static-assets")

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        if path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        file_path = os.path.join(web_dist, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(web_dist, "index.html"))


def start():
    parser = argparse.ArgumentParser(description="OpenClaw 企业安全服务")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"), help="监听地址 (默认 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "80")), help="监听端口 (默认 80)")
    parser.add_argument("--reload", action="store_true", default=False, help="开启热重载")
    args = parser.parse_args()
    uvicorn.run("main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    start()
