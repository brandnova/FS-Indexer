# Privacy Policy

**App:** FS Indexer (the mobile app) and FS Indexer Agent (the PC program)
**Effective date:** 05-10-2026
**Contact:** brandnova.dev@gmail.com
**Source code:** [Repo URL](https://github.com/brandnova/FS-Indexer.git)

## The short version

FS Indexer does not collect your data. There are no accounts, no analytics, no advertising, and no servers run by the developer. Everything stays on your own devices and your own network.

## What the software does with your data

**On your PC (the agent):**

- It reads the folders listed in its `config.json` (by default, your standard folders such as Documents and Downloads)..
- It builds a list of file names, paths, sizes and modification times, which it keeps in memory.
- It shares that list only with phones that present your access token, over your local network.
- It stores its settings (including the access token) in a local configuration file on your PC.
- It does not read or upload the contents of your files.
- It also tells paired phones where each chosen folder is on your PC (for example `/home/you/Documents`), so the app can show full file paths.
- It keeps a log (`agent.log`, next to its settings file) of what it does, such as scans, folder changes, and when a phone on your network updated its file list or used a wrong token. The log stays on your computer and never contains the access token. A problem report is only created when you ask for it, and nothing is sent anywhere automatically.
- If you turn on "start on login", the agent adds one entry to your account so it can start by itself: a value under the Run key in the Windows registry, a login item file in `~/Library/LaunchAgents` on macOS, or a file in `~/.config/autostart` on Linux. Turning the setting off removes that entry. Nothing is installed for other users of the computer.
- The agent keeps a list of the phones you paired (`devices.json`): the name each phone gave itself, when it was paired and last seen, and its address on your network, plus a hash of its key. Remove a phone in the dashboard and its entry is deleted.
- With "Let my phone open and download files" switched on, the contents of the files you open on your phone are sent from your PC to that phone over your network. Nothing goes anywhere else, and the agent logs which file was opened and by which phone (in the log on your PC).

**On your phone (the app):**

- It stores the PC's address and access token in the phone's secure storage (Android Keystore / iOS Keychain).
- It stores a copy of the file list (names, paths, sizes, dates) in a local database on the phone, so you can browse and search offline.
- It uses the camera only to scan the pairing QR code. Images are not saved or sent anywhere.
- It uses local-network access only to talk to your own PC.
- It stores your pinned folders and app settings on the phone. Copying a file's path puts that text on your clipboard only when you tap Copy.
- It remembers where your PC's folders are located, so it can show and copy full paths.
- A file you open on your phone is copied into the app's temporary storage first. The app deletes these copies after a day, and when you forget the PC. They are never uploaded anywhere.

## What we collect and share

Nothing. The developer receives no data from the app or the agent. Nothing is sent to third parties, and the software contains no analytics or advertising.

## Network security

In the current version, the connection between the app and the agent uses plain HTTP on your local network, protected by a shared access token. Only use the software on networks you trust. See `SECURITY.md` for details.

## Deleting your data

- **Phone:** tap **Unpair** in the app to delete the saved token and the local file list, or uninstall the app.
- **PC:** delete the agent's configuration file and uninstall the program.

## Children

The software is not directed at children and does not knowingly collect any data from anyone.

## Changes to this policy

If this policy changes, the updated version will be published at this location with a new effective date.

## Contact

Questions about privacy: brandnova.dev@gmail.com