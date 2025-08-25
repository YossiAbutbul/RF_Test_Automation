from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes.analyzer_routes import router as analyzer_router

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Allow frontend to call API
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,         
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyzer_router)

@app.get("/")
def root():
    return {"status": "Backend running"}
