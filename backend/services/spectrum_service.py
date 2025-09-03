# backend/services/spectrum_service.py
from __future__ import annotations
import os
from typing import Optional
from fastapi import HTTPException

# Your real driver module & class
from Spectrum.SpectrumAnalyzer import SpectrumAnalyzer  # noqa: E402

_analyzer: Optional[SpectrumAnalyzer] = None
_addr: Optional[str] = None
_port: Optional[int] = None

def _default_ip() -> str:
    return os.getenv("SPECTRUM_IP", "172.16.10.1")

def _default_port() -> int:
    try:
        return int(os.getenv("SPECTRUM_PORT", "5555"))
    except Exception:
        return 5555

def create_analyzer(ip: Optional[str] = None, port: Optional[int] = None) -> SpectrumAnalyzer:
    """
    Create, connect and cache a SpectrumAnalyzer instance.
    """
    global _analyzer, _addr, _port
    ip = ip or _default_ip()
    port = int(port or _default_port())

    # If already connected to same target, reuse
    if _analyzer is not None and _addr == ip and _port == port and _analyzer.is_connected:
        return _analyzer

    spec = SpectrumAnalyzer(ip, port=port)
    spec.connect()  # will raise on failure

    _analyzer = spec
    _addr = ip
    _port = port
    return spec

def release_analyzer() -> None:
    global _analyzer, _addr, _port
    try:
        if _analyzer is not None:
            try:
                _analyzer.disconnect()
            except Exception:
                pass
    finally:
        _analyzer = None
        _addr = None
        _port = None

def get_analyzer() -> SpectrumAnalyzer:
    """
    Return the cached analyzer or raise 503 if not connected.
    """
    if _analyzer is None or not _analyzer.is_connected:
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
