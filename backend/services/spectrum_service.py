# backend/services/spectrum_service.py
from __future__ import annotations

import os
from typing import Optional
from fastapi import HTTPException

# Import your real driver (package name as in your project)
# If your package path is different (e.g., "SpectrumAnalyzer" in project root),
# adjust this import accordingly.
from Spectrum.SpectrumAnalyzer import SpectrumAnalyzer  # type: ignore

# -------------------------
# Module-level singletons
# -------------------------
_analyzer: Optional[SpectrumAnalyzer] = None
_addr: Optional[str] = None
_port: Optional[int] = None


# -------------------------
# Defaults & helpers
# -------------------------
def _default_ip() -> str:
    """
    Default analyzer IP, overridable via env var SPECTRUM_IP.
    """
    return os.getenv("SPECTRUM_IP", "172.16.10.1")


def _default_port() -> int:
    """
    Default analyzer TCP port, overridable via env var SPECTRUM_PORT.
    R&S FSC3 SCPI/TCP is commonly 5555.
    """
    try:
        return int(os.getenv("SPECTRUM_PORT", "5555"))
    except Exception:
        return 5555


# -------------------------
# Public API
# -------------------------
def create_analyzer(ip: Optional[str] = None, port: Optional[int] = None) -> SpectrumAnalyzer:
    """
    Create and connect a SpectrumAnalyzer, caching it globally.
    If an analyzer already exists and is connected but the target differs, the old one is closed.
    Raises HTTPException on failure.
    """
    global _analyzer, _addr, _port

    ip = ip or _default_ip()
    port = port or _default_port()

    # Reuse if same target and connected
    if _analyzer is not None and getattr(_analyzer, "is_connected", False):
        if _addr == ip and _port == port:
            return _analyzer
        # Different target → close the previous one
        try:
            _analyzer.disconnect()
        except Exception:
            pass
        _analyzer = None

    try:
        analyzer = SpectrumAnalyzer(ip, port)  # (ip, port) signature in your driver
        analyzer.connect()
    except Exception as e:
        # Normalize to FastAPI error for consistent handling in routes/runners
        raise HTTPException(status_code=503, detail=f"Failed to connect analyzer at {ip}:{port} → {e}")

    _analyzer = analyzer
    _addr, _port = ip, port
    return analyzer


def get_analyzer() -> SpectrumAnalyzer:
    """
    Return the cached analyzer or raise 503 if not connected.
    """
    if _analyzer is None or not getattr(_analyzer, "is_connected", False):
        raise HTTPException(status_code=503, detail="Analyzer not connected")
    return _analyzer


def ensure_analyzer(ip: Optional[str] = None, port: Optional[int] = None) -> SpectrumAnalyzer:
    """
    Always returns a connected analyzer (auto-connects if needed).
    """
    try:
        return get_analyzer()
    except HTTPException:
        return create_analyzer(ip, port)


def release_analyzer() -> None:
    """
    Disconnect and clear the cached analyzer (best-effort).
    Useful for tests or manual resets.
    """
    global _analyzer, _addr, _port
    if _analyzer is not None:
        try:
            _analyzer.disconnect()
        except Exception:
            pass
    _analyzer = None
    _addr = None
    _port = None
