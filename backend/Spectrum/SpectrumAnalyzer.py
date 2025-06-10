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
        :param port: Port for socket connection. Defaults  to 5555 (for R&S FSC3)
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
        :raises:
            RuntimeError: If the analyzer is not connected.
            IOError: If sending fails.
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
        :return:
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

    def query(self, command):
        if not self.sock:
            raise RuntimeError("No Spectrum Analyzer connected")
        self.send_command(command)
        return self.read_response()

    def send_and_wait(self, command, wait_for="1", timeout=3):
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
    def is_connected(self):
        return self.sock is not None

    # ==========================
    # Modular SCPI Commands
    # ==========================

    def reset(self):
        self.send_and_wait(self.cmd.build("reset_spectrum"))

    def identify(self):
        return self.query(self.cmd.build("identify"))

    def set_center_frequency(self, freq_hz):
        self.send_and_wait(self.cmd.build("set_center_frequency", value=freq_hz, units="HZ"))

    def set_span(self, value, units="HZ"):
        self.send_and_wait(self.cmd.build("set_span", value=value, units=units))

    def set_rbw(self, rbw_hz):
        self.send_and_wait(self.cmd.build("set_rbw", value=rbw_hz, units="HZ"))

    def set_vbw(self, vbw_hz):
        self.send_and_wait(self.cmd.build("set_vbw", value=vbw_hz, units="HZ"))

    def set_ref_level(self, ref_dbm):
        self.send_and_wait(self.cmd.build("set_ref_level", value=ref_dbm))

    def set_ref_level_offset(self, offset_db):
        self.send_and_wait(self.cmd.build("set_ref_level_offset", value=offset_db))

    def set_peak_detector(self):
        self.send_and_wait(self.cmd.build("set_peak_detector"))

    def peak_search(self, mark_name="MARK1"):
        self.send_and_wait(self.cmd.build("peak_search", mark_name=mark_name))

    def get_marker_power(self, mark_name="MARK1"):
        return self.query(self.cmd.build("get_marker_power", mark_name=mark_name))

    def get_marker_frequency(self, mark_name="MARK1"):
        return self.query(self.cmd.build("get_marker_frequency", mark_name=mark_name))

    def get_rbw(self):
        return self.query(self.cmd.build("get_rbw"))

    def get_vbw(self):
        return self.query(self.cmd.build("get_vbw"))

    def get_span(self):
        return self.query(self.cmd.build("get_span"))

    def get_ref_level(self):
        return self.query(self.cmd.build("get_ref_level"))

    def get_ref_level_offset(self):
        return self.query(self.cmd.build("get_ref_level_offset"))

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