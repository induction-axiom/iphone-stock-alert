// node extension/test.js [path/to/saved-buy-page.html]
const assert = require('assert');
const fs = require('fs');
const { regionPrefix, findPart, availabilityUrl, parseAvailability } = require('./parse.js');

assert.strictEqual(regionPrefix('/shop/buy-iphone/iphone-duo'), '');
assert.strictEqual(regionPrefix('/ca/shop/buy-iphone/iphone-duo'), '/ca');
assert.strictEqual(regionPrefix('/ca-fr/shop/buy-iphone/iphone-duo'), '/ca-fr');

const html =
  '{"sku":"MK1G4","partNumber":"MK1G4LL/A","price":{"fullPrice":2199.00},"category":"iphone","name":"iPhone Duo 512GB Star White"},' +
  '{"sku":"MK1E4","partNumber":"MK1E4LL/A","price":{"fullPrice":1999.00},"category":"iphone","name":"iPhone Duo 256GB Star White"}';
assert.strictEqual(findPart(html, 'iPhone Duo 256GB Star White'), 'MK1E4LL/A');
assert.strictEqual(findPart(html, 'iPhone Duo 2TB Star White'), null);

if (process.argv[2]) {
  const page = fs.readFileSync(process.argv[2], 'utf8');
  console.log('real page 256GB Star White ->', findPart(page, 'iPhone Duo 256GB Star White'));
  console.log('real page 2TB Night Sky    ->', findPart(page, 'iPhone Duo 2TB Night Sky'));
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
