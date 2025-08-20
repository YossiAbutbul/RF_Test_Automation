# backend/services/spectrum_service.py
from typing import Optional
from backend.Spectrum import SpectrumAnalyzer  # or from backend.devices.Spectrum import SpectrumAnalyzer

_analyzer: Optional[SpectrumAnalyzer] = None

def create_analyzer(ip: str, port: int) -> SpectrumAnalyzer:
    """Instantiate and connect to a SpectrumAnalyzer."""
    global _analyzer
    if _analyzer:
        # close any existing connection
        _analyzer.disconnect()
    _analyzer = SpectrumAnalyzer(ip, port)
    _analyzer.connect()
    return _analyzer

def get_analyzer() -> SpectrumAnalyzer:
    """Return the currently connected analyzer or raise an error."""
    if not _analyzer:
        raise RuntimeError("Analyzer not connected")
    return _analyzer

def release_analyzer() -> None:
    """Disconnect and clear the current analyzer instance."""
    global _analyzer
    if _analyzer:
        _analyzer.disconnect()
    _analyzer = None
