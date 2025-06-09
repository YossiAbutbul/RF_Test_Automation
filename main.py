import clr_init
from pythonnet import load
import communication
from communication.hwtp_communication import BadAnswerFromUnit, HwtpStatus
from structs import hwtp_structures as struct, HWTP_LCD_Settings_t
from commands import hwtp_commands as cmd
from BLE import BLE_Device
import enums
import time
from Spectrum.Spectrum import SpectrumAnalyzer
from Spectrum.scpi_command_builder import SCPICommandBuilder

load("coreclr")
clr_init.load_runtime()


def parse_mac_to_hex(mac_str: str) -> int:
    """
    @brief: Convert a MAC address string (with or without colons/dashes) to an integer.
    @param: mac_str: The un-formatted string.
    @return: An integer representing the MAC address.
    """
    mac_clean = mac_str.replace(":", "").replace("-", "").strip().upper()

    if len(mac_clean) != 12 or not all(c in "0123456789ABCDEF" for c in mac_clean):
        raise ValueError("Invalid MAC address format.")

    return int(mac_clean, 16)


def lora_cw(device: BLE_Device, spectrum: SpectrumAnalyzer, frequency, power, ref_offset):
    commands = cmd.HWTP_DBG_LORA_TEST_CW
    payload = struct.HWTP_LoraTestCw_t(
        freq=frequency,
        power=power,
        paMode=enums.hwtp_loratestpamode_e.HWTP_LORA_TEST_PA_AUTO)
    time.sleep(1)
    try:
        device.hwtp_set(commands,payload)
        # time.sleep(2)
        spectrum.set_center_frequency(frequency)
        spectrum.peak_search()
        peak = float(spectrum.get_marker_power())
        print(f"CW power measured at {frequency/float(1000000)} MHz: {peak + float(ref_offset)}dBm")
        device.hwtp_get(command=cmd.HWTP_DBG_LORA_TEST_STOP)
    finally:
        device.Disconnect()
        spectrum.disconnect()


def main():
    # mac_input = input("Please enter MAC Address:\n")
    # mac_address = parse_mac_to_hex(mac_input.strip())
    #
    # device = BLE_Device(mac_address)
    device = BLE_Device(0xD5A9F012CC39)
    device.Connect()

    analyzer = SpectrumAnalyzer(ip_address="172.16.10.1")

    analyzer.connect()
    analyzer.set_span(5, "MHZ")
    # analyzer.set_ref_level_offset(20)

    time.sleep(2)
    lora_cw(device=device, spectrum=analyzer, frequency=918000000, power=0, ref_offset=20)


# D5A9F012CC39
if __name__ == '__main__':
    main()
