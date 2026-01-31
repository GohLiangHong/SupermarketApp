const OrderModel = require('../models/Order');
const CartModel = require('../models/CartModel');
const Wallet = require('../models/Wallet');
const db = require('../db');
const VoucherModel = require('../models/VoucherModel');

// GET /payments/ewallet?orderId=123
function showEwalletPaymentPage(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  const orderId = parseInt(req.query.orderId, 10);
  if (Number.isNaN(orderId)) {
    req.flash('error', 'Invalid order id.');
    return res.redirect('/shopping');
  }

  OrderModel.getOrderWithItems(orderId, async (err, order) => {
    if (err || !order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/shopping');
    }
    if (order.userid !== user.id && user.role !== 'admin') {
      req.flash('error', 'You are not allowed to view this order.');
      return res.redirect('/shopping');
    }
    const status = String(order.status || '').toUpperCase();
    if (status === 'PAID') {
      return res.redirect(`/orders/${orderId}`);
    }

    await Wallet.ensureWallet(user.id);
    const wallet = await Wallet.getWallet(user.id);

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.render('ewallet_payment', {
      user,
      order,
      wallet,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
}

// POST /payments/ewallet/pay
async function payWithEwallet(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  const orderId = parseInt(req.body.orderId, 10);
  if (!orderId) {
    req.flash('error', 'Invalid order id.');
    return res.redirect('/cart');
  }

  // Load order total from DB (source of truth)
  const order = await new Promise((resolve, reject) => {
    OrderModel.getOrderWithItems(orderId, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });

  if (!order || (order.userid !== user.id && user.role !== 'admin')) {
    req.flash('error', 'Order not found or not allowed.');
    return res.redirect('/cart');
  }

  const total = Number(order.total || 0);
  if (!Number.isFinite(total) || total <= 0) {
    req.flash('error', 'Invalid order total.');
    return res.redirect(`/orders/confirm/${orderId}`);
  }

  // Attempt wallet payment (atomic)
  const result = await Wallet.payOrderWithWallet(user.id, orderId, total);

  if (!result.success && result.insufficient) {
    req.flash('error', 'Insufficient balance. Please top up your wallet before paying.');
    return res.redirect('/cart');
  }

  await new Promise((resolve) => {
    VoucherModel.markUsedForOrder(orderId, (vErr) => {
      if (vErr) console.error('Failed to mark voucher used for order', orderId, vErr);
      resolve();
    });
  });

  // Clear purchased items from cart (same logic as PayPal/NETS)
  const rows = await new Promise((resolve, reject) => {
    db.query(
      `SELECT DISTINCT productID FROM order_items WHERE order_id = ?`,
      [orderId],
      (err, r) => (err ? reject(err) : resolve(r))
    );
  });

  const productIds = (rows || []).map(r => r.productID);
  if (productIds.length) {
    await new Promise((resolve) => {
      CartModel.clearSelectedItems(user.id, productIds, () => resolve());
    });
  }

  req.flash('success', 'E-Wallet payment successful!');
  return res.redirect(`/orders/${orderId}`);
}

module.exports = {
  showEwalletPaymentPage,
  payWithEwallet
};
