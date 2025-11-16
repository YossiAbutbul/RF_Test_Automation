# backend/api/routes/tests_routes.py
from __future__ import annotations

import asyncio
import json
from typing import Optional, AsyncGenerator, Dict, Any

from fastapi import APIRouter, HTTPException, Request, Query
from sse_starlette.sse import EventSourceResponse

# Existing test runners (LoRa + LTE)
from services.tests_runner import (
    # LoRa
    run_tx_power, run_tx_power_stream,
    run_freq_accuracy, run_freq_accuracy_stream,
    
    # LTE
    run_lte_tx_power, run_lte_tx_power_stream,
    run_lte_frequency_accuracy, run_lte_frequency_accuracy_stream,
)

# NEW: BLE Tx Power stream
from services.tests_ble import run_ble_tx_power_stream
from services.tests_lora import run_obw, run_obw_stream

router = APIRouter(prefix="/tests", tags=["tests"])


# -----------------------------
# Helpers
# -----------------------------

def _first(*vals):
    for v in vals:
        if v is not None:
            return v
    return None

async def _json_body(request: Request) -> Dict[str, Any]:
    try:
        return await request.json()
    except Exception:
        return {}

def _sse(gen: AsyncGenerator[Dict[str, Any], None], request: Request) -> EventSourceResponse:
    async def event_source():
        try:
            async for evt in gen:
                # if client disconnected, cancel the generator so it can run background cleanup
                if await request.is_disconnected():
                    try:
                        await gen.athrow(asyncio.CancelledError())
                    except Exception:
                        pass
                    break
                # event name is optional; data must be JSON string
                yield {"event": evt.get("type", "message"), "data": json.dumps(evt)}
        except asyncio.CancelledError:
            try:
                await gen.athrow(asyncio.CancelledError())
            except Exception:
                pass
            raise
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(e)})}
        finally:
            try:
                await gen.aclose()
            except Exception:
                pass
    # Disable buffering so SSE flushes continuously
    return EventSourceResponse(event_source(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# =============================
# BLE — Tx Power (NEW)
# =============================

@router.get("/ble/tx_power/stream")
async def api_ble_tx_power_stream_get(
    request: Request,
    mac: str = Query(...),
    powerParamHex: str = Query(...),    # plain int 6..31 (name kept for compat)
    channel: int = Query(..., ge=0, le=39),
    minValue: Optional[float] = Query(None),
    maxValue: Optional[float] = Query(None),
    simpleCwMode: Optional[bool] = Query(None),
):
    gen = run_ble_tx_power_stream(
        mac=mac.strip(),
        power_param_hex=powerParamHex,
        channel=int(channel),
        min_value=minValue,
        max_value=maxValue,
        simple_cw_mode=simpleCwMode,
    )
    return _sse(gen, request)

@router.post("/ble/tx_power/stream")
async def api_ble_tx_power_stream_post(request: Request):
    body = await _json_body(request)
    mac = str(body.get("mac", "")).strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    gen = run_ble_tx_power_stream(
        mac=mac,
        power_param_hex=_first(body.get("powerParamHex"), body.get("power_param_hex")),
        channel=int(body.get("channel")),
        min_value=_first(body.get("minValue"), body.get("min_value")),
        max_value=_first(body.get("maxValue"), body.get("max_value")),
        simple_cw_mode=_first(body.get("simpleCwMode"), body.get("simple_cw_mode")),
    )
    return _sse(gen, request)


# =============================
# LoRa — Tx Power
# =============================

@router.post("/tx-power")
async def api_tx_power(body: Dict[str, Any]):
    try:
        freq_hz   = int(_first(body.get("freq_hz"), body.get("freqHz")))
        power_dbm = int(_first(body.get("power_dbm"), body.get("powerDbm")))
        mac = str(body.get("mac", "")).strip()
        if not mac:
            raise ValueError("Missing 'mac'")
        min_value = _first(body.get("min_value"), body.get("minValue"))
        max_value = _first(body.get("max_value"), body.get("maxValue"))
        return await run_tx_power(freq_hz=freq_hz, power_dbm=power_dbm, mac=mac,
                                  min_value=min_value, max_value=max_value)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/tx-power/stream")
async def api_tx_power_stream_get(
    request: Request,
    freq_hz: Optional[int] = Query(None),
    freqHz: Optional[int] = Query(None),
    power_dbm: Optional[int] = Query(None),
    powerDbm: Optional[int] = Query(None),
    mac: str = Query(""),
    min_value: Optional[float] = Query(None),
    minValue: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
    maxValue: Optional[float] = Query(None),
):
    mac = mac.strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    freq = _first(freq_hz, freqHz)
    pwr  = _first(power_dbm, powerDbm)
    if freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'freq_hz'/'power_dbm'")
    gen = run_tx_power_stream(
        freq_hz=int(freq),
        power_dbm=int(pwr),
        mac=mac,
        min_value=_first(min_value, minValue),
        max_value=_first(max_value, maxValue),
    )
    return _sse(gen, request)

@router.post("/tx-power/stream")
async def api_tx_power_stream_post(request: Request):
    body = await _json_body(request)
    mac = str(body.get("mac", "")).strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    freq = _first(body.get("freq_hz"), body.get("freqHz"))
    pwr  = _first(body.get("power_dbm"), body.get("powerDbm"))
    if freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'freq_hz'/'power_dbm'")
    gen = run_tx_power_stream(
        freq_hz=int(freq),
        power_dbm=int(pwr),
        mac=mac,
        min_value=_first(body.get("min_value"), body.get("minValue")),
        max_value=_first(body.get("max_value"), body.get("maxValue")),
    )
    return _sse(gen, request)


# =============================
# LoRa — Frequency Accuracy
# =============================

@router.post("/frequency-accuracy")
@router.post("/freq-accuracy")
async def api_frequency_accuracy(body: Dict[str, Any]):
    try:
        freq_hz   = int(_first(body.get("freq_hz"), body.get("freqHz")))
        power_dbm = int(_first(body.get("power_dbm"), body.get("powerDbm")))
        mac = str(body.get("mac", "")).strip()
        if not mac:
            raise ValueError("Missing 'mac'")
        ppm_limit = _first(body.get("ppm_limit"), body.get("ppmLimit"))
        return await run_freq_accuracy(freq_hz=freq_hz, power_dbm=power_dbm, mac=mac,
                                       ppm_limit=ppm_limit)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/frequency-accuracy/stream")
@router.get("/freq-accuracy/stream")
async def api_frequency_accuracy_stream_get(
    request: Request,
    freq_hz: Optional[int] = Query(None),
    freqHz: Optional[int] = Query(None),
    power_dbm: Optional[int] = Query(None),
    powerDbm: Optional[int] = Query(None),
    mac: str = Query(""),
    ppm_limit: Optional[float] = Query(None),
    ppmLimit: Optional[float] = Query(None),
):
    mac = mac.strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    freq = _first(freq_hz, freqHz)
    pwr  = _first(power_dbm, powerDbm)
    if freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'freq_hz'/'power_dbm'")
    gen = run_freq_accuracy_stream(
        freq_hz=int(freq),
        power_dbm=int(pwr),
        mac=mac,
        ppm_limit=_first(ppm_limit, ppmLimit),
    )
    return _sse(gen, request)

@router.post("/frequency-accuracy/stream")
@router.post("/freq-accuracy/stream")
async def api_frequency_accuracy_stream_post(request: Request):
    body = await _json_body(request)
    mac = str(body.get("mac", "")).strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    freq = _first(body.get("freq_hz"), body.get("freqHz"))
    pwr  = _first(body.get("power_dbm"), body.get("powerDbm"))
    if freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'freq_hz'/'power_dbm'")
    gen = run_freq_accuracy_stream(
        freq_hz=int(freq),
        power_dbm=int(pwr),
        mac=mac,
        ppm_limit=_first(body.get("ppm_limit"), body.get("ppmLimit")),
    )
    return _sse(gen, request)

# =============================
# LoRa — Occupied Bandwidth (OBW)
# =============================
@router.post("/obw")
async def api_obw(body: Dict[str, Any]):
    """Run LoRa OBW test and return the final result (no streaming)."""
    try:
        freq_hz   = int(_first(body.get("freq_hz"), body.get("freqHz")))
        power_dbm = int(_first(body.get("power_dbm"), body.get("powerDbm")))
        bandwidth = int(_first(body.get("bandwidth"), body.get("bw")))
        datarate  = int(_first(body.get("datarate"), body.get("dr")))
        mac = str(body.get("mac", "")).strip()
        if not mac:
            raise ValueError("Missing 'mac'")
        duration_s = body.get("duration_s") or body.get("durationS") or 10.0
        return await run_obw(
            freq_hz=freq_hz,
            power_dbm=power_dbm,
            mac=mac,
            bandwidth=bandwidth,
            datarate=datarate,
            duration_s=float(duration_s),
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/obw/stream")
async def api_obw_stream_get(
    request: Request,
    freq_hz: Optional[int] = Query(None),
    freqHz: Optional[int] = Query(None),
    power_dbm: Optional[int] = Query(None),
    powerDbm: Optional[int] = Query(None),
    bandwidth: int = Query(...),
    bw: Optional[int] = Query(None),
    datarate: int = Query(...),
    dr: Optional[int] = Query(None),
    mac: str = Query(""),
    duration_s: Optional[float] = Query(10.0),
):
    mac = mac.strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    freq = _first(freq_hz, freqHz)
    pwr  = _first(power_dbm, powerDbm)
    bw_val = _first(bandwidth, bw)
    dr_val = _first(datarate, dr)
    if freq is None or pwr is None or bw_val is None or dr_val is None:
        raise HTTPException(
            status_code=422,
            detail="Missing 'freq_hz','power_dbm','bandwidth' or 'datarate'",
        )
    gen = run_obw_stream(
        freq_hz=int(freq),
        power_dbm=int(pwr),
        mac=mac,
        bandwidth=int(bw_val),
        datarate=int(dr_val),
        duration_s=float(duration_s) if duration_s is not None else 10.0,
    )
    return _sse(gen, request)

@router.post("/obw/stream")
async def api_obw_stream_post(request: Request):
    body = await _json_body(request)
    mac = str(body.get("mac", "")).strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    freq = _first(body.get("freq_hz"), body.get("freqHz"))
    pwr  = _first(body.get("power_dbm"), body.get("powerDbm"))
    bw_val = _first(body.get("bandwidth"), body.get("bw"))
    dr_val = _first(body.get("datarate"), body.get("dr"))
    if freq is None or pwr is None or bw_val is None or dr_val is None:
        raise HTTPException(
            status_code=422,
            detail="Missing 'freq_hz','power_dbm','bandwidth' or 'datarate'",
        )
    duration_s = body.get("duration_s") or body.get("durationS") or 10.0
    gen = run_obw_stream(
        freq_hz=int(freq),
        power_dbm=int(pwr),
        mac=mac,
        bandwidth=int(bw_val),
        datarate=int(dr_val),
        duration_s=float(duration_s),
    )
    return _sse(gen, request)


# =============================
# LTE — Tx Power
# =============================

@router.post("/lte-tx-power")
async def api_lte_tx_power(body: Dict[str, Any]):
    try:
        earfcn_or_freq = _first(body.get("earfcn"), body.get("freq_hz"), body.get("freqHz"))
        if earfcn_or_freq is None:
            raise ValueError("Provide either 'earfcn' or 'freq_hz'")
        power_dbm = int(_first(body.get("power_dbm"), body.get("powerDbm")))
        mac = str(body.get("mac", "")).strip()
        if not mac:
            raise ValueError("Missing 'mac'")
        return await run_lte_tx_power(
            earfcn=int(earfcn_or_freq),
            power_dbm=power_dbm,
            mac=mac,
            min_value=_first(body.get("min_value"), body.get("minValue")),
            max_value=_first(body.get("max_value"), body.get("maxValue")),
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/lte-tx-power/stream")
async def api_lte_tx_power_stream_get(
    request: Request,
    earfcn: Optional[int] = Query(None),
    freq_hz: Optional[int] = Query(None),
    freqHz: Optional[int] = Query(None),
    power_dbm: Optional[int] = Query(None),
    powerDbm: Optional[int] = Query(None),
    mac: str = Query(""),
    min_value: Optional[float] = Query(None),
    minValue: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
    maxValue: Optional[float] = Query(None),
):
    mac = mac.strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    earfcn_or_freq = _first(earfcn, freq_hz, freqHz)
    pwr = _first(power_dbm, powerDbm)
    if earfcn_or_freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'earfcn'/'freq_hz' and/or 'power_dbm'")
    gen = run_lte_tx_power_stream(
        earfcn=int(earfcn_or_freq),
        power_dbm=int(pwr),
        mac=mac,
        min_value=_first(min_value, minValue),
        max_value=_first(max_value, maxValue),
    )
    return _sse(gen, request)

@router.post("/lte-tx-power/stream")
async def api_lte_tx_power_stream_post(request: Request):
    body = await _json_body(request)
    mac = str(body.get("mac", "")).strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    earfcn_or_freq = _first(body.get("earfcn"), body.get("freq_hz"), body.get("freqHz"))
    pwr  = _first(body.get("power_dbm"), body.get("powerDbm"))
    if earfcn_or_freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'earfcn'/'freq_hz' and/or 'power_dbm'")
    gen = run_lte_tx_power_stream(
        earfcn=int(earfcn_or_freq),
        power_dbm=int(pwr),
        mac=mac,
        min_value=_first(body.get("min_value"), body.get("minValue")),
        max_value=_first(body.get("max_value"), body.get("maxValue")),
    )
    return _sse(gen, request)


# =============================
# LTE — Frequency Accuracy
# =============================

@router.post("/lte-frequency-accuracy")
@router.post("/lte-freq-accuracy")
async def api_lte_frequency_accuracy(body: Dict[str, Any]):
    try:
        earfcn_or_freq = _first(body.get("earfcn"), body.get("freq_hz"), body.get("freqHz"))
        if earfcn_or_freq is None:
            raise ValueError("Provide either 'earfcn' or 'freq_hz'")
        power_dbm = int(_first(body.get("power_dbm"), body.get("powerDbm")))
        mac = str(body.get("mac", "")).strip()
        if not mac:
            raise ValueError("Missing 'mac'")
        return await run_lte_frequency_accuracy(
            earfcn=int(earfcn_or_freq),
            power_dbm=power_dbm,
            mac=mac,
            ppm_limit=_first(body.get("ppm_limit"), body.get("ppmLimit")),
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/lte-frequency-accuracy/stream")
@router.get("/lte-freq-accuracy/stream")
async def api_lte_frequency_accuracy_stream_get(
    request: Request,
    earfcn: Optional[int] = Query(None),
    freq_hz: Optional[int] = Query(None),
    freqHz: Optional[int] = Query(None),
    power_dbm: Optional[int] = Query(None),
    powerDbm: Optional[int] = Query(None),
    mac: str = Query(""),
    ppm_limit: Optional[float] = Query(None),
    ppmLimit: Optional[float] = Query(None),
):
    mac = mac.strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    earfcn_or_freq = _first(earfcn, freq_hz, freqHz)
    pwr = _first(power_dbm, powerDbm)
    if earfcn_or_freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'earfcn'/'freq_hz' and/or 'power_dbm'")
    gen = run_lte_frequency_accuracy_stream(
        earfcn=int(earfcn_or_freq),
        power_dbm=int(pwr),
        mac=mac,
        ppm_limit=_first(ppm_limit, ppmLimit),
    )
    return _sse(gen, request)

@router.post("/lte-frequency-accuracy/stream")
@router.post("/lte-freq-accuracy/stream")
async def api_lte_frequency_accuracy_stream_post(request: Request):
    body = await _json_body(request)
    mac = str(body.get("mac", "")).strip()
    if not mac:
        raise HTTPException(status_code=422, detail="Missing 'mac'")
    earfcn_or_freq = _first(body.get("earfcn"), body.get("freq_hz"), body.get("freqHz"))
    pwr  = _first(body.get("power_dbm"), body.get("powerDbm"))
    if earfcn_or_freq is None or pwr is None:
        raise HTTPException(status_code=422, detail="Missing 'earfcn'/'freq_hz' and/or 'power_dbm'")
    gen = run_lte_frequency_accuracy_stream(
        earfcn=int(earfcn_or_freq),
        power_dbm=int(pwr),
        mac=mac,
        ppm_limit=_first(body.get("ppm_limit"), body.get("ppmLimit")),
    )
    return _sse(gen, request)
