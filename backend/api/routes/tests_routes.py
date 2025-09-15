from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field
from typing import Optional, AsyncGenerator, Dict, Any
from sse_starlette.sse import EventSourceResponse
import json

from services.tests_runner import (
    # LoRa
    run_tx_power, run_tx_power_stream,
    run_freq_accuracy, run_freq_accuracy_stream,
    # LTE
    run_lte_tx_power, run_lte_tx_power_stream,
    run_lte_frequency_accuracy, run_lte_frequency_accuracy_stream,
)

router = APIRouter(prefix="/tests", tags=["tests"])

# =========================
# Request Models
# =========================

class TxPowerBody(BaseModel):
    freq_hz: int = Field(..., description="Carrier frequency in Hz (LoRa)")
    power_dbm: int = Field(..., description="TX power in dBm (e.g., 14)")
    mac: str = Field(..., description="BLE MAC (e.g., D5A9F012CC39)")
    min_value: Optional[float] = Field(None, description="Lower bound for pass/fail")
    max_value: Optional[float] = Field(None, description="Upper bound for pass/fail")


class FreqAccuracyBody(BaseModel):
    freq_hz: int = Field(..., description="Carrier frequency in Hz (LoRa)")
    power_dbm: int = Field(..., description="TX power in dBm (e.g., 14)")
    mac: str = Field(..., description="BLE MAC")
    ppm_limit: Optional[float] = Field(None, description="Max absolute error in ppm for pass/fail")


class LteTxPowerBody(BaseModel):
    # Accept either EARFCN or frequency in Hz; the runner resolves mapping.
    earfcn: Optional[int] = Field(None, description="LTE EARFCN")
    freq_hz: Optional[int] = Field(None, description="LTE RF frequency (Hz)")
    power_dbm: int = Field(..., description="TX power in dBm (e.g., 23)")
    mac: str = Field(..., description="BLE MAC")
    min_value: Optional[float] = Field(None, description="Lower bound for pass/fail")
    max_value: Optional[float] = Field(None, description="Upper bound for pass/fail")


class LteFreqAccuracyBody(BaseModel):
    # Accept either EARFCN or frequency in Hz; the runner resolves mapping.
    earfcn: Optional[int] = Field(None, description="LTE EARFCN")
    freq_hz: Optional[int] = Field(None, description="LTE RF frequency (Hz)")
    power_dbm: int = Field(..., description="TX power in dBm during CW (e.g., 23)")
    mac: str = Field(..., description="BLE MAC")
    ppm_limit: Optional[float] = Field(None, description="Max absolute error in ppm for pass/fail")


# =========================
# LoRa — Tx Power
# =========================

@router.post("/tx-power")
async def api_tx_power(body: TxPowerBody):
    try:
        return await run_tx_power(
            freq_hz=body.freq_hz,
            power_dbm=body.power_dbm,
            mac=body.mac,
            min_value=body.min_value,
            max_value=body.max_value,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tx-power/stream")
async def api_tx_power_stream(
    request: Request,
    freq_hz: int = Query(...),
    power_dbm: int = Query(...),
    mac: str = Query(...),
    min_value: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
):
    async def event_gen() -> AsyncGenerator[Dict[str, Any], None]:
        try:
            async for evt in run_tx_power_stream(
                freq_hz=freq_hz,
                power_dbm=power_dbm,
                mac=mac,
                min_value=min_value,
                max_value=max_value,
            ):
                if await request.is_disconnected():
                    break
                yield {"event": evt["type"], "data": json.dumps(evt)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(e)})}

    return EventSourceResponse(event_gen(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# =========================
# LoRa — Frequency Accuracy
# =========================
# Keep both long and short paths for compatibility.

@router.post("/frequency-accuracy")
@router.post("/freq-accuracy")
async def api_frequency_accuracy(body: FreqAccuracyBody):
    try:
        return await run_freq_accuracy(
            freq_hz=body.freq_hz,
            power_dbm=body.power_dbm,
            mac=body.mac,
            ppm_limit=body.ppm_limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/frequency-accuracy/stream")
@router.get("/freq-accuracy/stream")
async def api_frequency_accuracy_stream(
    request: Request,
    freq_hz: int = Query(...),
    power_dbm: int = Query(...),
    mac: str = Query(...),
    ppm_limit: Optional[float] = Query(None),
):
    async def event_gen() -> AsyncGenerator[Dict[str, Any], None]:
        try:
            async for evt in run_freq_accuracy_stream(
                freq_hz=freq_hz,
                power_dbm=power_dbm,
                mac=mac,
                ppm_limit=ppm_limit,
            ):
                if await request.is_disconnected():
                    break
                yield {"event": evt["type"], "data": json.dumps(evt)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(e)})}

    return EventSourceResponse(event_gen(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# =========================
# LTE — Tx Power
# =========================

@router.post("/lte-tx-power")
async def api_lte_tx_power(body: LteTxPowerBody):
    earfcn_or_freq = body.earfcn if body.earfcn is not None else body.freq_hz
    if earfcn_or_freq is None:
        raise HTTPException(status_code=422, detail="Provide either 'earfcn' or 'freq_hz'.")
    try:
        return await run_lte_tx_power(
            earfcn=int(earfcn_or_freq),  # runner resolves EARFCN or frequency
            power_dbm=body.power_dbm,
            mac=body.mac,
            min_value=body.min_value,
            max_value=body.max_value,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/lte-tx-power/stream")
async def api_lte_tx_power_stream(
    request: Request,
    earfcn: Optional[int] = Query(None),
    freq_hz: Optional[int] = Query(None),
    power_dbm: int = Query(...),
    mac: str = Query(...),
    min_value: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
):
    if earfcn is None and freq_hz is None:
        raise HTTPException(status_code=422, detail="Provide either 'earfcn' or 'freq_hz'.")
    earfcn_or_freq = earfcn if earfcn is not None else int(freq_hz)  # type: ignore[arg-type]

    async def event_gen() -> AsyncGenerator[Dict[str, Any], None]:
        try:
            async for evt in run_lte_tx_power_stream(
                earfcn=earfcn_or_freq,   # runner resolves EARFCN or frequency
                power_dbm=power_dbm,
                mac=mac,
                min_value=min_value,
                max_value=max_value,
            ):
                if await request.is_disconnected():
                    break
                yield {"event": evt["type"], "data": json.dumps(evt)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(e)})}

    return EventSourceResponse(event_gen(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# =========================
# LTE — Frequency Accuracy (NEW)
# =========================

@router.post("/lte-frequency-accuracy")
@router.post("/lte-freq-accuracy")
async def api_lte_frequency_accuracy(body: LteFreqAccuracyBody):
    earfcn_or_freq = body.earfcn if body.earfcn is not None else body.freq_hz
    if earfcn_or_freq is None:
        raise HTTPException(status_code=422, detail="Provide either 'earfcn' or 'freq_hz'.")
    try:
        return await run_lte_frequency_accuracy(
            earfcn=int(earfcn_or_freq),  # runner resolves EARFCN or frequency
            power_dbm=body.power_dbm,
            mac=body.mac,
            ppm_limit=body.ppm_limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/lte-frequency-accuracy/stream")
@router.get("/lte-freq-accuracy/stream")
async def api_lte_frequency_accuracy_stream(
    request: Request,
    earfcn: Optional[int] = Query(None),
    freq_hz: Optional[int] = Query(None),
    power_dbm: int = Query(...),
    mac: str = Query(...),
    ppm_limit: Optional[float] = Query(None),
):
    if earfcn is None and freq_hz is None:
        raise HTTPException(status_code=422, detail="Provide either 'earfcn' or 'freq_hz'.")
    earfcn_or_freq = earfcn if earfcn is not None else int(freq_hz)  # type: ignore[arg-type]

    async def event_gen() -> AsyncGenerator[Dict[str, Any], None]:
        try:
            async for evt in run_lte_frequency_accuracy_stream(
                earfcn=earfcn_or_freq,   # runner resolves EARFCN or frequency
                power_dbm=power_dbm,
                mac=mac,
                ppm_limit=ppm_limit,
            ):
                if await request.is_disconnected():
                    break
                yield {"event": evt["type"], "data": json.dumps(evt)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(e)})}

    return EventSourceResponse(event_gen(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
