---
title: Docker
description: Run the Gravity daemon and bundled web UI with the official Docker image.
nav: Docker
order: 6
category: Getting started
---

# Docker

The official Gravity Docker image runs the daemon and serves the bundled browser UI from the same HTTP origin. It is meant for servers, dev boxes, NAS devices, homelab hosts, and other places where you want Gravity running without the desktop app.

Docker images follow the stable Gravity release cadence. `ghcr.io/gravity-code-hq/gravity:latest` points at the latest stable release, not an arbitrary `main` build.

```bash
docker run -d --name gravity \
  -p 6767:6767 \
  -e GRAVITY_PASSWORD=change-me \
  -v "$PWD/gravity-home:/home/gravity" \
  -v "$PWD:/workspace" \
  ghcr.io/gravity-code-hq/gravity:latest
```

Then open:

```text
http://localhost:6767
```

If you set `GRAVITY_PASSWORD`, use that same password when adding the direct daemon connection in the web UI, mobile app, or CLI.

## What the image includes

The image:

- installs the Gravity daemon and CLI
- serves the bundled web UI
- listens on `0.0.0.0:6767` inside the container
- stores daemon state under `/home/gravity/.gravity`
- runs the daemon and launched agents as the non-root `gravity` user

The image does not bundle agent CLIs such as Claude Code, Codex, OpenCode, Copilot, or Pi. Add the agents you use with a small child image.

Host-side CLI commands select the container explicitly, for example `gravity project ls --host 127.0.0.1:6767`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Docker Compose

```yaml
services:
  gravity:
    image: ghcr.io/gravity-code-hq/gravity:latest
    container_name: gravity
    restart: unless-stopped
    ports:
      - "6767:6767"
    environment:
      GRAVITY_PASSWORD: "change-me"
      # GRAVITY_HOSTNAMES: "gravity.example.com,.lan"
    volumes:
      - ./gravity-home:/home/gravity
      - ./workspace:/workspace
```

Start it:

```bash
docker compose up -d
```

## Install agent CLIs

Create a child image for the providers you want available:

```Dockerfile
FROM ghcr.io/gravity-code-hq/gravity:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -t gravity-with-agents .
```

Then use `image: gravity-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for first-run mounted-volume setup, then drops the daemon and launched agents to the non-root `gravity` user.

You can authenticate agents either by passing provider environment variables or by running the provider login flow inside the container:

```bash
docker exec -it --user gravity gravity codex
docker exec -it --user gravity gravity claude
```

Agent credentials persist in `/home/gravity`.

## Volumes

Mount two paths for most deployments:

| Mount           | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `/home/gravity` | Gravity state plus agent config and credentials such as `.codex`, `.claude` |
| `/workspace`    | Code that Gravity and launched agents can read and write                    |

On Linux, the built-in `gravity` user is uid/gid `1000:1000`. Make mounted directories writable by that user, or run the container with Docker's `--user` / Compose `user:` option.

## Reverse proxy

Forward normal HTTP traffic and WebSocket upgrades to the container.

Caddy:

```caddy
gravity.example.com {
  reverse_proxy 127.0.0.1:6767
}
```

Nginx:

```nginx
server {
    listen 443 ssl;
    server_name gravity.example.com;

    location / {
        proxy_pass http://127.0.0.1:6767;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach Gravity by DNS name, allow that host:

```yaml
environment:
  GRAVITY_HOSTNAMES: "gravity.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

Set `GRAVITY_PASSWORD` for any published port or network-reachable deployment. Use HTTPS at your reverse proxy for browser access outside localhost.

The static web UI is public on the daemon origin. The daemon API and WebSocket are protected by password auth when configured.

Agents can access whatever you mount into `/workspace` and whatever credentials you place in `/home/gravity`. Keep those mounts scoped to what the agents should be able to use.

See [Security](/docs/security) for the full daemon trust model.

## Troubleshooting

- **The UI loads but cannot connect:** if `GRAVITY_PASSWORD` is set, add a direct connection with the same password.
- **403 Host not allowed:** set `GRAVITY_HOSTNAMES` to the DNS names you use.
- **Provider not available:** install that agent CLI in a child image or make sure the binary is on `PATH`.
- **Permission errors in `/workspace`:** make the mounted directory writable by uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs:** run `docker logs gravity`, or inspect `/home/gravity/.gravity/daemon.log` inside the container.
