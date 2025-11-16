import socket
import time
import os
from ftplib import FTP
from .scpi_command_builder import SCPICommandBuilder
from typing import Optional
# from scpi_command_builder import SCPICommandBuilder
import re
import math

from contextlib import contextmanager



FLOAT_RE = re.compile(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")

def _only_number(s: str) -> float:
    m = FLOAT_RE.search(str(s))
    if not m:
        raise ValueError(f"Cannot parse number from: {s!r}")
    return float(m.group(0))

# ADD inside SpectrumAnalyzer:

def _query_number(self, scpi_or_cmd: str) -> float:
    """
    Send a query and parse the first numeric token (units stripped).
    Accepts raw SCPI (e.g., 'FREQ:CENT?') or a JSON-built command string.
    """
    resp = self.query(scpi_or_cmd)
    return _only_number(resp)

class InstrumentNotConnected(Exception):
    pass

class SpectrumAnalyzer:
    """
    Control a spectrum analyzer over TCP/IP using SCPI.
    """
    def __init__(self, ip_address, port=5555, timeout=5, line_ending='\n', scpi_path=None, scpi_builder=None) -> None:
        self.ip_address = ip_address
        self.port = port
        self.timeout = timeout
        self.line_ending = line_ending
        self.sock = None

        if not scpi_path:
            scpi_path = os.path.join(os.path.dirname(__file__), "SCPI_COMMAND.json")
        self.cmd = scpi_builder if scpi_builder else SCPICommandBuilder(scpi_path)

    def connect(self) -> None:
        """Establish a socket connection and verify response."""
        try:
            self.sock = socket.create_connection((self.ip_address, self.port), timeout=self.timeout)
            self.sock.settimeout(self.timeout)
            print(f"Socket connected to {self.ip_address}:{self.port}, waiting for ACK...")

            self.send_command(self.cmd.build("identify"))
            response = self.read_response()
            if not response or "Rohde" not in response:
                raise ConnectionError(f"Unexpected response from analyzer: {response}")
            print(f"Spectrum Analyzer responded: {response}")

        except Exception as e:
            self.sock = None
            raise ConnectionError(f"failed to connect to {self.ip_address}:{self.port} -> {e}")

    def disconnect(self) -> None:
        """Disconnect from the spectrum analyzer (idempotent)."""
        try:
            if self.sock:
                try:
                    # best-effort: shutdown; ignore if already closed
                    self.sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                self.sock.close()
        finally:
            self.sock = None
            print("Disconnected")

    def _ensure_connected(self):
        if not self.sock:
            raise InstrumentNotConnected("Analyzer not connected")

    def send_command(self, command) -> None:
        """Send a SCPI command."""
        self._ensure_connected()
        try:
            full_command = command.strip() + self.line_ending
            self.sock.sendall(full_command.encode())
        except OSError as e:
            # socket died → treat as not connected
            raise InstrumentNotConnected("Socket closed") from e
        except Exception as e:
            raise IOError(f"Failed to send command {command} -> {e}")

    def read_response(self) -> str:
        """Read response from the analyzer."""
        self._ensure_connected()
        try:
            response = b''
            while True:
                part = self.sock.recv(4096)
                response += part
                if not part or b'\n' in part:
                    break
            return response.decode(errors='replace').strip()
        except OSError as e:
            # WinError 10038 etc.
            raise InstrumentNotConnected("Socket closed") from e
        except Exception as e:
            raise IOError(f"Failed to read response -> {e}")

    def query(self, command) -> str:
        """Send a command and read the response."""
        self._ensure_connected()
        self.send_command(command)
        return self.read_response()

    def send_and_wait(self, command, wait_for="1", timeout=8.0) -> bool:
        """
        Send a command and wait for operation complete.
        Robust: keeps querying *OPC? until '1' or timeout.
        """
        self.send_command(command)
        deadline = time.time() + timeout

        while time.time() < deadline:
            try:
                resp = self.query(self.cmd.build("operation_complete_query"))  # typically '*OPC?'
                if resp and resp.strip() == wait_for:
                    return True
            except InstrumentNotConnected:
                raise
            except Exception:
                # transient read/format hiccup; try again
                pass
            time.sleep(0.1)

        raise TimeoutError(f"Timeout waiting for operation to complete after: {command}")


    @property
    def is_connected(self) -> bool:
        """True if we hold an open socket (best-effort)."""
        return self.sock is not None

    # ==========================
    # SCPI Command Wrappers
    # ==========================

    def reset(self) -> None:
        self.send_and_wait(self.cmd.build("reset_spectrum"))

    def identify(self) -> str:
        return self.query(self.cmd.build("identify"))

    def set_center_frequency(self, freq, units="HZ") -> None:
        self.send_and_wait(self.cmd.build("set_center_frequency", value=freq, units=units))

    def set_span(self, span, units="HZ") -> None:
        self.send_and_wait(self.cmd.build("set_span", value=span, units=units))

    def set_rbw(self, rbw, units="HZ") -> None:
        self.send_and_wait(self.cmd.build("set_rbw", value=rbw, units=units))

    def set_vbw(self, vbw, units="HZ") -> None:
        self.send_and_wait(self.cmd.build("set_vbw", value=vbw, units=units))

    def set_ref_level(self, ref_dbm) -> None:
        self.send_and_wait(self.cmd.build("set_ref_level", value=ref_dbm))

    def set_ref_level_offset(self, offset_db) -> None:
        self.send_and_wait(self.cmd.build("set_ref_level_offset", value=offset_db))

    def set_peak_detector(self) -> None:
        self.send_and_wait(self.cmd.build("set_peak_detector"))

    def set_marker_to_center_frequency(self, mark_name="MARK1") -> None:
        """Place the given marker at the current center frequency."""
        self.send_and_wait(self.cmd.build("set_marker_to_center_frequency", mark_name=mark_name))


    def peak_search(self, mark_name="MARK1") -> None:
        self.send_and_wait(self.cmd.build("peak_search", mark_name=mark_name))

    def get_marker_power(self, mark_name="MARK1") -> str:
        return self.query(self.cmd.build("get_marker_power", mark_name=mark_name))

    def get_marker_frequency(self, mark_name="MARK1") -> str:
        return self.query(self.cmd.build("get_marker_frequency", mark_name=mark_name))

    def get_rbw(self) -> str:
        """Return RBW in Hz as a plain numeric string (tries BAND:RES? then legacy)"""
        try:
            val = self._query_number(self.cmd.build("get_rbw"))
            return str(int(val))
        except Exception:
            pass
        # direct SCPI fallbacks
        try:
            return str(int(self._query_number("BAND:RES?")))
        except Exception:
            return str(int(self._query_number("BWIDTH:RES?")))

    def get_vbw(self) -> str:
        """Return VBW in Hz as a plain numeric string (tries BAND:VID? then legacy)"""
        try:
            val = self._query_number(self.cmd.build("get_vbw"))
            return str(int(val))
        except Exception:
            pass
        try:
            return str(int(self._query_number("BAND:VID?")))
        except Exception:
            return str(int(self._query_number("BWIDTH:VID?")))

    def get_span(self) -> str:
        try:
            val = self._query_number(self.cmd.build("get_span"))
        except Exception:
            val = self._query_number("FREQ:SPAN?")
        return str(int(val))

    def get_ref_level(self) -> str:
        """Return reference level in dBm as a plain numeric string with decimals preserved"""
        # Try JSON mapping first
        try:
            val = _only_number(self.query(self.cmd.build("get_ref_level")))
            return f"{val:.6f}".rstrip("0").rstrip(".")
        except Exception:
            pass
        # Common R&S fallbacks
        candidates = [
            "DISP:WIND:TRAC:Y:RLEV?",
            "DISP:TRAC:Y:RLEV?",
            "DISP:WIND:TRAC1:Y:RLEV?",
            "DISP:WIND1:TRAC1:Y:RLEV?",
        ]
        last = None
        for c in candidates:
            try:
                val = _only_number(self.query(c))
                return f"{val:.6f}".rstrip("0").rstrip(".")
            except Exception as e:
                last = e
        raise last or RuntimeError("Ref level query failed")

    def get_ref_level_offset(self):
        return self.query(self.cmd.build("get_ref_level_offset"))

    def get_raw_data(self):
        """Return a CSV string of powers in dBm (numbers only, comma-separated)."""
        self._ensure_connected()
        self.send_command(self.cmd.build("return_ascii_formatted_data"))
        time.sleep(0.2)  # let the analyzer switch format
        raw = self.query(self.cmd.build("get_raw_data"))

        # Normalize delimiters and strip units per value
        raw = raw.replace(";", ",").replace("\t", ",")
        tokens = [t.strip() for t in raw.split(",") if t.strip()]
        nums = []
        for t in tokens:
            try:
                nums.append(str(_only_number(t)))
            except Exception:
                # ignore any non-numeric cruft
                pass
        return ",".join(nums)
    
    def get_center_frequency(self) -> str:
    # Prefer your JSON command; fallback to direct SCPI if needed
        try:
            val = self._query_number(self.cmd.build("get_center_frequency"))
        except Exception:
            val = self._query_number("FREQ:CENT?")
        return str(int(val))

    # not working yet. ToDo: implement this feature.
    def take_screenshot(self, name="screenshot"):
        self.send_and_wait(self.cmd.build("take_screenshot", name=name))

    def set_measurement_mode(self, mode: str):
        self.send_and_wait(f"CALC:MEAS {mode}")

    def download_screenshot_via_ftp(self, remote_filename="screenshot.png", local_path="screenshot.png"):
        try:
            print(f"Connecting to FTP at {self.ip_address}...")
            ftp = FTP(self.ip_address)
            ftp.login()
            with open(local_path, "wb") as f:
                ftp.retrbinary(f"RETR {remote_filename}", f.write)
            ftp.quit()
            print(f"Screenshot saved to {local_path}")
        except Exception as e:
            raise IOError(f"Failed to download screenshot via FTP -> {e}")
        
    def max_hold(self):
        self.send_and_wait("DISP:TRAC1:MODE MAXHold")

    def clear_write(self):
        self.send_and_wait("DISP:TRAC1:MODE WRIT")

    def measure_obw_via_max_hold(self, duration_s: float, pct: float = 99.0, guard_s: float = 15.0) -> float:
        """
        Measure Occupied Bandwidth (OBW) using Max-Hold without changing sweep method.

        Flow:
        1) self.max_hold()               -> DISP:TRAC1:MODE MAXHold
        2) sleep(duration_s)             -> analyzer keeps sweeping as currently configured
        3) fetch trace + compute OBW     -> smallest contiguous band around peak with pct% power
        4) self.clear_write()            -> DISP:TRAC1:MODE WRIT

        Args:
        duration_s: Max-hold accumulation time (seconds).
        pct:        Occupied bandwidth percentage (e.g., 99.0).
        guard_s:    Extra time budget for instrument processing/transfer.

        Returns:
        OBW in Hz (float)
        """
        # Ensure we're actually connected before doing anything
        self._ensure_connected()

        import re, time  # in case not imported at top

        def _first_float(s: str) -> float:
            m = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", s or "")
            if not m:
                raise ValueError(f"parse error: {s!r}")
            return float(m.group(0))

        # 1) Switch to Max-Hold (quick command; default send_and_wait timeout is fine)
        try:
            self.max_hold()  # uses: DISP:TRAC1:MODE MAXHold
        except Exception as e:
            raise RuntimeError(f"Failed to set Max Hold: {e}")

        try:
            # 2) Accumulate Max-Hold for requested time
            time.sleep(max(0.0, float(duration_s)))

            # Use a temporary, extended socket timeout for all network-heavy work below:
            # (trace transfer + a couple of SCPI queries). This avoids the default short
            # socket/OPC timeouts killing long OBW flows.
            with self.temp_timeout(float(duration_s) + float(guard_s)):
                # 3a) Read trace (CSV) and parse dBm values
                raw_csv = self.get_raw_data()
                if not raw_csv:
                    raise RuntimeError("Empty trace from analyzer")

                vals_dbm = []
                for tok in raw_csv.split(","):
                    tok = tok.strip()
                    if not tok:
                        continue
                    try:
                        vals_dbm.append(float(tok))
                    except ValueError:
                        # ignore junk tokens defensively
                        pass

                n = len(vals_dbm)
                if n < 10:
                    raise RuntimeError(f"Trace too short ({n} points)")

                # 3b) Query span and sweep points (best effort; do NOT alter sweep)
                try:
                    span_hz = int(round(_first_float(self.query("FREQ:SPAN?"))))
                except Exception:
                    raise RuntimeError("Cannot determine SPAN (FREQ:SPAN?)")

                try:
                    swe_points = int(round(_first_float(self.query("SWE:POIN?"))))
                    if swe_points < 2 or abs(swe_points - n) > n // 2:
                        # if mismatch, fall back to actual parsed points
                        swe_points = n
                except Exception:
                    swe_points = n

            # 3c) Compute OBW (smallest contiguous band around peak with pct% of total power)
            lin = [10.0 ** (v / 10.0) for v in vals_dbm]  # mW
            total = sum(lin)
            if total <= 0.0:
                raise RuntimeError("Non-positive total power in trace")

            peak = max(range(n), key=lambda i: lin[i])
            target = total * (pct / 100.0)

            left = right = peak
            acc = lin[peak]
            while acc < target and (left > 0 or right < n - 1):
                lp = lin[left - 1] if left > 0 else -1.0
                rp = lin[right + 1] if right < n - 1 else -1.0
                if rp > lp and right < n - 1:
                    right += 1
                    acc += lin[right]
                elif left > 0:
                    left -= 1
                    acc += lin[left]
                else:
                    break

            bin_hz = float(span_hz) / max(1, (swe_points - 1))
            width_bins = max(1, right - left)
            obw_hz = width_bins * bin_hz

            if not (0.0 < obw_hz <= span_hz * 1.05):
                raise ValueError(f"Computed OBW out of range: {obw_hz} Hz (span={span_hz} Hz)")

            return obw_hz

        finally:
            # 4) Always restore to Clear/Write
            try:
                self.clear_write()  # uses: DISP:TRAC1:MODE WRIT
            except Exception:
                pass
    
    
    # inside class SpectrumAnalyzer
    def set_socket_timeout(self, seconds: float) -> None:
        """Adjust the socket timeout for long operations."""
        self._ensure_connected()
        self.timeout = float(seconds)
        self.sock.settimeout(self.timeout)

    @contextmanager
    def temp_timeout(self, seconds: float):
        """Temporarily bump the socket timeout for long queries, then restore."""
        self._ensure_connected()
        prev = self.timeout
        try:
            self.set_socket_timeout(seconds)
            yield
        finally:
            self.set_socket_timeout(prev)


if __name__ == "__main__":
    analyzer = SpectrumAnalyzer("172.16.10.1")
    try:
        analyzer.connect()
        print(analyzer.identify())
        analyzer.set_ref_level(-30)
    finally:
        analyzer.disconnect()
    
