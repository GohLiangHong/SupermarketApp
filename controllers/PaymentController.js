const OrderModel = require('../models/Order');
const CartModel = require('../models/CartModel');
const paypalService = require('../services/paypal');
const db = require('../db');

async function showPaymentPage(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }

  const orderId = parseInt(req.query.orderId, 10);
  if (Number.isNaN(orderId)) {
    req.flash('error', 'Invalid order id.');
    return res.redirect('/shopping');
  }

  OrderModel.getOrderWithItems(orderId, (err, order) => {
    if (err || !order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/shopping');
    }
    if (order.userid !== user.id && user.role !== 'admin') {
      req.flash('error', 'You are not allowed to view this order.');
      return res.redirect('/shopping');
    }

    // render payment page
    res.render('payment', {
      order,
      user: req.session.user,
      error: req.flash('error'),
      success: req.flash('success'),
      paypalClientId: process.env.PAYPAL_CLIENT_ID
    });
  });
}

async function createOrderApi(req, res) {
  try {
    const orderId = parseInt(req.body.orderId || req.body.order_id, 10);
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    // 1) get order total from DB (source of truth)
    const order = await new Promise((resolve, reject) => {
      OrderModel.getOrderWithItems(orderId, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const dbAmount = Number(order.total || 0).toFixed(2);
    if (dbAmount === '0.00') return res.status(400).json({ error: 'Invalid order total' });

    // 2) take client amount if provided, but verify it
    const clientAmount = String(req.body.amount || '').trim();
    const finalAmount = clientAmount ? Number(clientAmount).toFixed(2) : dbAmount;

    if (finalAmount !== dbAmount) {
      // you can either reject OR overwrite with dbAmount
      // reject:
      // return res.status(400).json({ error: 'Amount mismatch' });

      // overwrite:
      console.warn('Amount mismatch, using DB amount instead.', { clientAmount, dbAmount });
    }

    const amountToUse = dbAmount; // safest

    const serverItems = (order.items || []).map(it => ({
      name: it.product_name,
      unit_amount: Number(it.unit_price).toFixed(2),
      quantity: Number(it.quantity)
    }));

    const data = await paypalService.createOrder(
      amountToUse,
      order.currency || 'SGD',
      serverItems,
      order.referenceId || `ORDER-${orderId}`
    );

    if (!data?.id) return res.status(500).json({ error: 'PayPal create order failed', raw: data });
    return res.json({ id: data.id });

  } catch (err) {
    console.error('createOrderApi error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}


async function captureOrderApi(req, res) {
  try {
    const { orderID, orderId } = req.body; // orderID = PayPal order ID, orderId = local order id
    if (!orderID) return res.status(400).json({ error: 'Missing orderID' });
    if (!orderId) return res.status(400).json({ error: 'Missing local orderId' });

    const capture = await paypalService.captureOrder(orderID);
    // PayPal v2 returns captures under purchase_units -> payments.captures (or top-level status)
    const completed = (capture && (capture.status === 'COMPLETED' ||
      (capture.purchase_units && capture.purchase_units[0] &&
       capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures &&
       capture.purchase_units[0].payments.captures[0] &&
       capture.purchase_units[0].payments.captures[0].status === 'COMPLETED')));

    if (!completed) {
      return res.status(400).json({ error: 'Payment not completed', raw: capture });
    }

    // Extract capture id if possible
    let transactionalId = '';
    try {
      transactionalId = (capture.purchase_units && capture.purchase_units[0] &&
        capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures &&
        capture.purchase_units[0].payments.captures[0] &&
        capture.purchase_units[0].payments.captures[0].id) || capture.id || '';
    } catch (e) { transactionalId = capture.id || ''; }

    // Update order record
    const sql = `
      UPDATE \`order\`
      SET orderId = ?, transactionalId = ?, paymentMode = 'PAYPAL', status = 'PAID', capturedOn = NOW()
      WHERE id = ? AND userid = ?
    `;
    const user = req.session.user;
    await new Promise((resolve, reject) => {
      db.query(sql, [orderID, transactionalId, orderId, user.id], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    // Remove purchased items from cart (clear selected items)
    const sqlItems = `
      SELECT DISTINCT productID FROM order_items WHERE order_id = ?
    `;
    const rows = await new Promise((resolve, reject) => {
      db.query(sqlItems, [orderId], (err, r) => (err ? reject(err) : resolve(r)));
    });
    const productIds = (rows || []).map(r => r.productID);
    if (productIds.length) {
      await new Promise((resolve, reject) => {
        CartModel.clearSelectedItems(user.id, productIds, (err2) => (err2 ? reject(err2) : resolve()));
      });
    }

    return res.json({ success: true, status: 'COMPLETED' });
  } catch (err) {
    console.error('captureOrderApi error', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  showPaymentPage,
  createOrderApi,
  captureOrderApi
};