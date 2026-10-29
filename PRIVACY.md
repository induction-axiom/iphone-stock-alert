# Privacy Policy: Pickup Alert for iPhone

_Last updated: October 29, 2026_

Pickup Alert for iPhone has no server and no account. The developer receives no data from it.

## What it reads

On Apple's iPhone buy pages (`https://www.apple.com/*shop/buy-iphone/*`), it reads the page to list the models on sale. It then asks Apple's own store-pickup endpoint whether the model you chose can be picked up near the postal code you entered. It makes that request from your browser tab, the same request Apple's page makes when you check stores by hand.

## What it stores

On your computer only:

- **Remembered in Chrome's extension storage:** your last postal code and your phone push topic.
- **Kept per tab until the tab closes:** the model, alert choices and panel position for that tab.

Nothing is synced or sent to the developer.

If Apple keeps blocking checks, the panel offers a **Clear Apple cookies and retry** button. Only when you click it, the extension deletes the apple.com cookies in your browser (as clearing apple.com site data in Chrome settings would, which signs you out of apple.com) and reloads the page. It never reads or sends their contents.

## What leaves your computer

- **To Apple (apple.com):** the model part number and your postal code, to check pickup stock. Apple's [privacy policy](https://www.apple.com/legal/privacy/) applies.
- **To ntfy.sh, only if you turn on "Phone":** the alert text (the model name and the stores that have it) is posted to the ntfy topic shown in the panel, so the ntfy app on your phone can show it. ntfy topics are public to anyone who knows the name; the extension makes a random one for you. ntfy's [privacy policy](https://ntfy.sh/docs/privacy/) applies.

Spoken alerts use your Mac's built-in voice through Chrome and stay on your computer.

## What it does not do

It does not track browsing, run on other websites, use analytics or ads, or sell or share data.

## Contact

Open an issue at https://github.com/induction-axiom/pickup-alert-for-iphone/issues.
