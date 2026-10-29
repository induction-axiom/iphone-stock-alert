# Chrome Web Store submission

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). The upload is `dist/pickup-alert-for-iphone.zip` from `scripts/package.sh`, the same zip as the GitHub release.

## Package tab

Upload `dist/pickup-alert-for-iphone.zip`.

## Store listing tab

**Description** (the short summary comes from `manifest.json`):

```
Pick the iPhone you want on Apple's own buy page and get alerted the moment a nearby Apple Store has it for pickup.

A small panel sits on Apple's iPhone buy page (iPhone Duo, iPhone 18 Pro and others). Choose a model, enter your postal code, and press Start watching. It checks the stores Apple lists near you about every 10 seconds, straight from your own Chrome tab, the same check you'd do by hand.

When it's in stock, every alert you picked goes off:
• Chrome notification that stays until you click it, and the tab jumps to the front
• Your Mac's voice says "iPhone … is in stock!" until you silence it
• Push to your phone through the free ntfy app

Built for people who just need one phone, without paying for an alert service:
• Free and open source, no account, no server
• Each tab is its own watch: watch two models in two tabs
• Keeps your Mac awake while watching and tells you if checks were paused by sleep
• Backs off by itself if Apple rate-limits, and recovers
• Optional one-time alert if checking stops working (at most once an hour)
• English and 中文

Works on apple.com stores in the US, Canada and other regions that offer in-store pickup.

Not affiliated with or endorsed by Apple. iPhone is a trademark of Apple Inc.

Source code: https://github.com/induction-axiom/pickup-alert-for-iphone
```

- **Category:** Shopping
- **Language:** English
- **Store icon:** `extension/icons/icon128.png`
- **Screenshots (1280×800):** `store/screenshot-1-watching.png`, `store/screenshot-2-in-stock.png`, `store/screenshot-3-alerts.png`
- **Small promo tile (440×280):** `store/promo-small.png`
- **Marquee promo tile (1400×560, optional):** `store/promo-marquee.png`
- **Homepage URL:** https://github.com/induction-axiom/pickup-alert-for-iphone
- **Support URL:** https://github.com/induction-axiom/pickup-alert-for-iphone/issues

## Privacy tab

**Single purpose:**

```
Watches Apple Store in-store pickup availability for the iPhone model the user picks on Apple's buy page, and alerts the user when a nearby store has it.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `notifications` | Shows the in-stock alert (and optional problem warnings) as a Chrome notification. |
| `cookies` | Only when the user clicks "Clear Apple cookies and retry" in the panel after Apple keeps blocking checks: removes the browser's apple.com cookies, the same as clearing apple.com site data in Chrome settings, then reloads the page. |
| `storage` | Remembers the user's last postal code and phone push topic, and keeps each tab's watch state while the tab is open. |
| `alarms` | A 30-second watchdog that restarts checking if Chrome suspended the extension's service worker. |
| `tts` | Speaks the in-stock alert out loud with the computer's built-in voice, if the user turned on Voice. |
| `power` | Keeps the computer from sleeping only while a watch is running, so checks don't stop overnight. Released when watching stops. |
| Host `https://*.apple.com/*` | Runs the panel on Apple's iPhone buy pages and requests Apple's store-pickup availability for the chosen model from the user's own tab. The wildcard covers apple.com cookies set for the whole domain, which the user can choose to clear. |
| Host `https://ntfy.sh/*` | Sends the in-stock alert to the user's phone through ntfy, only if the user turned on Phone. |

**Remote code:** No, I am not using remote code.

**Data usage:** check **Location** (the postal code is sent to Apple to look up nearby stores). Leave everything else unchecked. Tick all three certifications (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://github.com/induction-axiom/pickup-alert-for-iphone/blob/main/PRIVACY.md

## Distribution tab

- **Payments:** Free
- **Visibility:** Public, or Unlisted to try it with a link first
- **Regions:** All regions

## Rebuilding the images

Screenshots are the README's light-mode screenshots scaled to 1280×800; `store/assets.html` is the source for the promo tiles and the alerts screenshot.
