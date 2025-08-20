from fastapi import APIRouter, Depends, HTTPException
from backend.api.models.analyzer_models import (
    AnalyzerConnectRequest, AnalyzerResponse,
    FrequencyParam, SpanParam, BandwidthParam,
    RefLevelParam, MarkerNameParam, ScreenshotParam
)
from backend.services.spectrum_service import get_analyzer, create_analyzer, release_analyzer
from backend.Spectrum import SpectrumAnalyzer

router = APIRouter(prefix="/analyzer", tags=["Spectrum Analyzer"])


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


# ----- Analyzer Commands -----

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


@router.get("/get-marker-power", response_model=str)
def get_marker_power(mark_name: str = "MARK1", analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_marker_power(mark_name)


@router.get("/get-marker-frequency", response_model=str)
def get_marker_frequency(mark_name: str = "MARK1", analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_marker_frequency(mark_name)


@router.get("/get-rbw", response_model=str)
def get_rbw(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_rbw()


@router.get("/get-vbw", response_model=str)
def get_vbw(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_vbw()


@router.get("/get-span", response_model=str)
def get_span(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_span()


@router.get("/get-ref-level", response_model=str)
def get_ref_level(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_ref_level()


@router.get("/get-ref-level-offset", response_model=str)
def get_ref_level_offset(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_ref_level_offset()


@router.get("/get-raw-data", response_model=str)
def get_raw_data(analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    return analyzer.get_raw_data()


@router.post("/take-screenshot")
def take_screenshot(data: ScreenshotParam, analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.take_screenshot(data.name)
    return {"message": f"Screenshot '{data.name}.png' saved on device"}


@router.get("/download-screenshot")
def download_screenshot(remote: str = "screenshot.png", local: str = "screenshot.png", analyzer: SpectrumAnalyzer = Depends(get_analyzer)):
    analyzer.download_screenshot_via_ftp(remote, local)
    return {"message": f"Screenshot downloaded to {local}"}
