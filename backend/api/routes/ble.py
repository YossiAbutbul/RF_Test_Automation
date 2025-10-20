from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional, AsyncGenerator
import asyncio
import json
import time
import platform
import contextlib

# ---------- Optional deps ----------
try:
    from bleak import BleakScanner
except Exception:
    BleakScanner = None

IS_WINDOWS = platform.system().lower().startswith("win")
try:
    if IS_WINDOWS:
        from winsdk.windows.devices.bluetooth.advertisement import (
            BluetoothLEAdvertisementWatcher,
            BluetoothLEScanningMode,
            BluetoothLEAdvertisementReceivedEventArgs,
        )
    else:
        BluetoothLEAdvertisementWatcher = None  # type: ignore
except Exception:
    BluetoothLEAdvertisementWatcher = None  # type: ignore

router = APIRouter(prefix="/api/ble", tags=["ble"])


def sse_event(data: Dict[str, Any], event: Optional[str] = None) -> bytes:
    payload = ""
    if event:
        payload += "event: " + event + "\n"
    payload += "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"
    return payload.encode("utf-8")


def _mac_from_bt_addr(addr: int) -> str:
    try:
        hex12 = f"{addr:012X}"
        return ":".join(hex12[i : i + 2] for i in range(0, 12, 2))
    except Exception:
        return f"{addr}"


def _safe_get(obj, *names):
    for n in names:
        if hasattr(obj, n):
            return getattr(obj, n)
    return None


# ------------------------------
# WinRT (Windows) implementations
# ------------------------------
async def _scan_windows_winrt(duration: int) -> List[Dict[str, Any]]:
    if not IS_WINDOWS or BluetoothLEAdvertisementWatcher is None:
        return []
    results: Dict[str, Dict[str, Any]] = {}

    watcher = BluetoothLEAdvertisementWatcher()
    try:
        watcher.scanning_mode = BluetoothLEScanningMode.ACTIVE  # type: ignore[attr-defined]
    except Exception:
        pass

    def _on_received(sender, args: "BluetoothLEAdvertisementReceivedEventArgs"):
        bt_addr = _safe_get(args, "BluetoothAddress", "bluetooth_address")
        if bt_addr is None:
            return
        mac = _mac_from_bt_addr(int(bt_addr))
        adv = _safe_get(args, "Advertisement", "advertisement")
        name = _safe_get(adv, "LocalName", "local_name") if adv is not None else None
        rssi = _safe_get(args, "RawSignalStrengthInDBm", "raw_signal_strength_in_d_bm")
        try:
            if isinstance(rssi, float):
                rssi = int(rssi)
        except Exception:
            rssi = None
        if not isinstance(rssi, int):
            rssi = None
        results[mac] = {"mac": mac, "name": name or None, "rssi": rssi}

    token = watcher.add_received(_on_received)  # type: ignore[attr-defined]
    try:
        watcher.start()
        await asyncio.sleep(duration)
    finally:
        with contextlib.suppress(Exception):
            watcher.stop()
        with contextlib.suppress(Exception):
            watcher.remove_received(token)  # type: ignore[attr-defined]
    return list(results.values())


async def _stream_windows_winrt(duration: int, out_q: asyncio.Queue, debug: bool = False):
    """
    Push dicts into out_q as they come from WinRT watcher. Returns when duration elapses.
    """
    if not IS_WINDOWS or BluetoothLEAdvertisementWatcher is None:
        return
    watcher = BluetoothLEAdvertisementWatcher()
    try:
        watcher.scanning_mode = BluetoothLEScanningMode.ACTIVE  # type: ignore[attr-defined]
    except Exception:
        pass

    def _on_received(sender, args: "BluetoothLEAdvertisementReceivedEventArgs"):
        bt_addr = _safe_get(args, "BluetoothAddress", "bluetooth_address")
        if bt_addr is None:
            return
        mac = _mac_from_bt_addr(int(bt_addr))
        adv = _safe_get(args, "Advertisement", "advertisement")
        name = _safe_get(adv, "LocalName", "local_name") if adv is not None else None
        rssi = _safe_get(args, "RawSignalStrengthInDBm", "raw_signal_strength_in_d_bm")
        try:
            if isinstance(rssi, float):
                rssi = int(rssi)
        except Exception:
            rssi = None
        if not isinstance(rssi, int):
            rssi = None
        msg = {"mac": mac, "name": name or None, "rssi": rssi, "src": "winrt" if debug else None}
        try:
            out_q.put_nowait(msg)
        except asyncio.QueueFull:
            pass

    token = watcher.add_received(_on_received)  # type: ignore[attr-defined]
    try:
        watcher.start()
        await asyncio.sleep(duration)
    finally:
        with contextlib.suppress(Exception):
            watcher.stop()
        with contextlib.suppress(Exception):
            watcher.remove_received(token)  # type: ignore[attr-defined]


# ------------------------------
# Bleak implementations (all OS)
# ------------------------------
async def _scan_bleak(duration: int) -> List[Dict[str, Any]]:
    if BleakScanner is None:
        return []
    try:
        found = await BleakScanner.discover(timeout=duration)
    except Exception:
        return []
    out: List[Dict[str, Any]] = []
    for d in found:
        mac = getattr(d, "address", None)
        nm = getattr(d, "name", None) or None
        rssi = getattr(d, "rssi", None)
        try:
            if isinstance(rssi, float):
                rssi = int(rssi)
        except Exception:
            rssi = None
        out.append({"mac": mac, "name": nm, "rssi": rssi if isinstance(rssi, int) else None})
    return out


async def _stream_bleak(duration: int, out_q: asyncio.Queue, debug: bool = False):
    if BleakScanner is None:
        return
    start = time.perf_counter()
    while (time.perf_counter() - start) < duration:
        try:
            found = await BleakScanner.discover(timeout=2)
        except Exception:
            await asyncio.sleep(0.2)
            continue
        for d in found:
            mac = getattr(d, "address", None)
            if not mac:
                continue
            nm = getattr(d, "name", None) or None
            rssi = getattr(d, "rssi", None)
            try:
                if isinstance(rssi, float):
                    rssi = int(rssi)
            except Exception:
                rssi = None
            msg = {"mac": mac, "name": nm, "rssi": rssi if isinstance(rssi, int) else None, "src": "bleak" if debug else None}
            try:
                out_q.put_nowait(msg)
            except asyncio.QueueFull:
                pass
        await asyncio.sleep(0.1)


# --------------------------
# Public endpoints
# --------------------------
@router.get("/scan")
async def scan_ble(duration: int = Query(20, ge=1, le=60)) -> List[Dict[str, Any]]:
    """
    One-shot scan. On Windows tries WinRT watcher for accurate RSSI,
    else falls back to Bleak discovery.
    """
    if IS_WINDOWS and BluetoothLEAdvertisementWatcher is not None:
        winrt = await _scan_windows_winrt(duration)
        # If WinRT returns nothing, fall back to Bleak as a safety net
        if winrt:
            return winrt
    return await _scan_bleak(duration)


@router.get("/scan/stream")
async def scan_ble_stream(
    duration: int = Query(20, ge=1, le=120),
    backend: str = Query("auto", regex="^(auto|winrt|bleak)$"),
    debug: bool = Query(False)
) -> StreamingResponse:
    """
    Streaming scan (SSE).
    - backend=winrt  -> WinRT watcher only (Windows 10/11)
    - backend=bleak  -> Bleak periodic discover only (any OS)
    - backend=auto   -> Run both (on Windows): whichever yields, you see it.
    Includes keep-alive comments and always ends with 'event: done'.
    Set debug=1 to include 'src' field in events ('winrt' or 'bleak').
    """
    async def _events() -> AsyncGenerator[bytes, None]:
        # Immediate hello event so clients see output
        yield sse_event({"hello": True, "backend": backend, "debug": bool(debug)})

        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=4096)
        tasks: List[asyncio.Task] = []

        try:
            # Decide which producers to run
            if backend == "winrt":
                if IS_WINDOWS and BluetoothLEAdvertisementWatcher is not None:
                    tasks.append(asyncio.create_task(_stream_windows_winrt(duration, queue, debug)))
                else:
                    # report unavailability quickly
                    yield sse_event({"warning": "winrt_not_available"})
            elif backend == "bleak":
                if BleakScanner is not None:
                    tasks.append(asyncio.create_task(_stream_bleak(duration, queue, debug)))
                else:
                    yield sse_event({"warning": "bleak_not_available"})
            else:  # auto
                # On Windows, start both; elsewhere, start bleak if available.
                if IS_WINDOWS and BluetoothLEAdvertisementWatcher is not None:
                    tasks.append(asyncio.create_task(_stream_windows_winrt(duration, queue, debug)))
                if BleakScanner is not None:
                    tasks.append(asyncio.create_task(_stream_bleak(duration, queue, debug)))
                if not tasks:
                    yield sse_event({"warning": "no_backend_available"})

            # Stream out whatever arrives; keep-alive every second
            started = time.perf_counter()
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=1.0)
                    # Drop None fields to keep payload compact
                    if not debug:
                        item = {k: v for k, v in item.items() if v is not None and k != "src"}
                    yield sse_event(item)
                except asyncio.TimeoutError:
                    # keep-alive
                    elapsed = int(time.perf_counter() - started)
                    yield sse_event({"tick": elapsed, "note": "keepalive"} if debug else {"tick": elapsed})
                # exit condition: duration elapsed AND all tasks done AND queue empty
                if (time.perf_counter() - started) >= duration:
                    if all(t.done() for t in tasks) and queue.empty():
                        break
        finally:
            for t in tasks:
                t.cancel()
                with contextlib.suppress(Exception):
                    await t

        # final 'done'
        yield sse_event({"count": 0}, event="done")

    return StreamingResponse(
        _events(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
