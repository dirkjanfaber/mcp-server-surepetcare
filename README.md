# mcp-server-surepetcare

MCP (Model Context Protocol) server for the [SurePetcare](https://www.surepetcare.com) cloud API. Exposes pet location monitoring, SureFlap lock control, device renaming, and hub LED control as MCP tools.

> **Disclaimer:** This project is not affiliated with, endorsed by, or in any way associated with Sure Petcare Ltd. It is an independent, community-developed integration created by happy users of their hardware and software. SurePetcare, SureFlap, and SureFeed are trademarks of Sure Petcare Ltd. Use of this package is at your own risk. The underlying API is unofficial and reverse-engineered by the community - it may change or break without notice.

## Tools

| Tool | Description |
|---|---|
| `list_pets` | List all pets and their current locations (inside/outside) |
| `get_pet_details` | Get raw pet data including microchip tag information |
| `list_devices` | List all SurePetcare devices, including live lock state and curfew schedule |
| `set_lock_state` | Set the lock state of a SureFlap cat flap |
| `rename_device` | Rename a device, re-asserting any explicit lock override so the rename can't silently unlock it |
| `set_pet_location` | Manually mark a pet inside/outside (e.g. after letting them through a door other than the flap) |
| `set_led_mode` | Set the hub's LED ring brightness (off/bright/dimmed) |

### Lock state values

| Value | Meaning |
|---|---|
| `0` | Unlocked (both directions) |
| `1` | Locked in (entry only) |
| `2` | Locked out (exit only) |
| `3` | Locked (both directions) |

### LED mode values

| Value | Meaning |
|---|---|
| `0` | Off |
| `1` | Bright |
| `4` | Dimmed |

## Configuration

Set the following environment variables before starting the server:

```bash
export SUREPETCARE_EMAIL="your@email.com"
export SUREPETCARE_PASSWORD="yourpassword"
export SUREPETCARE_DEVICE_ID="stable-uuid"   # optional, auto-generated if omitted
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "surepetcare": {
      "command": "npx",
      "args": ["mcp-server-surepetcare"],
      "env": {
        "SUREPETCARE_EMAIL": "your@email.com",
        "SUREPETCARE_PASSWORD": "yourpassword"
      }
    }
  }
}
```

## References

- Reverse-engineered API (PHP): https://github.com/alextoft/sureflap
- Python client (surepy): https://github.com/benleb/surepy
- Local MQTT alternative (PetHubLocal): https://github.com/PetHubLocal/pethublocal
