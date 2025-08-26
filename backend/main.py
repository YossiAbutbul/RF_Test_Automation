from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response
from api.routes.analyzer_routes import router as analyzer_router

app = FastAPI()

# Allow your dev origins explicitly (Vite etc.)
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Failsafe CORS: add headers on EVERY response, even exceptions
@app.middleware("http")
async def add_cors_always(request: Request, call_next):
    try:
        resp = await call_next(request)
    except Exception as e:
        # Ensure 500s also carry CORS so the browser shows the real error
        resp = PlainTextResponse(str(e), status_code=500)

    origin = request.headers.get("origin", "")
    if origin and (origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Methods"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "*"
    return resp

# Handle preflight explicitly (handy if any proxy/cache gets in the way)
@app.options("/{path:path}")
async def preflight(request: Request):
    origin = request.headers.get("origin", "")
    acrh = request.headers.get("access-control-request-headers", "*")
    headers = {
        "Access-Control-Allow-Origin": origin if origin else "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": acrh,
        "Access-Control-Max-Age": "86400",
    }
    return Response(status_code=204, headers=headers)

@app.get("/")
def root():
    return {"status": "Backend running"}

# IMPORTANT: the router already has prefix="/analyzer"
app.include_router(analyzer_router)
