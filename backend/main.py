from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


from api.routes.tests_routes import router as tests_router
from api.routes.analyzer_routes import router as analyzer_router
from api.routes.tests_ble_routes import router as ble_tests_router


app = FastAPI(title="RF Automation API")

# --- CORS for Vite dev server / local app ---
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,  # EventSource does not send cookies by default
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ---
app.include_router(analyzer_router)
app.include_router(tests_router)
app.include_router(ble_tests_router)


@app.get("/health")
def health():
    return {"ok": True}
