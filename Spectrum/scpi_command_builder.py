import json


class SCPICommandBuilder:
    def __init__(self, json_path):
        with open(json_path, 'r') as f:
            self.commands = json.load(f)

    def build(self, command_name, **kwargs):
        if command_name not in self.commands:
            raise ValueError(f"Command '{command_name}' not found in the SCPI definitions.")
        return self.commands[command_name].format(**kwargs)