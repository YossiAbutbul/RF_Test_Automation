from __future__ import annotations

import asyncio
import json
from typing import Optional, AsyncGenerator, Dict, Any

from fastapi import APIRouter, HTTPException, Request, Query
from sse_starlette.sse import EventSourceResponse

# Compat shim to split implementations
from services.tests_runner import (
    # LoRa
    run_tx_power, run_tx_power_stream,
    run_freq_accuracy, run_freq_accuracy_stream,
    # LTE
    run_lte_tx_power, run_lte_tx_power_stream,
    run_lte_frequency_accuracy, run_lte_frequency_accuracy_stream,
)

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
    return EventSourceResponse(event_source(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# -----------------------------
# LoRa — Tx Power
# -----------------------------

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

# -----------------------------
# LoRa — Frequency Accuracy
# -----------------------------

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

# -----------------------------
# LTE — Tx Power
# -----------------------------

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

# -----------------------------
# LTE — Frequency Accuracy
# -----------------------------

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
