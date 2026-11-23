// Try first, then buy: Still Water is free to download; the demo room is always free; your own
// music and videos are free for 7 days, then a one-time unlock (US$9.99, Meta Horizon Store add-on
// "still_water_full", bought with Meta's own purchase window through the Digital Goods API).
//
// The free week counts from the first day a headset connected to its own hub. The hub remembers
// that day too (status.license.trialStart), so reinstalling the app doesn't start a new week.
// The PC's own preview (on the hub itself) is never limited.
import { store } from './api.js';

export const SKU = 'still_water_full';
const BILLING = 'https://quest.meta.com/billing';
const DAYS = 7;
const DAY = 86_400_000;

class License {
  constructor() {
    this.owned = !!store.get('owned', false);
    this.service = null;
    this.price = 'US$9.99';
    this.canBuy = false;
  }

  /** Ask the store what's owned and the local price. Quietly does nothing outside the store app. */
  async init() {
    try {
      if (!('getDigitalGoodsService' in window)) return;
      this.service = await window.getDigitalGoodsService(BILLING);
      this.canBuy = !!this.service;
      const [d] = await this.service.getDetails([SKU]).catch(() => []);
      if (d?.price) this.price = new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value));
      const owned = await this.service.listPurchases().catch(() => []);
      if (owned.some((p) => p.itemId === SKU)) this._setOwned();
    } catch { this.canBuy = false; }
  }

  _setOwned() { this.owned = true; store.set('owned', true); }

  /** Days of the free week left (fractional), or Infinity when bought or not limited. */
  daysLeft(hubLicense, { local = false } = {}) {
    if (this.owned || hubLicense?.unlimited || local) return Infinity;
    const now = Date.now();
    let start = store.get('trialStart', null);
    if (hubLicense?.trialStart) start = Math.min(start || now, hubLicense.trialStart);
    if (!start) start = now;
    store.set('trialStart', start);
    return DAYS - (now - start) / DAY;
  }

  /** Meta's purchase window. Resolves true when bought; false if closed; throws if not possible here. */
  async buy() {
    if (!this.canBuy) throw Object.assign(new Error('not-in-store'), { code: 'not-in-store' });
    const details = { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }; // the store sets the real price
    const methods = [{ supportedMethods: BILLING, data: { sku: SKU } }];
    let response;
    try { response = await new PaymentRequest(methods, details).show(); } catch (e) { if (e.name === 'AbortError') return false; throw e; }
    await response.complete('success'); // without this the browser can hold input until it times out
    this._setOwned();
    return true;
  }
}

export const license = new License();
