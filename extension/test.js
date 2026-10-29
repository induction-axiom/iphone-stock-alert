// node extension/test.js [path/to/saved-buy-page.html]
const assert = require('assert');
const fs = require('fs');
const { regionPrefix, familySlug, familyName, listModels, colorFromSeo, availabilityUrl, parseAvailability } = require('./parse.js');

assert.strictEqual(regionPrefix('/shop/buy-iphone/iphone-duo'), '');
assert.strictEqual(regionPrefix('/ca/shop/buy-iphone/iphone-duo'), '/ca');
assert.strictEqual(regionPrefix('/ca-fr/shop/buy-iphone/iphone-duo'), '/ca-fr');

assert.strictEqual(familySlug('/ca/shop/buy-iphone/iphone-18-pro/6.3-inch-display-256gb-black'), 'iphone-18-pro');
assert.strictEqual(familySlug('/shop/bag'), null);
assert.strictEqual(familyName('iphone-18-pro'), 'iPhone 18 Pro');
assert.strictEqual(familyName('iphone-duo'), 'iPhone Duo');

const html =
  '{"partNumber":"MK1G4LL/A","footNotes":{"a":"b"},"dimensionCapacity":"512gb","dimensionColor":"starwhite"},' +
  '{"partNumber":"MK1E4LL/A","seoUrlToken":"7.6-inch-display-256gb-star-white-att","dimensionCapacity":"256gb","carrierModel":"ATT","dimensionColor":"starwhite"},' +
  '{"partNumber":"MK1E4LL/A","dimensionCapacity":"256gb","dimensionColor":"starwhite"},' +
  '{"partNumber":"SHPG3LL/A","name":"AppleCare"}';
const models = listModels(html);
assert.deepStrictEqual(models.map((m) => m.part), ['MK1E4LL/A', 'MK1G4LL/A']); // deduped, sorted by size, no AppleCare
assert.strictEqual(colorFromSeo(models[0]), 'Star White');
assert.strictEqual(colorFromSeo(models[1]), null);

// node extension/test.js page1.html page2.html ... prints the models each saved buy page offers
for (const file of process.argv.slice(2)) {
  const found = listModels(fs.readFileSync(file, 'utf8'));
  console.log(file.split('/').pop(), found.length, 'models:', found.slice(0, 4).map((m) => `${m.part} ${m.screen} ${m.capacity} ${m.color}`).join(' | '));
}

const us = availabilityUrl('', 'MK1E4LL/A', '95014');
assert.ok(us.startsWith('/shop/fulfillment-messages?'));
assert.ok(us.includes('parts.0=MK1E4LL%2FA') && us.includes('location=95014') && us.includes('cppart=UNLOCKED%2FUS'));
assert.ok(!availabilityUrl('/ca', 'X/A', 'M5V 3L9').includes('cppart'));

// Shape of Apple's fulfillment-messages response as used by the store page in past launches.
const sample = {
  head: { status: '200', data: {} },
  body: {
    content: {
      pickupMessage: {
        pickupLocation: 'Cupertino, CA 95014',
        stores: [
          {
            storeNumber: 'R014', storeName: 'Valley Fair', city: 'Santa Clara', storeDistanceWithUnit: '6.1 mi',
            partsAvailability: { 'MK1E4LL/A': { pickupDisplay: 'unavailable', pickupSearchQuote: 'Unavailable for Pickup', storePickEligible: true } },
          },
          {
            storeNumber: 'R033', storeName: 'Stanford', city: 'Palo Alto', storeDistanceWithUnit: '9.0 mi',
            partsAvailability: { 'MK1E4LL/A': { pickupDisplay: 'available', pickupSearchQuote: 'Available Today', storePickEligible: true } },
          },
          { storeNumber: 'R999', storeName: 'No Data' },
        ],
      },
      deliveryMessage: { 'MK1E4LL/A': { regular: { deliveryOptionMessages: [{ displayName: 'Delivers Nov 18 – Nov 25' }] } } },
    },
  },
};
const r = parseAvailability(sample, 'MK1E4LL/A');
assert.strictEqual(r.location, 'Cupertino, CA 95014');
assert.deepStrictEqual(r.stores.map((s) => s.available), [false, true, false]);
assert.strictEqual(r.stores[1].quote, 'Available Today');
assert.strictEqual(r.delivery, 'Delivers Nov 18 – Nov 25');
assert.throws(() => parseAvailability({ foo: 1 }, 'X'));

console.log('all parse tests passed');
