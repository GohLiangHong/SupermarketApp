// controllers/WalletController.js
const Wallet = require('../models/Wallet');
const paypalService = require('../services/paypal');
const netsService = require('../services/netsService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


function normalizeMoney(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Number(n).toFixed(2);
}

async function walletHome(req, res) {
  const user = req.session.user;
  await Wallet.ensureWallet(user.id);

  const wallet = await Wallet.getWallet(user.id);
  const txs = await Wallet.listTransactions(user.id, 10);

  res.render('wallet', {
    user,
    wallet,
    txs,
    paypalClientId: process.env.PAYPAL_CLIENT_ID,
    success: req.flash('success'),
    error: req.flash('error')
  });
}

async function topupStart(req, res) {
  const user = req.session.user;

  const chosen = (req.body.customAmount && String(req.body.customAmount).trim() !== '')
    ? req.body.customAmount
    : req.body.presetAmount;

  const amount = normalizeMoney(chosen);
  if (!amount) {
    req.flash('error', 'Please select a valid top up amount.');
    return res.redirect('/wallet');
  }

  const n = Number(amount);
  if (n < 1 || n > 1000) {
    req.flash('error', 'Top up amount must be between $1 and $1000.');
    return res.redirect('/wallet');
  }

  await Wallet.ensureWallet(user.id);
  const txId = await Wallet.createTopupTransaction(user.id, amount);

  return res.render('walletTopup', {
    user,
    amount,
    txId,
    paypalClientId: process.env.PAYPAL_CLIENT_ID,
    success: req.flash('success'),
    error: req.flash('error')
  });
}

/**
 * NETS: start wallet topup and render walletTopupNets.ejs with QR
 */
async function topupStartNets(req, res) {
  const user = req.session.user;

  const chosen = (req.body.customAmount && String(req.body.customAmount).trim() !== '')
    ? req.body.customAmount
    : req.body.presetAmount;

  const amount = normalizeMoney(chosen);
  if (!amount) {
    req.flash('error', 'Please select a valid top up amount.');
    return res.redirect('/wallet');
  }

  const n = Number(amount);
  if (n < 1 || n > 1000) {
    req.flash('error', 'Top up amount must be between $1 and $1000.');
    return res.redirect('/wallet');
  }

  await Wallet.ensureWallet(user.id);
  const txId = await Wallet.createTopupTransaction(user.id, amount);

  try {
    const netsResp = await netsService.requestQr(amount);
    const qrData = netsResp?.result?.data;

    // Same success condition style as your NetsPaymentController
    if (
      qrData &&
      qrData.response_code === '00' &&
      qrData.txn_status === 1 &&
      qrData.qr_code &&
      qrData.txn_retrieval_ref
    ) {
      // store mapping so /wallet/nets/success knows which tx to complete
      req.session.netsWalletTopups = req.session.netsWalletTopups || {};
      req.session.netsWalletTopups[qrData.txn_retrieval_ref] = {
        txId,
        userId: user.id
      };

      // record NETS QR created in DB
      await Wallet.markNetsQrCreated(txId, user.id, qrData.txn_retrieval_ref, netsResp);

      return res.render('walletTopupNets', {
        user,
        amount,
        txId,
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef: qrData.txn_retrieval_ref,
        timer: 300,
        success: req.flash('success'),
        error: req.flash('error')
      });
    }

    req.flash('error', 'Failed to generate NETS QR. Please try again.');
    return res.redirect('/wallet');
  } catch (e) {
    console.error('NETS walletTopup requestQr failed:', e?.response?.data || e.message);
    req.flash('error', 'NETS service error. Please try again.');
    return res.redirect('/wallet');
  }
}

/**
 * Stripe: start wallet topup and render walletTopupStripe.ejs
 */
async function topupStartStripe(req, res) {
  const user = req.session.user;

  const chosen = (req.body.customAmount && String(req.body.customAmount).trim() !== '')
    ? req.body.customAmount
    : req.body.presetAmount;

  const amount = normalizeMoney(chosen);
  if (!amount) {
    req.flash('error', 'Please select a valid top up amount.');
    return res.redirect('/wallet');
  }

  const n = Number(amount);
  if (n < 1 || n > 1000) {
    req.flash('error', 'Top up amount must be between $1 and $1000.');
    return res.redirect('/wallet');
  }

  await Wallet.ensureWallet(user.id);
  const txId = await Wallet.createTopupTransaction(user.id, amount);

  return res.render('walletTopupStripe', {
    user,
    amount,
    txId,
    success: req.flash('success'),
    error: req.flash('error')
  });
}

/**
 * Create PayPal order for wallet topup (server = source of truth)
 */
async function createWalletPaypalOrder(req, res) {
  try {
    const user = req.session.user;
    const txId = parseInt(req.body.txId, 10);
    if (!txId) return res.status(400).json({ error: 'Missing txId' });

    const tx = await Wallet.getTransactionById(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.user_id !== user.id) return res.status(403).json({ error: 'Not allowed' });
    if (tx.status === 'COMPLETED') return res.status(400).json({ error: 'Transaction already completed' });

    const amount = Number(tx.amount || 0).toFixed(2);
    if (amount === '0.00') return res.status(400).json({ error: 'Invalid amount' });

    const items = [{
      name: 'E-Wallet Top Up',
      unit_amount: amount,
      quantity: 1
    }];

    const reference = `WALLET-TOPUP-${user.id}-${txId}`;

    const data = await paypalService.createOrder(amount, 'SGD', items, reference);
    if (!data?.id) return res.status(500).json({ error: 'PayPal create order failed', raw: data });

    await Wallet.markPaypalOrderCreated(txId, data.id);
    return res.json({ id: data.id });
  } catch (err) {
    console.error('createWalletPaypalOrder error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}

async function captureWalletPaypalOrder(req, res) {
  try {
    const user = req.session.user;
    const { orderID, txId } = req.body;
    const txIdInt = parseInt(txId, 10);

    if (!orderID) return res.status(400).json({ error: 'Missing orderID' });
    if (!txIdInt) return res.status(400).json({ error: 'Missing txId' });

    const tx = await Wallet.getTransactionById(txIdInt);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.user_id !== user.id) return res.status(403).json({ error: 'Not allowed' });

    const capture = await paypalService.captureOrder(orderID);

    const completed = (capture && (capture.status === 'COMPLETED' ||
      (capture.purchase_units &&
        capture.purchase_units[0] &&
        capture.purchase_units[0].payments &&
        capture.purchase_units[0].payments.captures &&
        capture.purchase_units[0].payments.captures[0] &&
        capture.purchase_units[0].payments.captures[0].status === 'COMPLETED')));

    if (!completed) {
      await Wallet.markFailed(txIdInt, user.id, capture);
      return res.status(400).json({ error: 'Payment not completed', raw: capture });
    }

    let captureId = '';
    try {
      captureId =
        (capture.purchase_units?.[0]?.payments?.captures?.[0]?.id) ||
        capture.id ||
        '';
    } catch (e) {
      captureId = capture.id || '';
    }

    await Wallet.completeTopup(txIdInt, user.id, captureId, capture);
    req.flash('success', 'Top up successful!');
    return res.json({ success: true, status: 'COMPLETED' });
  } catch (err) {
    console.error('captureWalletPaypalOrder error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}

/**
 * Stripe: create checkout session for wallet topup
 */
async function createWalletStripeCheckoutSession(req, res) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe secret key is missing in .env' });
    }

    const user = req.session.user;
    const txId = parseInt(req.body.txId, 10);
    if (!txId) return res.status(400).json({ error: 'Missing txId' });

    const tx = await Wallet.getTransactionById(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.user_id !== user.id) return res.status(403).json({ error: 'Not allowed' });
    if (tx.status === 'COMPLETED') return res.status(400).json({ error: 'Transaction already completed' });

    const amount = Number(tx.amount || 0);
    if (!(amount > 0)) return res.status(400).json({ error: 'Invalid amount' });

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const amountInCents = Math.round(amount * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            product_data: {
              name: 'E-Wallet Top Up'
            },
            unit_amount: amountInCents
          },
          quantity: 1
        }
      ],
      success_url: `${baseUrl}/wallet/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/wallet/stripe/cancel?txId=${encodeURIComponent(txId)}`,
      metadata: {
        txId: String(txId),
        userId: String(user.id)
      }
    });

    await Wallet.markStripeSessionCreated(txId, user.id, session.id, { sessionId: session.id });
    return res.json({ url: session.url });
  } catch (err) {
    console.error('createWalletStripeCheckoutSession error', err);
    return res.status(500).json({ error: err?.message || 'Failed to create Stripe session' });
  }
}

/**
 * Stripe: success redirect for wallet topup
 */
async function walletStripeSuccess(req, res) {
  try {
    const user = req.session.user;
    const { session_id } = req.query;

    if (!user) return res.redirect('/login');
    if (!session_id) {
      req.flash('error', 'Missing Stripe session.');
      return res.redirect('/wallet');
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      req.flash('error', 'Stripe payment not completed.');
      return res.redirect('/wallet');
    }

    const txId = parseInt(session.metadata?.txId, 10);
    const metaUserId = String(session.metadata?.userId || '');
    if (!txId || metaUserId !== String(user.id)) {
      req.flash('error', 'Invalid Stripe session metadata.');
      return res.redirect('/wallet');
    }

    await Wallet.completeTopup(txId, user.id, session.payment_intent || session.id, session);
    req.flash('success', 'Top up successful!');
    return res.redirect('/wallet');
  } catch (err) {
    console.error('walletStripeSuccess error', err);
    req.flash('error', 'Stripe top up failed.');
    return res.redirect('/wallet');
  }
}

async function walletStripeCancel(req, res) {
  req.flash('error', 'Stripe top up cancelled.');
  return res.redirect('/wallet');
}

/**
 * NETS wallet success/fail callbacks used by walletTopupNets.ejs
 */
async function netsWalletSuccess(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  const txn = String(req.query.txn || '');
  if (!txn) {
    req.flash('error', 'Missing NETS transaction reference.');
    return res.redirect('/wallet');
  }

  const mapping = req.session.netsWalletTopups?.[txn];
  if (!mapping || mapping.userId !== user.id) {
    req.flash('error', 'Invalid or expired NETS session.');
    return res.redirect('/wallet');
  }

  try {
    await Wallet.completeTopupNets(mapping.txId, user.id, txn, { txn });
    delete req.session.netsWalletTopups[txn];
    req.flash('success', 'Top up successful!');
    return res.redirect('/wallet');
  } catch (e) {
    console.error('netsWalletSuccess error:', e);
    req.flash('error', 'Failed to finalize NETS top up.');
    return res.redirect('/wallet');
  }
}

async function netsWalletFail(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  const txn = String(req.query.txn || '');
  // best-effort mark failed if we can map it
  const mapping = req.session.netsWalletTopups?.[txn];
  if (mapping && mapping.userId === user.id) {
    try {
      await Wallet.markFailed(mapping.txId, user.id, { txn, fail: true });
      delete req.session.netsWalletTopups[txn];
    } catch (e) {
      console.error('netsWalletFail markFailed error:', e);
    }
  }

  req.flash('error', 'NETS top up failed or timed out. Please try again.');
  return res.redirect('/wallet');
}

async function getBalance(req, res) {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: 'not_logged_in' });

  try {
    await Wallet.ensureWallet(user.id);
    const wallet = await Wallet.getWallet(user.id);
    return res.json({ balance: Number(wallet?.balance || 0) });
  } catch (e) {
    console.error('getBalance error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

module.exports = {
  walletHome,
  topupStart,
  topupStartNets,
  topupStartStripe,
  createWalletPaypalOrder,
  captureWalletPaypalOrder,
  createWalletStripeCheckoutSession,
  walletStripeSuccess,
  walletStripeCancel,
  netsWalletSuccess,
  netsWalletFail,
  getBalance
};
