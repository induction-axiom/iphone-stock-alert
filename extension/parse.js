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
  // screen: "6_9inch" or "", seo: "...-256gb-star-white-..."}.
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
      seen.set(part, { part, capacity, color, screen: get('dimensionScreensize'), seo: get('seoUrlToken') });
    }
    return [...seen.values()].sort(
      (a, b) => a.screen.localeCompare(b.screen) || a.color.localeCompare(b.color) || capacityGb(a.capacity) - capacityGb(b.capacity)
    );
  }

  // "Star White" for color "starwhite", read from an seoUrlToken like "...-256gb-star-white-att".
  function colorFromSeo(model) {
    const m = model.seo.match(new RegExp(model.capacity + '-([a-z-]+?)(?:-(?:att|t-mobile|verizon|unlocked|sprint))?$'));
    if (!m || m[1].replace(/-/g, '') !== model.color) return null;
    return m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
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
      const mt = (pa.messageTypes && (pa.messageTypes.regular || pa.messageTypes.compact)) || {};
      const quote = pa.pickupSearchQuote || mt.storePickupQuote || '';
      return {
        id: s.storeNumber || s.storeName,
        name: s.storeName || s.storeNumber || '?',
        city: s.city || '',
        distance: s.storeDistanceWithUnit || '',
        display: pa.pickupDisplay || 'unknown',
        available: pa.pickupDisplay === 'available' || (pa.storePickEligible === true && /^available/i.test(quote)),
        quote: quote,
      };
    });

    const dm = content.deliveryMessage && content.deliveryMessage[part];
    const reg = dm && (dm.regular || dm.compact);
    let delivery = '';
    if (reg && reg.deliveryOptionMessages) {
      delivery = reg.deliveryOptionMessages.map((o) => o.displayName).filter(Boolean).join(' / ');
    } else if (reg && reg.deliveryOptions) {
      delivery = reg.deliveryOptions.map((o) => o.date || o.displayName).filter(Boolean).join(' / ');
    }

    return { location: pm.pickupLocation || '', stores, delivery };
  }

  const api = { regionPrefix, familySlug, familyName, listModels, colorFromSeo, availabilityUrl, parseAvailability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StockParse = api;
})(this);
