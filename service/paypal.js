// runtime-safe fetch (use global.fetch on Node 18+ else node-fetch)
const fetch = (typeof global !== 'undefined' && typeof global.fetch === 'function')
  ? global.fetch
  : require('node-fetch');

require('dotenv').config();

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_API = process.env.PAYPAL_API || (process.env.PAYPAL_ENVIRONMENT === 'SANDBOX'
  ? 'https://api.sandbox.paypal.com' : 'https://api.paypal.com');

async function getAccessToken() {
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(PAYPAL_CLIENT + ':' + PAYPAL_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('PayPal token fetch failed: ' + text);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Create a PayPal order (intent CAPTURE)
 * amount: string or number (e.g. "9.78")
 * currency: optional (default SGD)
 * items: optional array of { name, unit_amount, quantity } - unit_amount numeric/string
 * reference: optional reference id
 */
async function createOrder(amount, currency = 'SGD', items = [], reference = '') {
  if (!amount) throw new Error('Missing amount for PayPal order creation');

  const token = await getAccessToken();

  /**
   * IMPORTANT (fix for PayPal "infinite login/spinner")
   * ---------------------------------------------------
   * In the JS SDK "Smart Buttons" flow, you should keep the order payload SIMPLE.
   * If you send `items` + `breakdown`, PayPal requires the totals to match perfectly.
   * Any mismatch (shipping/discount/tax/rounding) can cause the hosted login/checkout
   * to hang or loop silently.
   *
   * So here we send ONLY the final amount.
   */
  const purchase_unit = {
    amount: {
      currency_code: currency,
      value: String(amount)
    }
  };

  if (reference) purchase_unit.reference_id = String(reference);

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [purchase_unit]
  };

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error('PayPal create order failed');
    err.raw = data;
    throw err;
  }

  return data;
}

/**
 * Capture an order by PayPal order id
 */
async function captureOrder(orderId) {
  if (!orderId) throw new Error('Missing orderId for capture');

  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error('PayPal capture failed');
    err.raw = data;
    throw err;
  }

  return data;
}

module.exports = { createOrder, captureOrder };
