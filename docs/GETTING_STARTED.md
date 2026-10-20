# Getting started

## What you need

- A computer running Windows, macOS or Linux (the agent).
- An Android phone (the app). iPhone support is planned.
- Both on the **same network you trust**, such as your home Wi-Fi, or a hotspot shared between just the two.

## 1. Install the agent

Download it from the [releases page](https://github.com/brandnova/FS-Indexer/releases).

**Windows.** Unzip `fsagent_<version>_windows_amd64.zip` and double-click `fsagent.exe`. If SmartScreen warns you, choose **More info**, then **Run anyway** (the download isn't code-signed yet). When Windows asks about the firewall, allow **Private networks**.

**macOS.** Unzip the `.app.zip` for your Mac (Apple silicon is `arm64`, Intel is `amd64`), then right-click **FS Indexer** and choose **Open**. If macOS still blocks it, open System Settings, Privacy & Security, and choose **Open Anyway**, or run `xattr -dr com.apple.quarantine "FS Indexer.app"` in Terminal.

**Linux.** Install the package for your system:

```bash
sudo dnf install ./fsagent_*_linux_amd64.rpm      # Fedora, RHEL
sudo apt install ./fsagent_*_linux_amd64.deb      # Debian, Ubuntu
```

Then start **FS Indexer** from your applications menu, or run `fsagent` in a terminal. The `.tar.gz` also works anywhere.

The first time it runs, the agent opens its **dashboard** in your browser and shows a pairing code.

## 2. Install the app

Download `fs-browser-<version>.apk` from the same release. Open it on your phone and allow "install from this source" when asked.

## 3. Pair your phone

1. Open the app and tap **Scan QR code**.
2. Point the camera at the QR code in the dashboard (**Phones** page).
3. Tap **Update**. Your files appear.

No camera? Choose **Enter details manually** and type the address and code shown in the dashboard. Each code works once and runs out after ten minutes. **New code** makes another.

## 4. Choose what to share

In the dashboard, open **Folders**. Add or remove folders, and switch any of them off. Passwords, keys and `.env` files are always skipped. Under **Privacy filters** you can add your own skip rules and test whether a path would be shared.

## Optional: open, download and send files

By default your phone only sees file names. In the dashboard, **Settings**:

- **Open and download files** lets the phone open, preview and download files. Downloads are saved to the phone's **Downloads** folder.
- **Receive files from my phone** lets the phone send files into one **drop folder** you choose, within size and per-hour limits. Nothing is ever overwritten.

Both are off until you turn them on, and the dashboard explains the trade-off first: the connection isn't encrypted, so use them only on a network you trust.

## Start on login

Dashboard, **Settings**, **Start when I sign in**, or run `fsagent -autostart on`. The agent then starts quietly and never opens a window by itself. Open the dashboard any time with `fsagent -ui`, or from the app menu.

## If something doesn't work

Open the dashboard, then **Help → Check my setup**. It tests your settings, folders, network, ports and firewall, and says what to fix. From a terminal: `fsagent -doctor`. See the [FAQ](FAQ.md).

## Command line

| Option | What it does |
| --- | --- |
| `-ui` | Open the dashboard (starting the agent in the background if needed) |
| `-pair` | Show a pairing code and QR code for the running agent |
| `-doctor` | Check your setup |
| `-report` | Print a problem report (keys and user name removed) |
| `-autostart on\|off\|status` | Start the agent when you sign in |
| `-stop` | Stop the agent running in the background |
| `-background` | Run with no window |
| `-config <file>` | Use another settings file |
| `-host <ip>` | Use this address in the pairing code |
| `-no-mdns`, `-no-web`, `-no-open`, `-no-qr`, `-quiet`, `-no-color`, `-verbose` | Fine tuning (see `fsagent -h`) |
| `-rotate-token` | Replace the old shared token (phones paired with a code are unaffected) |
| `-version` | Show the version |

## Where things are stored

| What | Where |
| --- | --- |
| Settings | `config.json` in the OS config folder: `~/.config/fs-indexer/` (Linux), `%AppData%\fs-indexer\` (Windows), `~/Library/Application Support/fs-indexer/` (macOS) |
| Paired phones | `devices.json`, next to the settings (only hashes of keys are kept) |
| Log | `agent.log`, next to the settings (it rotates at 2 MB and keeps 3 older files) |

## Uninstall

1. Dashboard, **Settings**: switch **Start when I sign in** off (or run `fsagent -autostart off`).
2. Quit the agent (**Quit the agent** in the dashboard, or `fsagent -stop`).
3. Remove the program: delete the app (Windows/macOS), or `sudo dnf remove fsagent` / `sudo apt remove fsagent`.
4. Delete the settings folder shown above if you want everything gone.
5. On the phone: in the app, **Settings → Unpair this PC**, then uninstall the app. Files you saved in Downloads stay until you delete them.