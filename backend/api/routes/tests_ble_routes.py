from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

# Import the correct service generator
from services.tests_ble import run_ble_tx_power_stream

router = APIRouter(prefix="/tests/ble", tags=["BLE Tests"])


def _as_sse(event: dict) -> bytes:
    """
    Convert an event dict into Server-Sent Events format.
    Keeps the 'type' field for client-side handling (start, step, result, etc.).
    """
    t = event.get("type", "message")
    payload = json.dumps(event, ensure_ascii=False)
    return f"event: {t}\n" f"data: {payload}\n\n".encode("utf-8")


async def _tx_power_sse_gen(
    *,
    mac: str,
    power_param_hex: str,
    channel: int,
    min_value: Optional[float],
    max_value: Optional[float],
) -> AsyncGenerator[bytes, None]:
    """
    Bridge the async generator from services → SSE bytes.
    """
    try:
        async for ev in run_ble_tx_power_stream(
            mac=mac.strip(),
            power_param_hex=power_param_hex,
            channel=channel,
            min_value=min_value,
            max_value=max_value,
        ):
            yield _as_sse(ev)
            await asyncio.sleep(0)  # allow other tasks
    except Exception as e:
        err = {"type": "error", "error": str(e)}
        yield _as_sse(err)
        yield _as_sse({"type": "done", "ok": False})


@router.get("/tx-power/stream")
async def ble_tx_power_stream(
    mac: str = Query(..., description="BLE MAC address (hex, e.g., 80E1271FD8DD)"),
    power_param_hex: str = Query(..., description="BLE power parameter (hex or int, e.g., 0x1F or 31)"),
    channel: int = Query(37, description="BLE channel index (default 37 = 2402 MHz)"),
    min_value: Optional[float] = Query(None, description="Optional lower limit (dBm)"),
    max_value: Optional[float] = Query(None, description="Optional upper limit (dBm)"),
):
    """
    SSE endpoint for BLE Tx Power.
    The frontend BLE runner connects here.
    """
    try:
        gen = _tx_power_sse_gen(
            mac=mac,
            power_param_hex=power_param_hex,
            channel=channel,
            min_value=min_value,
            max_value=max_value,
        )
        return StreamingResponse(gen, media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
