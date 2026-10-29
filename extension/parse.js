// Pure helpers shared by content.js (in Chrome) and test.js (in node).
(function (root) {
  // "/ca" for https://www.apple.com/ca/shop/..., "" for the US store.
  function regionPrefix(pathname) {
    const m = pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,4})?)\/shop\//);
    return m ? '/' + m[1] : '';
  }

  // "iphone-18-pro" from /shop/buy-iphone/iphone-18-pro/..., or null off a buy page.
  function familySlug(pathname) {
    const m = pathname.match(/\/shop\/buy-iphone\/([a-z0-9-]+)/);
    return m ? m[1] : null;
  }

  // "iphone-18-pro" -> "iPhone 18 Pro"
  function familyName(slug) {
    return slug
      .split('-')
      .map((w) => (w === 'iphone' ? 'iPhone' : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
      .join(' ');
  }

  const capacityGb = (c) => parseInt(c, 10) * (/tb$/.test(c) ? 1024 : 1);

  // Every phone model in the buy page's embedded JSON, keyed on Apple's dimension values, which
  // are the same in every country and language: {part, capacity: "256gb", color: "starwhite",
  // screen: "6_9inch" or ""}.
  function listModels(html) {
    const seen = new Map();
    for (const chunk of html.split('{"partNumber":"').slice(1)) {
      const part = chunk.slice(0, chunk.indexOf('"'));
      if (!/^[A-Z0-9]+\/A$/.test(part) || seen.has(part)) continue;
      const get = (k) => {
        const m = chunk.match(new RegExp('"' + k + '":"([^"]*)"'));
        return m ? m[1] : '';
      };
      const capacity = get('dimensionCapacity');
      const color = get('dimensionColor');
      if (!capacity || !color) continue;
      seen.set(part, { part, capacity, color, screen: get('dimensionScreensize') });
    }
    return [...seen.values()].sort(
      (a, b) => a.screen.localeCompare(b.screen) || a.color.localeCompare(b.color) || capacityGb(a.capacity) - capacityGb(b.capacity)
    );
  }

  function availabilityUrl(prefix, part, postal) {
    const q = new URLSearchParams({
      fae: 'true',
      pl: 'true',
      'mts.0': 'regular',
      'mts.1': 'compact',
      'parts.0': part,
      searchNearby: 'true',
      location: postal,
    });
    if (prefix === '') {
      q.set('cppart', 'UNLOCKED/US');
      q.set('purchaseOption', 'fullPrice');
    }
    return prefix + '/shop/fulfillment-messages?' + q.toString();
  }

  // Turns Apple's fulfillment-messages JSON into a flat list of stores.
  function parseAvailability(data, part) {
    const content = data && data.body && data.body.content;
    if (!content) throw Object.assign(new Error('Unrecognized response (no body.content)'), { code: 'badShape' });
    const pm = content.pickupMessage || {};
    if (!pm.stores && pm.errorMessage) throw Object.assign(new Error(pm.errorMessage), { code: 'apple' });

    const stores = (pm.stores || []).map((s) => {
      const pa = (s.partsAvailability || {})[part] || {};
      return {
        id: s.storeNumber,
        name: s.storeName,
        distance: s.storeDistanceWithUnit || '',
        display: pa.pickupDisplay || 'unknown',
        available: pa.pickupDisplay === 'available',
        quote: pa.pickupSearchQuote || '',
      };
    });

    const reg = content.deliveryMessage && content.deliveryMessage[part] && content.deliveryMessage[part].regular;
    const delivery = reg && reg.deliveryOptionMessages ? reg.deliveryOptionMessages.map((o) => o.displayName).join(' / ') : '';

    return { stores, delivery };
  }

  const api = { regionPrefix, familySlug, familyName, listModels, availabilityUrl, parseAvailability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StockParse = api;
})(this);
