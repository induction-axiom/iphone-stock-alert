// Pure helpers shared by content.js (in Chrome) and test.js (in node).
(function (root) {
  // "/ca" for https://www.apple.com/ca/shop/..., "" for the US store.
  function regionPrefix(pathname) {
    const m = pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,4})?)\/shop\//);
    return m ? '/' + m[1] : '';
  }

  // Finds the part number for e.g. "iPhone Duo 256GB Star White" in the buy page's embedded JSON.
  function findPart(html, productName) {
    const name = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('"partNumber":"([A-Z0-9]+/A)"[^{}]*?(?:\\{[^{}]*\\}[^{}]*?)?"name":"' + name + '"');
    const m = html.match(re);
    return m ? m[1] : null;
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
    if (!content) throw new Error('响应格式不认识（没有 body.content）');
    const pm = content.pickupMessage || {};
    if (!pm.stores && pm.errorMessage) throw new Error('Apple 返回：' + pm.errorMessage);

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

  const api = { regionPrefix, findPart, availabilityUrl, parseAvailability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuoParse = api;
})(this);
