# Frequently asked questions

## Is it safe? Do my files leave my computer?

Only the **names, sizes and dates** of the folders you choose are copied to your phone. File **contents** never leave your PC unless you switch on "Open and download files" and then open or download one. Nothing is ever sent to us or to the internet. The one thing to know: the connection between your phone and PC is **not encrypted yet**, so use it on a network you trust. See the [security model](SECURITY_MODEL.md).

## My phone can't connect.

1. Open the dashboard, then **Help → Check my setup** (or run `perigee-doctor`).
2. Make sure the phone and the PC are on the same Wi-Fi. A guest network often stops devices from seeing each other.
3. Turn off any VPN on the phone and on the PC.
4. Open `http://<address>/api/v1/ping` in the phone's browser (the dashboard shows the address). If you see `{"error":"unauthorized"}`, the network is fine and only the key is wrong: pair again. If nothing loads, a firewall or a router setting is blocking it.
5. Check the PC's firewall allows the agent on **private** networks.

## "This QR code isn't a pairing code" or "That pairing code didn't work."

Each code works **once** and runs out after ten minutes. Press **New code** in the dashboard (Phones page) and scan again. Update the app and the agent to the same release.

## How do I remove a phone?

Dashboard, **Phones**, then **Remove** next to the phone. It stops working immediately.

## What are program files, and why are they refused?

Files that run code when opened, such as `.exe`, `.msi`, `.bat`, `.sh` and `.app`. A harmful one can damage your computer, so uploads of these are refused by default. You can allow them under **Settings → Advanced settings**, but only if you know exactly what you're sending.

## Where do downloaded files go?

On Android, into the phone's **Downloads** folder (open the Downloads app, or the Files app). On iPhone (planned), into the app's Downloads folder, shown in the Files app. **Open** uses a temporary copy that the app deletes after a day, and **Download** keeps one.

## Where do files I send from my phone go?

Into the **drop folder** you chose in the dashboard (**Settings → Receive files from my phone**). The dashboard has an **Open folder** button. A file that already exists is never replaced: the new one gets `(1)` added to its name.

## Downloads fail on Android 9 or older.

Those versions need storage permission before an app can save to Downloads. The app asks once. If you refuse, use **Share** to send the file to another app instead.

## Does it work when my PC is asleep?

You can still search and browse the list your phone already has. Updating, opening and downloading need the PC awake and the agent running.

## Can I use it away from home?

Not directly: the agent only accepts connections from your local network. Using a VPN that puts your phone on your home network works if you add the VPN's range to `allowed_networks` in the settings file. Internet access without a VPN is deliberately not supported.

## Can I run it on a server, or without a screen?

Yes. Run `perigee-no-web -quiet`, or use `-background`. Pair by running `perigee-pair` while it runs.

## Why does my antivirus or SmartScreen warn about the download?

The builds aren't code-signed yet, which makes Windows and macOS cautious about any new program. Check the file against `checksums.txt` on the releases page. The source is open, and you can build it yourself.

## How do I report a bug?

Dashboard, **Help → Report a problem**: it shows exactly what will be shared (your keys and user name are removed) and lets you copy or download it. Then [open an issue](https://github.com/brandnova/perigee-files/issues) or email brandnova.dev@gmail.com and paste the report in the message..
