import clr_init
from pythonnet import load
from structs import hwtp_structures as struct
from commands import hwtp_commands as cmd
from BLE import BLE_Device
import enums
import time
import os, sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.Spectrum.SpectrumAnalyzer import SpectrumAnalyzer


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

def cat_m_modem_om(device: BLE_Device,):
    commands = cmd.HWTP_AT_MODEM_ON
    # payload = struct.HWTP_CATM_mode_t
    s_time = time.time()
    try:
        device.hwtp_get(commands, timeout=10000)
    except Exception as e:
        print(f"Exception occurred: {e}")
    e_time = time.time()

def cat_m_cw_on(device: BLE_Device, earfcn, power):    
    commands = cmd.HWTP_MODEM_TEST_RF_CW
    payload = struct.HWTP_tstrf_cw_s(
        tstrf_cmd=enums.hwtp_at_tstrf_cmd_e.HWTP_START_TX_TEST,
        earfcn=earfcn,
        time=150000,
        tx_power=power,
        offset_to_the_central=0
    )
    device.hwtp_set(commands,payload)

def cat_m_abort_test(device: BLE_Device):
    commands = cmd.HWTP_MODEM_TEST_RF_CW
    payload = struct.HWTP_tstrf_cw_s(
        tstrf_cmd=enums.hwtp_at_tstrf_cmd_e.HWTP_ABORT_TEST,
        earfcn=0,
        time=150000,
        tx_power=0,
        offset_to_the_central=0
        )
    device.hwtp_set(commands,payload)

def cat_m_modem_off(device: BLE_Device):
    commands = cmd.HWTP_AT_MODEM_OFF
    try:
        device.hwtp_get(commands)
    except Exception as e:
        print(f"Exception occurred: {e}")

def ble_cw(device: BLE_Device, channel):
    commands = cmd.HWTP_EX_BLE_TEST_TONE_START
    payload = struct.HWTP_BleToneParams_t(
        channel=int(channel),
        duration=20,
        offset=0,
    )
    device.hwtp_set(commands, payload)

def change_ble_power(device: BLE_Device):
    commands = cmd.HWTP_SI_BLE_TX_POWER_SET
    payload = struct.HWTP_BleTxPower_t(
        txPowerConst=25
    )
    device.hwtp_set(commands, payload)

def get_ble_power(device: BLE_Device):
    commands = cmd.HWTP_SI_BLE_TX_POWER_GET
    device.hwtp_get(commands)

def save_and_reset(device: BLE_Device):
    commnad = cmd.HWTP_EX_SYSTEM_RESET
    payload = struct.HWTP_SysReset_t(resetType=enums.HWTP_ResetType_e.HWTP_Rst_SaveAndReset)
    device.hwtp_set(command=commnad, payload=payload)
    device.Disconnect()

def lora_modulated_cw(device: BLE_Device, freq, power, bw, dr):
    command = cmd.HWTP_DBG_LORA_TEST_MODULATED_CW
    payload = struct.HWTP_LoraTestModCw_t(
        modem=enums.hwtp_radiomodem_e.HWTP_LORA,
        freq=freq,
        power=power,
        bandwidth=bw,
        datarate=dr
        )
    device.hwtp_set(command=command, payload=payload)

def lora_test_off(device: BLE_Device):
    device.hwtp_get(command=cmd.HWTP_DBG_LORA_TEST_STOP)



def main():
    # ==== OBW Test ====
    analyzer = SpectrumAnalyzer("172.16.10.1")
    analyzer.connect()

    device = BLE_Device(0x80E1271FD8B8)
    device.Connect()
    analyzer.set_rbw(rbw=3, units="KHZ")
    analyzer.set_vbw(vbw=10, units="KHZ")
    analyzer.set_span(span=500, units="KHZ")
    lora_modulated_cw(device, freq=918500000, power=14, bw=0, dr=7)

    bw_hz = analyzer.measure_obw_via_max_hold(duration_s=10.0, pct=99.0)
    print(f"OBW (MaxHold 10s) = {bw_hz/1e3:.2f} kHz")
    lora_test_off(device)

    device.Disconnect()
    analyzer.disconnect()

    

    # analyzer.disconnect()



    # mac_input = input("Please enter MAC Address:\n")
    # mac_address = parse_mac_to_hex(mac_input.strip())
    #
    # device = BLE_Device(mac_address)
    # device = BLE_Device(0x80E1271FD8DD)
    # device.Connect()

    # # ble_cw(device=device, channel=0)
    # res = device.hwtp_get(command=cmd.HWTP_SI_BLE_TX_POWER_GET)
    # print(res[1])

    # device.hwtp_set(command=cmd.HWTP_SI_BLE_TX_POWER_SET, payload=struct.HWTP_BleTxPower_t(txPowerConst=25))
    # save_and_reset(device=device)
    
    # device = BLE_Device(0x80E1271FD8DD)
    # device.Connect()

    # res = device.hwtp_get(command=cmd.HWTP_SI_BLE_TX_POWER_GET)
    # # if str(res[1]) 
    # print(str(res[1]))


    # device.Disconnect()

    # analyzer = SpectrumAnalyzer(ip_address="172.16.10.1")

    # analyzer.connect()
    # analyzer.set_span(5, "MHZ")
    # analyzer.set_ref_level_offset(20)

    # time.sleep(2)
    # lora_cw(device=device, spectrum=analyzer, frequency=918000000, power=0, ref_offset=20)
    # cat_m_modem_om(device=device)
    # cat_m_cw_on(device, earfcn=18900, power=2300)
    
    # time.sleep(2)
    # cat_m_abort_test(device=device)
    # cat_m_modem_off(device=device)

    

# python -m SpectrumTestApp.main_test

# 80E1271FD8B8
# 80E1271FD8DD
if __name__ == '__main__':
    main()
