from __future__ import annotations

import json
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

# Service runner we just created
from services.tests_ble import run_tx_power_stream

router = APIRouter(prefix="/tests/ble", tags=["BLE Tests"])


def _as_sse(event: dict) -> str:
    """
    Convert an event dict (from run_tx_power_stream) into Server-Sent Events format.
    We use the 'type' field as a named event for cleaner client-side handling.
    """
    t = event.get("type", "message")
    # Note: keep JSON on a single line; SSE uses a blank line as separator.
    payload = json.dumps(event, ensure_ascii=False)
    return f"event: {t}\n" f"data: {payload}\n\n"


async def _tx_power_sse_gen(
    *,
    mac: str,
    freq_hz: int,
    power_dbm: int,
    min_value: Optional[float],
    max_value: Optional[float],
) -> AsyncGenerator[bytes, None]:
    """
    Bridge the async generator from services → SSE bytes.
    """
    try:
        async for ev in run_tx_power_stream(
            mac=mac,
            freq_hz=int(freq_hz),
            power_dbm=int(power_dbm),
            min_value=min_value,
            max_value=max_value,
        ):
            yield _as_sse(ev).encode("utf-8")
    except Exception as e:
        # Emit a terminal error event so the UI can surface it nicely.
        err = {"type": "error", "error": str(e)}
        yield _as_sse(err).encode("utf-8")
        # Then a done event to let the client close cleanly.
        yield _as_sse({"type": "done", "ok": False}).encode("utf-8")


@router.get("/tx-power/stream")
async def ble_tx_power_stream(
    mac: str = Query(..., description="BLE MAC address (hex, no separators)"),
    freq_hz: int = Query(..., description="Analyzer center frequency in Hz"),
    power_dbm: int = Query(..., description="Requested BLE TX power in dBm"),
    min_value: Optional[float] = Query(None, description="Optional lower limit (dBm)"),
    max_value: Optional[float] = Query(None, description="Optional upper limit (dBm)"),
):
    """
    Server-Sent Events endpoint for BLE Tx Power.
    The client (RunModal) will open an EventSource to this URL.
    """
    try:
        gen = _tx_power_sse_gen(
            mac=mac.strip(),
            freq_hz=freq_hz,
            power_dbm=power_dbm,
            min_value=min_value,
            max_value=max_value,
        )
        return StreamingResponse(gen, media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
