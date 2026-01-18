// controllers/WalletController.js
const Wallet = require('../models/Wallet');
const paypalService = require('../services/paypal');
const netsService = require('../services/netsService');


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

module.exports = {
  walletHome,
  topupStart,
  topupStartNets,
  createWalletPaypalOrder,
  captureWalletPaypalOrder,
  netsWalletSuccess,
  netsWalletFail
};
