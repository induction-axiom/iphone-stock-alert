# <img src="extension/icons/icon128.png" width="36" align="top" alt=""> iPhone Stock Alert

Pick the iPhone you want and get alerted the moment it's available for in-store pickup near you.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/on-apple-dark.png">
  <img src="docs/on-apple-light.png" alt="The iPhone Stock Alert panel on Apple's iPhone Duo buy page, watching nearby stores">
</picture>

A small panel sits on Apple's own buy page and checks nearby stores about every 10 seconds, from **your own Chrome tab**, the same way you'd check by hand. It works on any iPhone buy page (iPhone Duo, iPhone 18 Pro, …), in English or 中文.

> Personal tool, not affiliated with Apple. Apple can change or block its stock check at any time.

## Install

1. Download this repo (**Code → Download ZIP**, then unzip)
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension` folder
3. Open the buy page for your iPhone, for example [iPhone Duo (US)](https://www.apple.com/shop/buy-iphone/iphone-duo) or [iPhone Duo (Canada)](https://www.apple.com/ca/shop/buy-iphone/iphone-duo)
4. In the panel, pick a model and enter your postal code, tap the alerts you want, then **Start watching**

Leave that tab open in its own window. Any store Apple lists near your postal code counts, and the panel shows how far each one is.

When it shows up, the panel turns red and every alert you picked goes off:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/in-stock-on-apple-dark.png">
  <img src="docs/in-stock-on-apple-light.png" alt="The panel on Apple's buy page when a nearby store has the iPhone in stock">
</picture>

<sub>Screenshots show Apple's real buy page with example store results.</sub>

## Alerts

Tap **Chrome**, **Voice** or **Phone** in the panel to turn each one on or off, and **Test** to try the ones that are on. Nothing to install: it's all in the extension.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/alerts-dark.png">
    <img src="docs/alerts-light.png" width="320" alt="Alert options">
  </picture>
</p>

| Alert | What happens | Setup |
|---|---|---|
| **Chrome notification** (on by default) | A notification that stays until clicked; the tab jumps to the front | None. If nothing pops up, allow Google Chrome in macOS System Settings → Notifications |
| **Say it out loud** (on by default) | Your Mac's voice repeats "iPhone … is in stock!" until you click **Silence alarm** or the notification | Keep the volume up and Mute off |
| **Push to my phone** | A max-priority push via the free [ntfy](https://ntfy.sh) app | Subscribe to the topic shown in the panel |

## Keep it running

- **Keep the lid open.** A sleeping Mac checks nothing. While watching, the extension keeps the Mac awake (the screen can still turn off). If checks were paused anyway, the panel says for how long, and so does your phone if phone alerts are on. Closing the Apple tab also sends an alert.
- **Keep Chrome from pausing the tab:** in `chrome://settings/performance`, add `apple.com` to *Always keep these sites active*.
- If Apple temporarily blocks checks (`HTTP 541`), the extension backs off on its own and recovers. If checks keep failing for 5 minutes, it tells you once.

## Troubleshooting

| You see | Do this |
|---|---|
| `HTTP 541` | Nothing. Apple is rate-limiting; checks slow down (up to 5 minutes apart) and recover by themselves. |
| The model list is empty | Enter the part number by hand (for example `MK1E4LL/A`). |
| "Unrecognized response format" | Apple changed its page. Open DevTools → Console and look for `[iPhone Stock Alert] raw response`. |
| The voice test is silent | Turn the Mac's volume up and Mute off. |

Developers: run tests with `node extension/test.js`.
