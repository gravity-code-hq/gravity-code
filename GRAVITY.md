# Gravity

Local-only build. Desktop app + local daemon. No remote web client, no relay, no in-app browser tabs.

The window title is **Gravity**. The CLI command from this repo is `npm run gravity`.

Electron still uses Chromium to draw the desktop UI. That is not a remote browser app. We turned off the web client and the phone remote.

## What is off

- Daemon does **not** serve a browser UI on `:6767` / `:6768`
- Relay never starts (no pairing, no remote phone/web)
- In-app browser tabs, browser automation, and browser settings are gone
- `npm run web` is disabled

## Run it on your laptop

Need **Node 26+** (this machine: 26.8.2, see `.tool-versions`) and at least one agent CLI logged in (Claude Code, Codex, …).

```bash
cd /path/to/gravity
npm ci
```

Quit any packaged Gravity app first if it is running, so it does not fight this checkout.

**Two terminals:**

```bash
# 1) local daemon (127.0.0.1:6768, state in .dev/gravity-home)
npm run dev:server

# 2) Gravity desktop window
npm run dev:gravity-desktop
```

**CLI against this checkout:**

```bash
npm run gravity -- daemon status
npm run gravity -- ls -a -g
```

Do **not** use the global `gravity` binary. That is the packaged desktop install, not this checkout.

## Ports

|        | Packaged Gravity | This checkout       |
| ------ | ---------------- | ------------------- |
| Daemon | `localhost:6767` | `localhost:6768`    |
| State  | `~/.gravity`     | `.dev/gravity-home` |

## Fast path later

For a packaged desktop build (no Metro):

```bash
npm run build:desktop
```

Daily hacking is `dev:server` + `dev:gravity-desktop`.
