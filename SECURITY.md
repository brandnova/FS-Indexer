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