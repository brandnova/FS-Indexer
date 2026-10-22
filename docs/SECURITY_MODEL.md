# Security model

This page says what Perigee Files protects, how, and where its limits are.

## What it protects

- Your **file list** (names, sizes, dates) and, if you allow it, your **files**.
- Your **PC's folders**, from being written to by phones, except one drop folder you choose.
- The **dashboard**, from other people and web pages.

## What it assumes

- You use it on a **network you trust**, or a direct hotspot link between just your phone and your PC.
- Your PC and phone are not already compromised.

## How it protects you

**Who can connect**
- The agent only accepts connections from your **local network** (private, loopback and link-local addresses), plus any ranges you add under `allowed_networks`.
- Each phone has its **own key**. The PC stores only a hash of it (`devices.json`), so a copy of that file can't be used to read your file list. Remove a phone and its key stops working immediately.
- The QR code carries a **one-time pairing code** (10 letters and digits, about 50 bits), valid for **ten minutes** and usable **once**. It is kept in memory, never written to disk or the log.
- Ten wrong keys or codes within a minute lock that address out for a minute.
- The old shared token (from earlier versions) can be switched off. It is off on new installs.

**What can be read**
- You choose the folders. **Secrets are always skipped**: `.ssh`, `.gnupg`, `.aws`, `.env`, `*.pem`, `*.key`, password-manager files and similar. Hidden files are off by default. Links are never followed.
- **File access is off by default.** When on, a file is sent only if it is an exact entry of the current file list, its folder is switched on, no rule skips it, and (after following any links) it is still inside the shared folder and a plain file. At most four files are sent at once.

**What can be written**
- **Receiving files is off by default.** Only phones paired with a code can send. Files go only into the drop folder you chose, which can't be a drive root, your home folder or the agent's settings folder. The name is reduced to a plain file name, nothing is overwritten, a file appears only once it has fully arrived, program files are refused unless you allow them, and you set a size limit and a files-per-hour limit.

**The dashboard**
- It listens on `127.0.0.1` **only**. It opens with a **one-time link** that starts a private session, every change needs a **CSRF token**, and the `Host`, `Origin` and `Sec-Fetch-Site` headers are checked, which blocks DNS-rebinding and cross-site requests. It sends a strict content-security policy and sets no third-party scripts.

**Your data in logs and reports**
- Keys and pairing codes are never logged. Problem reports remove your keys and replace your home folder with `~`. IP addresses are masked by default. A report is only created when you ask for it.

## Limits you should know about

- **The connection is not encrypted yet** (plain HTTP). Someone on the same network could read the file list, and could capture a key or pairing code while pairing happens, and could read files while they are being sent. That is why the dashboard and app say "trusted networks only", and why opening and sending files are off by default. Encrypting the connection is planned.
- Anyone who can use your PC's account can read the agent's settings and the dashboard session. The settings and device files are readable only by you (mode 0600 where supported).
- The downloads aren't code-signed yet, so Windows and macOS will warn.
- Android 9 and older keep downloads in a folder that other apps with storage permission can read.

## Good habits

- Pair at home, or over a hotspot between just your two devices.
- Leave "Open and download files" and "Receive files" off unless you need them, and turn them off again afterwards.
- Remove phones you no longer use (**Phones → Remove**).
- Keep the agent and the app updated, and from the same release.
- For tighter control: keep the PC's firewall limited to private networks, and use `allowed_networks` only for ranges you trust.

## Reporting a problem

See [SECURITY.md](../SECURITY.md).