#!/usr/bin/env python3
import os, sys, argparse, platform, traceback

def boot_pythonnet():
    from pythonnet import load
    try:
        load("netfx")   # vendor SDKs usually target .NET Framework
        print("✔ pythonnet.load('netfx')")
    except Exception:
        load("coreclr")
        print("✔ pythonnet.load('coreclr')")

def add_dll_dir(path):
    import os
    import sys
    p = os.path.abspath(path)
    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(p)
    if p not in sys.path:
        sys.path.append(p)
    print("✔ dll dir:", p)
    return p

def load_assemblies(dll_dir, verbose=False):
    import clr  # type: ignore
    loaded = []
    for f in os.listdir(dll_dir):
        if f.lower().endswith(".dll"):
            full = os.path.join(dll_dir, f)
            try:
                clr.AddReference(full)
                loaded.append(f)
                if verbose: print("  +", f)
            except Exception:
                try:
                    clr.AddReference(os.path.splitext(f)[0])
                    loaded.append(f + " (by name)")
                    if verbose: print("  +", f, "(by name)")
                except Exception:
                    pass
    print(f"✔ assemblies loaded: {len(loaded)}")

def scan_types():
    # 1) Try the expected nested type first
    try:
        from Arad.WaterMeter.Communication.Headers import MetaData as MetaDataType
        print("✔ MetaData type:", MetaDataType)
        try:
            cand = getattr(MetaDataType, "eCommandType")
            print("FOUND: MetaData.eCommandType (nested)")
            print("Use shim: from ...MetaData import eCommandType  # works directly")
            return
        except AttributeError:
            pass

        # Look at nested types to see what's there
        try:
            nested = [t.Name for t in MetaDataType.GetNestedTypes()]
            print("Nested in MetaData:", nested)
        except Exception:
            print("MetaData.GetNestedTypes() not available.")

        # Case-insensitive search
        try:
            for t in MetaDataType.GetNestedTypes():
                if t.Name.lower() == "ecommandtype":
                    print("FOUND: MetaData nested type:", t.FullName)
                    print("Use shim: alias MetaData.<that> as eCommandType")
                    return
        except Exception:
            pass
    except Exception as e:
        print("MetaData type import failed:", e)

    # 2) Try namespace-level type
    try:
        from Arad.WaterMeter.Communication.Headers import eCommandType as TopType
        print("FOUND: namespace-level Arad.WaterMeter.Communication.Headers.eCommandType")
        print("Use shim: set module MetaData.eCommandType = that type")
        return
    except Exception:
        pass

    # 3) Bruteforce scan all loaded assemblies for any *CommandType
    print("Scanning all loaded assemblies for *CommandType ...")
    try:
        from System import AppDomain
        matches = []
        for asm in AppDomain.CurrentDomain.GetAssemblies():
            try:
                for t in asm.GetTypes():
                    n = t.Name.lower()
                    if "commandtype" in n:
                        matches.append((t.Assembly.GetName().Name, t.FullName))
            except Exception:
                pass
        if matches:
            print("CANDIDATES:")
            for asm, fullname in matches:
                print(f"  - [{asm}] {fullname}")
            print("Pick the one that belongs to '...Headers.MetaData' namespace or looks right.")
        else:
            print("No *CommandType candidates found. Check the vendor SDK docs or DLL versions.")
    except Exception:
        traceback.print_exc()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dll-dir", required=True)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    print("Python", sys.version.split()[0], "| Arch:", platform.machine())
    boot_pythonnet()
    dll_dir = add_dll_dir(args.dll_dir)
    load_assemblies(dll_dir, verbose=args.verbose)
    scan_types()

if __name__ == "__main__":
    main()
