// controllers/OrderController.js

const OrderModel = require('../models/Order');
const CartModel = require('../models/CartModel');   // ⬅ add this
const db = require('../db');

// =============================
// VIEW FINAL ORDER RECEIPT
// =============================
function viewOrder(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }

  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    req.flash('error', 'Invalid order ID.');
    return res.redirect('/shopping');
  }

  OrderModel.getOrderWithItems(orderId, (err, order) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading order details.');
      return res.redirect('/shopping');
    }

    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/shopping');
    }

    if (order.userid !== user.id && user.role !== 'admin') {
      req.flash('error', 'You are not allowed to view this order.');
      return res.redirect('/shopping');
    }

    res.render('orderDetail', {
      order,
      user: req.session.user,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
}

// =============================
// ORDER CONFIRMATION PAGE
// =============================
function showConfirmation(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }

  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    req.flash('error', 'Invalid order ID.');
    return res.redirect('/shopping');
  }

  OrderModel.getOrderWithItems(orderId, (err, order) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading order confirmation.');
      return res.redirect('/shopping');
    }

    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/shopping');
    }

    if (order.userid !== user.id && user.role !== 'admin') {
      req.flash('error', 'You are not allowed to view this order.');
      return res.redirect('/shopping');
    }

    res.render('orderConfirm', {
      order,
      user: req.session.user,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
}

// =============================
// CONFIRM ORDER (PENDING -> PAID)
// =============================
function confirmOrder(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }

  const orderId = parseInt(req.params.id, 10);

  const sql = `
    UPDATE \`order\`
    SET status = 'PAID', capturedOn = NOW()
    WHERE id = ? AND userid = ?
  `;

  db.query(sql, [orderId, user.id], (err, result) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to confirm order.');
      return res.redirect(`/orders/confirm/${orderId}`);
    }

    if (result.affectedRows === 0) {
      req.flash('error', 'Order not found or not authorized.');
      return res.redirect('/shopping');
    }

    // 🔎 Get product IDs from this order so we clear only those from the cart
    const sqlItems = `
      SELECT DISTINCT productID
      FROM order_items
      WHERE order_id = ?
    `;

    db.query(sqlItems, [orderId], (err2, rows) => {
      if (err2) {
        console.error(err2);
        // Order is already confirmed; cart just might not be perfectly synced
        req.flash('success', 'Order confirmed successfully (cart not updated).');
        return res.redirect(`/orders/${orderId}`);
      }

      const productIds = rows.map(r => r.productID);
      if (!productIds.length) {
        // No products (edge case), just go to receipt
        req.flash('success', 'Order confirmed successfully!');
        return res.redirect(`/orders/${orderId}`);
      }

      // ✅ Now clear only those items from the user's cart
      CartModel.clearSelectedItems(user.id, productIds, (err3) => {
        if (err3) {
          console.error(err3);
          req.flash(
            'success',
            'Order confirmed successfully, but some cart items may still remain.'
          );
          return res.redirect(`/orders/${orderId}`);
        }

        req.flash('success', 'Order confirmed successfully! Your cart has been updated.');
        return res.redirect(`/orders/${orderId}`);
      });
    });
  });
}

// =============================
// ORDER HISTORY
// =============================
function listOrders(req, res) {
  const user = req.session.user;

  OrderModel.getOrdersByUser(user.id, (err, orders) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading your order history.');
      return res.redirect('/shopping');
    }

    res.render('orderHistory', {
      user: req.session.user,
      orders,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
}

module.exports = {
  viewOrder,
  showConfirmation,
  confirmOrder,
  listOrders
};
