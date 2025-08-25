from typing import Optional
from Spectrum.SpectrumAnalyzer import SpectrumAnalyzer

_analyzer: Optional[SpectrumAnalyzer] = None

def create_analyzer(ip: str, port: int) -> SpectrumAnalyzer:
    global _analyzer
    if _analyzer:
        _analyzer.disconnect()
    _analyzer = SpectrumAnalyzer(ip, port)
    _analyzer.connect()
    return _analyzer

def get_analyzer() -> SpectrumAnalyzer:
    if not _analyzer:
        raise RuntimeError("Analyzer not connected")
    return _analyzer

def release_analyzer() -> None:
    global _analyzer
    if _analyzer:
        _analyzer.disconnect()
    _analyzer = None
