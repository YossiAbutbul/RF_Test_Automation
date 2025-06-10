import socket
import time
import os
from ftplib import FTP
from .scpi_command_builder import SCPICommandBuilder


class SpectrumAnalyzer:
    """
    A class to control and communicate with a spectrum analyzer over TCP/IP using SCPI commands.
    """
    def __init__(self, ip_address, port=5555, timeout=5, line_ending='\n', scpi_path=None, scpi_builder=None) -> None:
        """
        Initialize the SpectrumAnalyzer.
        :param ip_address: IP address of the Spectrum Analyzer.
        :param port: Port for socket connection. Defaults to 5555 (for R&S FSC3)
        :param timeout: Timeout for socket operations in seconds. Defaults to 5.
        :param line_ending: Line termination character for SCPI commands. Defaults to '\n'.
        :param scpi_path: Path to the SCPI JSON definition file.
        :param scpi_builder: Custom SCPI command builder instance.
        """
        self.ip_address = ip_address
        self.port = port
        self.timeout = timeout
        self.line_ending = line_ending
        self.sock = None

        if not scpi_path:
            scpi_path = os.path.join(os.path.dirname(__file__), "SCPI_COMMAND.json")
        self.cmd = scpi_builder if scpi_builder else SCPICommandBuilder(scpi_path)

    def connect(self) -> None:
        """
        Establish a socket connection to the spectrum analyzer and verify the response.
        :return: None.
        """
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
        """
        Disconnect from the spectrum analyzer.
        :return: None
        """
        if self.sock:
            self.sock.close()
            self.sock = None
            print("Disconnected")

    def send_command(self, command) -> None:
        """
        Send a SCPI command to the spectrum analyzer.
        :param command: SCPI command string.
        :return: None
        """
        if not self.sock:
            raise RuntimeError("No Spectrum Analyzer connected.")

        try:
            full_command = command.strip() + self.line_ending
            self.sock.sendall(full_command.encode())
        except Exception as e:
            raise IOError(f"Failed to send command {command} -> {e}")

    def read_response(self) -> str:
        """
        Read response from the spectrum analyzer.
        :return: str: Decoded response string.
        """
        if not self.sock:
            raise RuntimeError("No Spectrum Analyzer connected")
        try:
            response = b''
            while True:
                part = self.sock.recv(4096)
                response += part
                if not part or b'\n' in part:
                    break
            return response.decode().strip()
        except Exception as e:
            raise IOError(f"Failed to read response -> {e}")

    def query(self, command) -> str:
        """
        Send a command and immediately read the response.
        :param command: SCPI command.
        :return: Response string.
        """
        if not self.sock:
            raise RuntimeError("No Spectrum Analyzer connected")
        self.send_command(command)
        return self.read_response()

    def send_and_wait(self, command, wait_for="1", timeout=3) -> bool:
        """
        Send a command and wait for completion (using *OPC?).
        :param command: Command to send.
        :param wait_for: Expected response. Defaults to "1".
        :param timeout: Timeout in seconds. Defaults to 3.
        :return: True if operation completes in time.
        """
        self.send_command(command)
        self.send_command(self.cmd.build("operation_complete_query"))
        start = time.time()

        while time.time() - start < timeout:
            try:
                response = self.read_response()
                if response.strip() == wait_for:
                    return True
            except Exception:
                pass
            time.sleep(0.1)
        raise TimeoutError(f"Timeout waiting for operation to complete after: {command}")

    @property
    def is_connected(self) -> bool:
        """
        Check if the analyzer is currently connected.
        :return: bool: True if connected.
        """
        return self.sock is not None

    # ==========================
    # SCPI Command Wrappers
    # ==========================

    def reset(self) -> None:
        """Reset the spectrum analyzer."""
        self.send_and_wait(self.cmd.build("reset_spectrum"))

    def identify(self) -> str:
        """
        Query the identity of the spectrum analyzer.
        :return: Spectrum model string.
        """
        return self.query(self.cmd.build("identify"))

    def set_center_frequency(self, freq, units="HZ") -> None:
        """
        Set center frequency based on given frequency in specified units.
        :param freq: Required center frequency.
        :param units: Frequency units (HZ, KHZ, MHZ, GHZ). Defaults to "HZ".
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_center_frequency", value=freq, units=units))

    def set_span(self, span, units="HZ") -> None:
        """
        Set frequency span in specified units.
        :param span: Required frequency span.
        :param units: Span units (HZ, KHZ, MHZ, GHZ). Defaults to "HZ".
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_span", value=span, units=units))

    def set_rbw(self, rbw, units="HZ") -> None:
        """
        Set resolution bandwidth (RBW) in specified units.
        :param rbw: Required RBW.
        :param units: RBW units (HZ, KHZ, MHZ, GHZ). Defaults to "HZ".
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_rbw", value=rbw, units=units))

    def set_vbw(self, vbw, units="HZ") -> None:
        """
        Set video bandwidth (VBW) in specified units.
        :param vbw: Required VBW.
        :param units: VBW units (HZ, KHZ, MHZ, GHZ). Defaults to "HZ".
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_vbw", value=vbw, units=units))

    def set_ref_level(self, ref_dbm) -> None:
        """
        Set reference level in dBm.
        :param ref_dbm: Required reference level in dBm.
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_ref_level", value=ref_dbm))

    def set_ref_level_offset(self, offset_db) -> None:
        """
        Set reference level offset in dB.
        :param offset_db: Required reference level offset in dB.
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_ref_level_offset", value=offset_db))

    def set_peak_detector(self) -> None:
        """
        Set the detector to 'peak' mode.
        :return: None.
        """
        self.send_and_wait(self.cmd.build("set_peak_detector"))

    def peak_search(self, mark_name="MARK1") -> None:
        """
        Trigger peak search using a marker.
        :param mark_name: Marker name to set to peak. Defaults sets to "Marker 1".
        :return: None.
        """
        self.send_and_wait(self.cmd.build("peak_search", mark_name=mark_name))

    def get_marker_power(self, mark_name="MARK1") -> str:
        """
        Get power value at a given marker in dBm.
        :param mark_name: Required marker name to get its power level.
        :return: Marker power level string.
        """
        return self.query(self.cmd.build("get_marker_power", mark_name=mark_name))

    def get_marker_frequency(self, mark_name="MARK1") -> str:
        """
        Get frequency value at a given marker.
        :param mark_name: Required marker name to get its frequency.
        :return: Marker frequency string.
        """
        return self.query(self.cmd.build("get_marker_frequency", mark_name=mark_name))

    def get_rbw(self) -> str:
        """
        Query resolution bandwidth (RBW).
        :return: RBW string.
        """
        return self.query(self.cmd.build("get_rbw"))

    def get_vbw(self):
        """
        Query video bandwidth (VBW).
        :return: VBW string.
        """
        return self.query(self.cmd.build("get_vbw"))

    def get_span(self):
        """
        Query frequency span.
        :return: Frequency span string.
        """
        return self.query(self.cmd.build("get_span"))

    def get_ref_level(self):
        """
        Query reference level.
        :return: Reference level string.
        """
        return self.query(self.cmd.build("get_ref_level"))

    def get_ref_level_offset(self):
        """
        Query reference level offset.
        :return: Reference level offset string.
        """
        return self.query(self.cmd.build("get_ref_level_offset"))

    # not working yet. ToDo: implement this feature.
    def take_screenshot(self, name="screenshot"):
        self.send_and_wait(self.cmd.build("take_screenshot", name=name))

    def download_screenshot_via_ftp(self, remote_filename="screenshot.png", local_path="screenshot.png"):
        """
        Downloads a screenshot file from the spectrum analyzer via FTP.
        The screenshot must have already been saved using take_screenshot().
        """
        try:
            print(f"Connecting to FTP at {self.ip_address}...")
            ftp = FTP(self.ip_address)
            ftp.login()  # anonymous login or use credentials if needed

            with open(local_path, "wb") as f:
                ftp.retrbinary(f"RETR {remote_filename}", f.write)

            ftp.quit()
            print(f"Screenshot saved to {local_path}")

        except Exception as e:
            raise IOError(f"Failed to download screenshot via FTP -> {e}")


if __name__ == "__main__":
    analyzer = SpectrumAnalyzer("172.16.10.1")
    try:
        analyzer.connect()
        print(analyzer.identify())
        analyzer.send_command(":FREQ:CENT 1GHz\r\n")
    finally:
        analyzer.disconnect()
