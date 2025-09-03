# backend/config.py
from __future__ import annotations

import os
from pathlib import Path

# Optional: load .env automatically if python-dotenv is available
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None

# Assume repo root is one level above backend/
_ROOT = Path(__file__).resolve().parents[1]
if load_dotenv:
    # load .env from repo root; safe no-op if not found
    load_dotenv(_ROOT / ".env", override=False)

def _split_dirs(val: str | None) -> list[str]:
    """
    Accept a single path or multiple separated by ';' or ','.
    Expands ~ and resolves to absolute paths when possible.
    """
    if not val:
        return []
    sep = ";" if ";" in val else ","
    parts = [p.strip().strip('"').strip("'") for p in val.split(sep)]
    out: list[str] = []
    for p in parts:
        if not p:
            continue
        try:
            out.append(str(Path(p).expanduser().resolve()))
        except Exception:
            out.append(p)
    return out

# === Your environment keys (as provided) ===
# dlls_path -> directory (or list) containing the vendor DLLs
# headers_dll_path -> explicit path to Arad.WaterMeter.Communication.Headers.dll
DLL_DIRS: list[str] = _split_dirs(os.getenv("dlls_path"))

# Default to backend/dlls if nothing is provided
if not DLL_DIRS:
    DLL_DIRS = [str((_ROOT / "backend" / "dlls").resolve())]

HEADERS_DLL_PATH: str | None = os.getenv("headers_dll_path")

# Helpful default if we ever need to AddReference by name
HEADERS_DLL_NAME: str = "Arad.WaterMeter.Communication.Headers"

# Simple flag to enable extra prints for debugging (optional)
DEBUG_DLL_LOADER: bool = os.getenv("RF_DEBUG_DLL_LOADER", "0") in ("1", "true", "True")
