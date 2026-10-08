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

**On your phone (the app):**

- It stores the PC's address and access token in the phone's secure storage (Android Keystore / iOS Keychain).
- It stores a copy of the file list (names, paths, sizes, dates) in a local database on the phone, so you can browse and search offline.
- It uses the camera only to scan the pairing QR code. Images are not saved or sent anywhere.
- It uses local-network access only to talk to your own PC.
- It stores your pinned folders and app settings on the phone. Copying a file's path puts that text on your clipboard only when you tap Copy.

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