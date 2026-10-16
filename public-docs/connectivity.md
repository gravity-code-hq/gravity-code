---
title: Connectivity
description: Connect a Gravity client to your daemon through SSH, the relay, or Tailscale.
nav: Connectivity
order: 4
category: Getting started
---

# Connectivity

Your Gravity app connects to the daemon running on your computer or server. Gravity Desktop and the CLI can tunnel through SSH. Mobile clients can connect through the Gravity relay or directly with Tailscale.

This is client-to-daemon transport. If you are looking for the service that starts agents from GitHub, Slack, and Discord events, that is [Hub](/docs/hub).

- [SSH](#ssh)
- [Gravity relay](#gravity-relay)
- [Tailscale](#tailscale)

## SSH

SSH transport connects to an existing daemon through your local OpenSSH client. It does not install, start, or configure Gravity on the remote host.

Before connecting:

1. Start the Gravity daemon on the remote host.
2. Confirm `ssh user@host` works with a key or SSH agent. Gravity uses non-interactive SSH and follows your OpenSSH config.

The CLI accepts an SSH URI as its host:

```bash
gravity --host ssh://user@host ls -a
```

The daemon is expected at `127.0.0.1:6767` on the remote host. The port in the SSH URL is the SSH server port:

```bash
gravity --host ssh://user@host:2222 ls -a
```

Set a different remote daemon port with `daemonPort`:

```bash
gravity --host 'ssh://user@host?daemonPort=7777' ls -a
```

Put `--host` before the command. `gravity daemon status` observes the default local home; use `gravity --host ssh://user@host daemon status` to query a remote daemon. `gravity --host ssh://user@host run --cwd /path/on/remote ...` requires a working directory that exists on the remote host.

In Gravity Desktop, open **Settings → Add host → Remote SSH** and enter the same `ssh://` destination.

## Gravity relay

The relay works without Tailscale, port forwarding, or network configuration. Traffic is end-to-end encrypted.

Relay is disabled until you enable it.

### Enable relay from Gravity Desktop

1. Open **Settings → your host → Pair a device**.
2. Select **Enable relay**.
3. Scan the QR code with Gravity on your phone, or copy the pairing link and paste it into the phone app.

### Enable relay from the CLI

Run:

```bash
gravity daemon pair
```

Confirm when prompted. Gravity prints a QR code and pairing link. Scan the QR code with Gravity on your phone, or choose **Paste pairing link** in the phone app.

## Tailscale

Install [Tailscale](https://tailscale.com/download) on the daemon machine and your phone. Sign in to the same tailnet on both devices.

### 1. Find the daemon machine's Tailscale IP

Run this on the daemon machine:

```bash
tailscale ip -4
```

Copy the address it prints. The example below uses `100.101.102.103`.

### 2. Configure the daemon

Open `~/.gravity/config.json` and set `daemon.listen` to the Tailscale IP:

```json
{
  "$schema": "https://github.com/gravity-code-hq/gravity-code/schemas/gravity.config.v1.json",
  "version": 1,
  "daemon": {
    "listen": "100.101.102.103:6767"
  }
}
```

Keep the other settings already in the file. If it has a `daemon` object, add `listen` inside that object.

To restrict access with a password, see [Password authentication](/docs/configuration#password-authentication).

Restart the daemon:

```bash
gravity daemon restart
```

If Gravity Desktop manages the daemon, use **Settings → your host → Overview → Restart daemon**.

### 3. Connect the phone app

1. Connect Tailscale on your phone.
2. Open Gravity and go to **Settings → Add host → Direct connection**.
3. Enter the Tailscale IP in **Host**.
4. Enter `6767` in **Port**.
5. Leave **Use SSL** off and select **Connect**.

If the host was already paired through the relay, Gravity adds the direct connection to the same host.

## Troubleshooting

- **SSH authentication failed:** Run `ssh user@host` in a terminal and fix the key, agent, host key, or `~/.ssh/config` entry there. Gravity does not prompt for SSH passwords.
- **SSH connects but Gravity is refused:** Run `gravity daemon status` on the remote host. SSH transport does not start the daemon.
- **Connection timed out:** Check that Tailscale is connected on both devices and that you used the daemon machine's Tailscale IP.
- **Connection refused:** Run `gravity daemon status` and confirm the daemon is running on the configured IP and port.
- **Config change has no effect:** Run `gravity reload`. `daemon.listen` is a startup setting, so restart when the command reports it.
