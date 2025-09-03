#!/usr/bin/env python3
"""
Standalone checker for .NET DLL loading + BLE CW flow.

Usage examples:
  # Just verify DLL loading and eCommandType:
  python check_ble_runtime.py --dll-dir "backend/dlls"

  # Also try a short BLE CW run (only if device/MAC is available):
  python check_ble_runtime.py --dll-dir "backend/dlls" --mac AA:BB:CC:DD:EE:FF --freq-mhz 868 --power-dbm 14

  # Verbose
  python check_ble_runtime.py --dll-dir "backend/dlls" --verbose
"""

import os
import sys
import time
import argparse
import traceback
import platform

def log(s="", *, end="\n"):
    print(s, end=end, flush=True)

def step(title):
    log(f"\n=== {title} ===")

def ok(msg="OK"):
    log(f"  ✔ {msg}")

def fail(msg="FAILED"):
    log(f"  ✖ {msg}")

def try_load_pythonnet():
    step("Boot pythonnet runtime")
    from importlib import import_module
    try:
        load = import_module("pythonnet").load
    except Exception as e:
        fail("pythonnet not installed / import failed")
        raise

    # prefer netfx (common for vendor SDKs), fallback to coreclr
    try:
        load("netfx")
        ok("pythonnet.load('netfx')")
    except Exception:
        log("  (netfx failed, trying coreclr…) ")
        load("coreclr")
        ok("pythonnet.load('coreclr')")

def add_dll_dir(dll_dir):
    step("Add DLL directory to search path")
    dll_dir = os.path.abspath(dll_dir)
    if not os.path.isdir(dll_dir):
        fail(f"Directory not found: {dll_dir}")
        raise FileNotFoundError(dll_dir)

    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(dll_dir)
        ok(f"Windows dll search: {dll_dir}")
    if dll_dir not in sys.path:
        sys.path.append(dll_dir)
        ok(f"sys.path += {dll_dir}")
    return dll_dir

def load_all_assemblies(dll_dir, verbose=False):
    step("Load .NET assemblies from dll_dir")
    import clr  # type: ignore
    loaded = []
    errors = []
    for fname in os.listdir(dll_dir):
        if not fname.lower().endswith(".dll"):
            continue
        full = os.path.join(dll_dir, fname)
        try:
            clr.AddReference(full)  # by full path
            loaded.append(fname)
            if verbose:
                log(f"  + {fname}")
        except Exception as e:
            # try by name
            try:
                clr.AddReference(os.path.splitext(fname)[0])
                loaded.append(fname + " (by name)")
                if verbose:
                    log(f"  + {fname} (by name)")
            except Exception as e2:
                errors.append((fname, str(e2)))
    if loaded:
        ok(f"Loaded {len(loaded)} assemblies")
    else:
        fail("No assemblies loaded — check your dll_dir")
    if errors and verbose:
        log("  (Some assemblies failed to load; may be native-only or already loaded)")
        for f, e in errors[:10]:
            log(f"    - {f}: {e}")
    return loaded, errors

def verify_ecommandtype(verbose=False):
    step("Verify Arad.WaterMeter…MetaData.eCommandType is resolvable")
    import importlib
    try:
        MetaData = importlib.import_module("Arad.WaterMeter.Communication.Headers.MetaData")
    except Exception as e:
        fail("Could not import MetaData module")
        raise

    if hasattr(MetaData, "eCommandType"):
        ok("MetaData.eCommandType found")
        return True

    # Try case-insensitive alias if vendor used PascalCase
    cand = next((n for n in dir(MetaData) if n.lower() == "ecommandtype"), None)
    if cand:
        setattr(MetaData, "eCommandType", getattr(MetaData, cand))
        ok(f"Aliased MetaData.{cand} → MetaData.eCommandType (case mismatch)")
        return True

    names = ", ".join(sorted([n for n in dir(MetaData) if not n.startswith("_")]))
    fail("eCommandType missing")
    if verbose:
        log(f"  Members under MetaData: {names}")
    raise RuntimeError("MetaData.eCommandType not found")

def try_ble_cw(mac, freq_hz, power_dbm, hold_s=0.4):
    step("BLE CW quick run")
    # Important: import after runtime + assemblies are loaded
    from BLE import BLE_Device
    from commands import hwtp_commands as cmd
    from structs import hwtp_structures as struct
    import enums

    dev = BLE_Device(mac)
    try:
        log(f"  Connecting to {mac} …")
        dev.Connect()
        ok("Connected")

        payload = struct.HWTP_LoraTestCw_t(
            freq=freq_hz,
            power=power_dbm,
            paMode=enums.hwtp_loratestpamode_e.HWTP_LORA_TEST_PA_AUTO,
        )
        log(f"  CW ON @ {freq_hz} Hz, {power_dbm} dBm …")
        dev.hwtp_set(cmd.HWTP_DBG_LORA_TEST_CW, payload)
        ok("CW set")
        time.sleep(hold_s)

        log("  CW STOP …")
        # If your API requires set instead of get for STOP, change next line accordingly:
        dev.hwtp_get(command=cmd.HWTP_DBG_LORA_TEST_STOP)
        ok("CW stopped")
    finally:
        log("  Disconnect …")
        try:
            dev.Disconnect()
        finally:
            ok("Disconnected")

def main():
    parser = argparse.ArgumentParser(description="Check .NET DLL loading and BLE CW path")
    parser.add_argument("--dll-dir", required=True, help="Path to backend/dlls folder")
    parser.add_argument("--mac", help="DUT MAC to test BLE CW")
    parser.add_argument("--freq-mhz", type=float, default=868.0, help="CW frequency in MHz (default 868)")
    parser.add_argument("--power-dbm", type=int, default=14, help="CW power in dBm (default 14)")
    parser.add_argument("--hold-sec", type=float, default=0.4, help="Time to hold CW before STOP")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    args = parser.parse_args()

    step("Environment")
    log(f"  Python: {sys.version.split()[0]} | Arch: {platform.machine()} | 64-bit: {sys.maxsize > 2**32}")
    log(f"  Platform: {platform.system()} {platform.release()}")
    log(f"  Venv: {sys.prefix}")
    log(f"  DLL dir: {os.path.abspath(args.dll_dir)}")

    # 1) pythonnet
    try:
        try_load_pythonnet()
    except Exception:
        traceback.print_exc()
        sys.exit(1)

    # 2) add dll dir
    try:
        dll_dir = add_dll_dir(args.dll_dir)
    except Exception:
        traceback.print_exc()
        sys.exit(1)

    # 3) load assemblies
    try:
        load_all_assemblies(dll_dir, verbose=args.verbose)
    except Exception:
        traceback.print_exc()
        sys.exit(1)

    # 4) verify MetaData.eCommandType
    try:
        verify_ecommandtype(verbose=args.verbose)
    except Exception:
        traceback.print_exc()
        sys.exit(1)

    # 5) optional BLE CW
    if args.mac:
        try:
            freq_hz = int(round(args.freq_mhz * 1e6))
            try_ble_cw(args.mac, freq_hz, args.power_dbm, hold_s=args.hold_sec)
            ok("BLE CW quick run completed")
        except Exception:
            traceback.print_exc()
            sys.exit(2)
    else:
        log("\n(No --mac provided → skipping BLE CW quick run)")

    log("\nAll checks completed.")
    sys.exit(0)

if __name__ == "__main__":
    main()
