# backend/api/routes/tests_routes.py
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, AsyncGenerator, Dict, Any
from sse_starlette.sse import EventSourceResponse
import json

from services.tests_runner import (
    run_tx_power, run_tx_power_stream,
    run_freq_accuracy, run_freq_accuracy_stream,
)

router = APIRouter(prefix="/tests", tags=["tests"])

# ----- Tx Power models & routes -----

class TxPowerReq(BaseModel):
    mac: str = Field(..., description="Hex MAC (colons/dashes ok)")
    freq_hz: int
    power_dbm: int
    min_value: Optional[float] = None
    max_value: Optional[float] = None

@router.post("/tx-power")
async def tx_power(req: TxPowerReq):
    try:
        return await run_tx_power(
            freq_hz=req.freq_hz,
            power_dbm=req.power_dbm,
            mac=req.mac,
            min_value=req.min_value,
            max_value=req.max_value,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/tx-power/stream")
async def tx_power_stream(
    request: Request,
    mac: str,
    freq_hz: int,
    power_dbm: int,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
):
    """
    Server-Sent Events stream.
    NOTE: We JSON-encode 'data' so the frontend's JSON.parse works.
    """
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
            # Emit structured error so UI shows why
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(e)})}
        # no explicit 'done' here; the runner sends 'done' as its last event

    return EventSourceResponse(
        event_gen(),
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

# ----- Frequency Accuracy models & routes -----

class FreqAccuracyReq(BaseModel):
    mac: str = Field(..., description="Hex MAC (colons/dashes ok)")
    freq_hz: int
    power_dbm: int
    ppm_limit: Optional[float] = Field(None, description="Max |ppm| allowed for PASS")

@router.post("/freq-accuracy")
async def freq_accuracy(req: FreqAccuracyReq):
    try:
        return await run_freq_accuracy(
            freq_hz=req.freq_hz,
            power_dbm=req.power_dbm,
            mac=req.mac,
            ppm_limit=req.ppm_limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/freq-accuracy/stream")
async def freq_accuracy_stream(
    request: Request,
    mac: str,
    freq_hz: int,
    power_dbm: int,
    ppm_limit: Optional[float] = None,
):
    """
    Server-Sent Events stream for Frequency Accuracy.
    """
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

    return EventSourceResponse(
        event_gen(),
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
