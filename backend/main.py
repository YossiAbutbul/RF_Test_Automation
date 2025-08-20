from fastapi import FastAPI
from backend.api.routes.analyzer_routes import router as analyzer_router

app = FastAPI(title="RF Automation API")

# mount your router under its prefix
app.include_router(analyzer_router)

# you can add more routers or middleware here
