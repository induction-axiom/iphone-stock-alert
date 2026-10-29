# Duo Watch

Get a loud alarm the moment an **iPhone Duo (256GB, Star White)** becomes available for in-store pickup near you.

It runs in **your own Chrome tab** on apple.com, the same way you'd check the page by hand, about every 10 seconds. A small Mac helper makes the alarm hard to miss.

> Personal tool, not affiliated with Apple. Apple can change or block its stock check at any time.

## What you get

- A floating panel on the Apple page: live status, every nearby store, draggable, light/dark, **EN / 中文** switch (English by default)
- When stock shows up: Mac volume to max + a repeating spoken alert + a dialog that stays until you click it, a Chrome notification, and an optional push to your phone
- A spoken warning if monitoring stops or Apple starts blocking it

## Setup (5 minutes)

**1. Start the alarm helper** and leave the window open:

```bash
python3 helper/duo_alarm.py
```

Try the alarm first with `python3 helper/duo_alarm.py --test` (it's loud; click **Got it** to stop).

**2. Load the extension**

1. Open `chrome://extensions` and turn on **Developer mode**
2. Click **Load unpacked** and pick the `extension` folder

**3. Start watching**

1. Open the iPhone Duo buy page for your country, for example [US](https://www.apple.com/shop/buy-iphone/iphone-duo) or [Canada](https://www.apple.com/ca/shop/buy-iphone/iphone-duo)
2. In the panel, open **Settings**, enter your postal/ZIP code, then click **Start watching**
3. Drag that tab into its own window and leave it open (not minimized)

## Keep it running

- **Don't close the lid.** A sleeping Mac checks nothing. The helper already prevents idle sleep (the screen can go dark). If you need the lid closed, run `sudo pmset -a disablesleep 1`, and undo it later with `sudo pmset -a disablesleep 0`.
- **Stop Chrome from pausing the tab.** In `chrome://settings/performance`, add `apple.com` to *Always keep these sites active* and turn off *Energy Saver*.
- **Survive closing Terminal:**
  ```bash
  tmux new -d -s duo 'while true; do python3 helper/duo_alarm.py; sleep 5; done'
  ```

## Phone alerts (optional)

Install the [ntfy](https://ntfy.sh) app, subscribe to a random topic name only you know, then start the helper with:

```bash
NTFY_TOPIC=your-random-topic python3 helper/duo_alarm.py
```

## Troubleshooting

| You see | What it means |
|---|---|
| `HTTP 541` | Apple is temporarily blocking checks. The extension backs off by itself (up to 5 minutes between checks) and recovers. |
| "Couldn't find the part number" | Enter it by hand in Settings (the US part is `MK1E4LL/A`). |
| "Unrecognized response format" | Apple changed its response. Open DevTools → Console and look for `[Duo Watch] raw response`. |
| "Mac alarm not running" | Start `helper/duo_alarm.py`. Without it you only get the Chrome notification. |

**Want a different model?** Change `TARGET` at the top of `extension/content.js` (for example `capacity: '512gb', color: 'nightsky'`), then reload the extension.

**Tests:** `node extension/test.js`
