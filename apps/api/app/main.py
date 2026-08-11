from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent_runtime import AgentRunRegistry
from app.config import Settings, get_settings
from app.database import create_database_engine, create_session_factory
from app.mcp_config import McpServerStore
from app.routers import agent, health, inbox, mcp, tasks


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    engine = create_database_engine(app_settings.database_url)
    agent_runs = AgentRunRegistry()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = engine
        app.state.session_factory = create_session_factory(engine)
        app.state.agent_runs = agent_runs
        app.state.settings = app_settings
        app.state.mcp_servers = McpServerStore(app_settings)
        yield
        engine.dispose()

    app = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        description="Private local API for Life Dashboard.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(tasks.router, prefix="/api/v1")
    app.include_router(inbox.router, prefix="/api/v1")
    app.include_router(agent.router, prefix="/api/v1")
    app.include_router(mcp.router, prefix="/api/v1")
    return app


app = create_app()
