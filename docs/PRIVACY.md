# Privacy policy

**Perigee Files** (the agent for your computer, and the app for your phone)
Last updated: 20 October 2026

## The short version

**We don't collect your data.** Perigee Files has no accounts, no ads and no analytics, and nothing is sent to us. Your file list and your files stay on your own PC and phone. The only connection to the internet is optional and off by default: if you switch on update checks on your PC, the agent asks GitHub once a day for the newest version number (see below).

## Who is responsible

Perigee Files is published by **Brand Nova** ([brandnova.pythonanywhere.com](https://brandnova.pythonanywhere.com)). Contact: **brandnova.dev@gmail.com**, or open an issue at [github.com/brandnova/perigee-files/issues](https://github.com/brandnova/perigee-files/issues).

## What the agent (on your PC) uses

- **Your file list.** The agent reads the names, sizes and dates of the files in the folders you choose. It keeps this list in memory only.
- **Settings and paired phones**, stored on your PC: your chosen folders and options, and for each paired phone its name, when it was paired and last seen, its address on your network, and a hash of its key (never the key itself).
- **A log** (`agent.log`) of what the agent did: scans, folder changes, which phone connected, and which files were opened or received. It stays on your PC, never contains keys or pairing codes, and rotates automatically.
- **Files you choose to let phones open**, and files phones send to your drop folder. Both are off until you turn them on.

All of this stays on your PC. You can see it all in the dashboard, and delete it by removing the settings folder.

## What the app (on your phone) stores

- The **pairing**: your PC's name and address, and this phone's key (in the phone's secure storage).
- **A copy of your file list** (names, folder paths, sizes, dates), so you can search offline.
- Your **pins and settings** (theme, update options).
- **Temporary copies** of files you open or send. They are deleted when the transfer ends, or after a day.
- A **downloads list**: names of files you downloaded, kept for 30 days.
- **Files you download**, in your phone's Downloads folder. They are yours: the app never deletes them.

All of this stays on your phone. **Unpair this PC** deletes the pairing, the file list, your pins and the downloads list.

## What leaves your devices

- Between your phone and your PC, over **your own network**: the file list, your phone's name, and, if you allow it, files you open or send. This traffic is **not encrypted yet**, so use a network you trust.
- **Nothing is sent to us.** There are no tracking tools, no advertising IDs and no crash-reporting services in the project.
- **Optional update check (off by default).** If you switch on "Check for updates" in the PC dashboard, the agent asks GitHub's public releases list for the newest version number once a day, and shows you if there is one. Only a normal web request is made: GitHub sees your IP address, as any website would, and nothing about your files, your phone or your settings is sent. Your phone is told about the new version by your PC and never contacts GitHub itself.
- If you press **Report a problem**, a text report is built on your PC. It stays on your screen until **you** copy, download or send it. It removes your keys and your user name.

## Permissions the app asks for

- **Camera**: only to scan the pairing QR code. Nothing is recorded or saved.
- **Local network and internet access**: to talk to your PC. (Android calls this the "internet" permission; it is used only for your local network.)
- **Storage (Android 9 and older only)**: to save downloads to the Downloads folder.

## Third parties

None receive your data. Google Play and the App Store may collect their own diagnostic information when you install the app, under their own policies.

## Children

The app doesn't knowingly collect anything from anyone, children included.

## Your choices and deleting your data

- Remove a phone: dashboard, **Phones → Remove**.
- Turn off opening or receiving files: dashboard, **Settings**.
- Delete the app's data: **Settings → Unpair this PC**, or uninstall the app.
- Delete the agent's data: delete its settings folder (see [Getting started](GETTING_STARTED.md)).

## Open source

The code is public at [github.com/brandnova/perigee-files](https://github.com/brandnova/perigee-files), so you can check any of this.

## Changes

If this policy changes, the new version will be published here with a new date, and significant changes will be announced in the release notes.

## Contact

**brandnova.dev@gmail.com** · [GitHub issues](https://github.com/brandnova/perigee-files/issues)
