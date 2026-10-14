# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately using either:

- GitHub's **Report a vulnerability** button on this repository's **Security** tab, or
- Email: brandnova.dev@gmail.com

Please include what you found, steps to reproduce, the affected version (`fsagent -version` and the app version), and the impact you expect.

**What to expect** (this is a solo-maintained project, so these are good-faith targets, not guarantees):

- Acknowledgement within 7 days
- An initial assessment within 14 days
- A fix or mitigation as soon as practical, depending on severity
- Credit in the release notes if you want it

Please give me a reasonable chance to fix an issue before disclosing it publicly. 90 days is a fair default. There is no bug bounty.

Good-faith security research on your own devices and network is welcome. Please don't access other people's data, and don't test against networks you don't own.

## What the software exposes

The agent shares **file names, paths, sizes and modification times** for the folders in `roots` (by default your standard folders such as Documents and Downloads), plus the **full location** of each of those folders on your PC, to phones that present the access token. In the current version it does **not** serve file contents.

## Known limitations

These are documented design limits of the current version, not vulnerabilities, so reports about them alone are out of scope:

- **Plain HTTP.** Traffic between the app and the agent is not encrypted. Someone who can sniff your Wi-Fi can read it, including the token. TLS with certificate pinning is on the roadmap.
- **One shared token.** Anyone who has the token can read the file listing. The pairing QR code contains the token, so treat it like a password and don't screenshot or screen-share it.
- **LAN only.** The agent rejects connections from non-private addresses as a safety net. That is not a firewall.
- **Discovery is visible.** With mDNS enabled, the device name and id are visible to everyone on the local network. The token is never advertised. Use `-no-mdns` to turn it off.

## The dashboard

The agent has a small dashboard for the person at the computer (`http://127.0.0.1:<port>`). It listens on the loopback address only, so other devices on your network can't reach it. It opens with a one-time link; after that a private session cookie keeps you signed in. Every request is checked for the right Host and Origin, and every action needs a per-session token. That protects against malicious web pages and DNS-rebinding attacks. Programs that run as the same user on your computer can read the agent's settings and runtime files; that is normal for software you run yourself. Turn the dashboard off with `-no-web` or `"disable_web_ui": true`.

Through the dashboard you can also add and remove shared folders. For that it lists folder names on the computer (never file names) to a signed-in dashboard only, and every change needs the session token. Shared folders can't be a whole drive or your whole home folder.

Each phone has its own key. The PC keeps only a hash of it (in `devices.json`, readable only by you), so a copy of that file can't be used to read your file list. The QR code carries a one-time pairing code, not a permanent secret: a photo of the screen is useless after ten minutes or after one use. Ten wrong keys or codes in a minute lock that address out for a minute. Until the connection itself is encrypted, the code and the key cross your local network as plain HTTP: pair at home, not on a network you don't trust.

File access is off until you turn it on, and then paired phones can read any file the agent lists. The agent re-checks every request: the path must be an exact entry of the current file list, the folder must be switched on, no rule may skip it, and after following links it must still be inside the shared folder and be a plain file. At most four files are sent at once. The connection is not encrypted yet (see "Trusted networks only" in the README), so a device on the same network could read a file while it is being sent. Turn file access on only at home, or with a direct hotspot link.

Receiving files is off until you turn it on. Only phones paired with a code can send files (not the old shared token). Files go only into the drop folder you chose, which can't be a whole drive, your home folder, or the agent's settings folder. The name is reduced to a plain file name (no folders, nothing Windows forbids), nothing is ever overwritten, a file appears only once it has fully arrived, program files are refused unless you allow them, and you set a size limit and a limit on files per hour. At most two uploads run at once, and a stalled upload times out. The connection isn't encrypted yet: use it on a trusted network.

## In scope

- Authentication or LAN-guard bypass
- Token leakage (logs, mDNS, API responses)
- Path handling bugs that expose data outside the configured `roots`
- Crashes or resource exhaustion triggered by a malformed request or file name
- Bugs in the mobile app that expose the token or index to other apps

## Out of scope

- Attacks that already require the token
- Attacks that require control of your local network or device (see the limitations above)
- Denial of service by a device already authorized on your network
- Issues in third-party dependencies with no demonstrated impact here (report them upstream)

## Running it safely

- Never port-forward the agent to the internet.
- Keep `roots` as narrow as you can, and don't index folders with secrets.
- Only use it on networks you trust, until TLS is available.
- If the pairing QR or token was exposed, set `"token": ""` in `config.json` and restart the agent. A new token is generated, and you re-pair your phones.
- Only add networks to `allowed_networks` that you control, such as a VPN range. Traffic over a VPN like Tailscale is encrypted by the VPN itself, but traffic on a plain network is not.