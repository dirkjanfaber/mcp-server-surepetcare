# mcp-server-surepetcare

[![CI](https://github.com/dirkjanfaber/mcp-server-surepetcare/actions/workflows/ci.yml/badge.svg)](https://github.com/dirkjanfaber/mcp-server-surepetcare/actions/workflows/ci.yml)

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
| `get_pet_report` | Get aggregated inside/outside activity stats for a pet over a date range |

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

## Remote use: claude.ai connector (HTTP + OAuth)

To use the server from claude.ai and the Claude mobile apps, run it in HTTP mode on an
always-on machine and add it as a custom connector. claude.ai connects from the
internet, so the server needs a public `https://` URL. A Cloudflare Tunnel or
Tailscale Funnel gives you one without opening ports on your router. Private overlay
networks such as ZeroTier or plain Tailscale aren't enough: claude.ai connects from
Anthropic's servers, not from your devices.

HTTP mode is single-user: when you connect Claude, the server shows a page asking for
your **owner passphrase**. Anyone who knows it can authorize a client, and anyone with
a token can unlock your cat flap - pick a strong one.

```bash
npx mcp-server-surepetcare --http   # or MCP_TRANSPORT=http
```

| Variable | Default | |
|----------|---------|-|
| `MCP_PUBLIC_URL` | (required) | The `https://` URL claude.ai reaches the server on |
| `MCP_OWNER_PASSWORD` | (required) | Passphrase for authorizing Claude, at least 12 characters |
| `MCP_HOST` | `127.0.0.1` | Interface to listen on; the Docker image sets `0.0.0.0` |
| `MCP_PORT` | `3000` | |
| `MCP_STATE_FILE` | `~/.mcp-server-surepetcare/oauth-state.json` | Registered clients and refresh-token hashes, so Claude stays connected across restarts |

plus the `SUREPETCARE_*` variables from [Configuration](#configuration). Set
`SUREPETCARE_DEVICE_ID` to a fixed UUID, or every restart looks like a new device
logging in.

### Docker (e.g. on a Raspberry Pi)

Each release publishes `ghcr.io/dirkjanfaber/mcp-server-surepetcare` for amd64, arm64
and arm/v7 (32-bit Raspberry Pi OS), tagged with the version and `latest`. Publish its
port on loopback only, so the tunnel is the only way in:

```yaml
# docker-compose.yml
services:
  surepetcare-mcp:
    image: ghcr.io/dirkjanfaber/mcp-server-surepetcare:latest   # or pin a version
    restart: unless-stopped
    env_file: .env   # SUREPETCARE_*, MCP_PUBLIC_URL, MCP_OWNER_PASSWORD
    ports:
      - "127.0.0.1:3200:3000"
    volumes:
      - surepetcare-data:/data
volumes:
  surepetcare-data:
```

With **Tailscale Funnel** (no domain needed), run `sudo tailscale funnel --bg 3200` and
use the URL `tailscale funnel status` shows as `MCP_PUBLIC_URL`.

claude.ai only connects on port 443, so Funnel's other ports (8443, 10000) don't work
for a connector. If the machine's own name is already taken by another server, give
this one its own tailnet machine with a Tailscale container next to it. Drop the
`ports:` mapping above, set `MCP_PUBLIC_URL` to `https://surepet.<tailnet>.ts.net`, and add:

```yaml
  surepetcare-tailscale:
    image: tailscale/tailscale:latest
    hostname: surepet
    restart: unless-stopped
    environment:
      TS_HOSTNAME: surepet
      TS_AUTHKEY: ${TS_AUTHKEY}   # only used for the first login
      TS_STATE_DIR: /var/lib/tailscale
      TS_SERVE_CONFIG: /config/serve.json
      TS_USERSPACE: "true"
    volumes:
      - surepetcare-tailscale:/var/lib/tailscale
      - ./surepet-ts:/config:ro
```

with `surepetcare-tailscale:` added under `volumes:`, and `surepet-ts/serve.json`:

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://surepetcare-mcp:3000" } }
    }
  },
  "AllowFunnel": { "${TS_CERT_DOMAIN}:443": true }
}
```

Generate the auth key in the Tailscale admin console under **Settings → Keys**. Without
one, the container prints a login link that expires after about a minute. Once logged
in, the machine stays logged in through the volume and the key can be removed.

With a **Cloudflare Tunnel** (needs a domain on Cloudflare), point a public hostname at
the server instead. Don't put Cloudflare Access in front of it: claude.ai can't get
past its login page.

Check the public URL before connecting Claude:

```bash
curl https://<your public host>/.well-known/oauth-authorization-server
```

It should return JSON whose `issuer` matches `MCP_PUBLIC_URL`.

Update with `docker compose pull && docker compose up -d`. The server trusts one proxy
hop (`X-Forwarded-For` from the tunnel in front of it) for rate limiting. Don't also
publish its port directly to the internet.

### Connecting Claude

In claude.ai: **Settings → Connectors → Add custom connector**, with URL
`https://<your public host>/mcp`. Claude registers itself, opens the passphrase page,
and once you allow it, the tools show up in claude.ai and the mobile apps.

## References

- Reverse-engineered API (PHP): https://github.com/alextoft/sureflap
- Python client (surepy): https://github.com/benleb/surepy
- Local MQTT alternative (PetHubLocal): https://github.com/PetHubLocal/pethublocal
