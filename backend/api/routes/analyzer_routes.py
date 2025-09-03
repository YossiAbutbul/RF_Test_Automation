# backend/api/routes/analyzer_routes.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response, JSONResponse
from typing import Optional
import re

from api.models.analyzer_models import (
    AnalyzerConnectRequest, AnalyzerResponse,
    FrequencyParam, SpanParam, BandwidthParam,
    RefLevelParam, MarkerNameParam, ScreenshotParam
)
from services.spectrum_service import get_analyzer, create_analyzer, release_analyzer

# IMPORTANT: import the real driver location
from Spectrum.SpectrumAnalyzer import SpectrumAnalyzer  # path matches your repo

router = APIRouter(prefix="/analyzer", tags=["Spectrum Analyzer"])

def _maybe_get_analyzer() -> Optional[SpectrumAnalyzer]:
    try:
        return get_analyzer()
    except HTTPException:
        return None

def _num(s: str) -> float:
    m = re.search(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", str(s))
    return float(m.group(0)) if m else 0.0

# ----- Connect / Disconnect -----

@router.post("/connect", response_model=AnalyzerResponse)
def connect_analyzer(req: AnalyzerConnectRequest):
    try:
        analyzer = create_analyzer(req.ip, req.port)
        return AnalyzerResponse(status="connected", identity=analyzer.identify())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/disconnect")
def disconnect_analyzer():
    try:
        release_analyzer()
        return {"status": "disconnected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/identify", response_model=AnalyzerResponse)
def identify(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        return AnalyzerResponse(status="connected", identity=analyzer.identify())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ----- Setters -----

@router.post("/reset")
def reset(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.reset()
    return {"message": "Analyzer reset"}

@router.post("/set-center-frequency")
def set_center_frequency(data: FrequencyParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_center_frequency(data.value, data.units)
    return {"message": "Center frequency set"}

@router.post("/set-span")
def set_span(data: SpanParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_span(data.value, data.units)
    return {"message": "Span set"}

@router.post("/set-rbw")
def set_rbw(data: BandwidthParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_rbw(data.value, data.units)
    return {"message": "RBW set"}

@router.post("/set-vbw")
def set_vbw(data: BandwidthParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_vbw(data.value, data.units)
    return {"message": "VBW set"}

@router.post("/set-ref-level")
def set_ref_level(data: RefLevelParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_ref_level(data.dbm)
    return {"message": "Reference level set"}

@router.post("/set-ref-level-offset")
def set_ref_level_offset(data: RefLevelParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_ref_level_offset(data.dbm)
    return {"message": "Reference level offset set"}

@router.post("/set-peak-detector")
def set_peak_detector(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.set_peak_detector()
    return {"message": "Peak detector enabled"}

@router.post("/peak-search")
def peak_search(data: MarkerNameParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.peak_search(data.mark_name)
    return {"message": f"Peak search triggered on {data.mark_name}"}

# ----- Getters (robust; never 500 to the browser) -----

@router.get("/get-center-frequency", response_class=PlainTextResponse)
def get_center_frequency(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        if hasattr(analyzer, "get_center_frequency"):
            return analyzer.get_center_frequency()
        start = _num(getattr(analyzer, "get_start_frequency")())
        stop  = _num(getattr(analyzer, "get_stop_frequency")())
        return str((start + stop) / 2.0)
    except Exception as e:
        return Response(status_code=503, content=str(e))

@router.get("/get-span", response_class=PlainTextResponse)
def get_span(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        return analyzer.get_span()
    except Exception as e:
        return Response(status_code=503, content=str(e))

@router.get("/get-rbw", response_class=PlainTextResponse)
def get_rbw(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        return analyzer.get_rbw()
    except Exception as e:
        return Response(status_code=503, content=str(e))

@router.get("/get-vbw", response_class=PlainTextResponse)
def get_vbw(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        return analyzer.get_vbw()
    except Exception as e:
        return Response(status_code=503, content=str(e))

@router.get("/get-ref-level", response_class=PlainTextResponse)
def get_ref_level(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        return analyzer.get_ref_level()
    except Exception as e:
        return Response(status_code=503, content=str(e))

@router.get("/get-ref-level-offset", response_class=PlainTextResponse)
def get_ref_level_offset(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    try:
        return analyzer.get_ref_level_offset()
    except Exception as e:
        return Response(status_code=503, content=str(e))

# ----- CSV trace (graceful if disconnected) -----

@router.get("/get-raw-data", response_class=PlainTextResponse)
def get_raw_data(analyzer: Optional[SpectrumAnalyzer] = Depends(_maybe_get_analyzer)):
    if analyzer is None:
        return Response(status_code=204)
    if hasattr(analyzer, "is_connected") and not getattr(analyzer, "is_connected"):
        return Response(status_code=204)
    try:
        data = analyzer.get_raw_data()
        return PlainTextResponse(data)
    except Exception:
        return Response(status_code=204)

# ----- Snapshot for quick UI hydration -----

@router.get("/snapshot")
def snapshot(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    out = {}
    try:
        if hasattr(analyzer, "get_center_frequency"):
            out["centerHz"] = _num(analyzer.get_center_frequency())
    except Exception: pass
    for key, getter in [
        ("spanHz", "get_span"),
        ("rbwHz",  "get_rbw"),
        ("vbwHz",  "get_vbw"),
        ("refDbm", "get_ref_level"),
    ]:
        try:
            out[key] = _num(getattr(analyzer, getter)())
        except Exception:
            pass
    return JSONResponse(out)

# ----- screenshots -----

@router.post("/take-screenshot")
def take_screenshot(data: ScreenshotParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.take_screenshot(data.name)
    return {"message": f"Screenshot '{data.name}.png' saved on device"}

@router.get("/download-screenshot")
def download_screenshot(remote: str = "screenshot.png", local: str = "screenshot.png", analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.download_screenshot_via_ftp(remote, local)
    return {"message": f"Screenshot downloaded to {local}"}
