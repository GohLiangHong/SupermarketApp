// models/Order.js

const db = require('../db');

/**
 * Generate a readable unique reference number.
 * Example: REF-MB8F5NK0
 */
function generateReferenceId() {
  return 'REF-' + Date.now().toString(36).toUpperCase();
}

/**
 * Create an order in the `order` table.
 */
function createOrder(userId, totals, callback) {
  const referenceId = generateReferenceId();

  const sql = `
    INSERT INTO \`order\`
      (userid, referenceId, orderId, transactionalId, paymentMode, status, currency,
       subtotal, tax, shipping_fee, discount, total, createOn, capturedOn)
    VALUES
      (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
  `;

  const params = [
    userId,
    referenceId,
    totals.paymentMode || 'CASH',
    totals.status || 'PAID',
    totals.currency || 'SGD',
    totals.subtotal,
    totals.tax,
    totals.shipping_fee,
    totals.discount,
    totals.total
  ];

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error creating order:', err);
      return callback(err);
    }

    callback(null, {
      id: result.insertId,
      referenceId
    });
  });
}

/**
 * Insert items into `order_items`
 */
function addItems(orderId, items, callback) {
  if (!orderId) {
    return callback(new Error("Order ID missing in addItems()"));
  }
  if (!items || !items.length) {
    return callback(new Error("No items supplied to addItems()"));
  }

  const values = [];
  // 🔥 6 placeholders (for 6 columns) + NOW() for create_at
  const placeholders = items.map(() => '(?,?,?,?,?,?,NOW())').join(', ');

  items.forEach(item => {
    const productId = item.productId || item.product_id;
    const name = item.productName || item.product_name;
    const price = Number(item.price);
    const qty = Number(item.quantity);
    const lineSubtotal = (price * qty).toFixed(2);

    values.push(
      orderId,     // order_id
      productId,   // productID
      name,        // product_name
      price,       // unit_price
      qty,         // quantity
      lineSubtotal // subtotal
    );
  });

  const sql = `
    INSERT INTO order_items
      (order_id, productID, product_name, unit_price, quantity, subtotal, create_at)
    VALUES ${placeholders}
  `;

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ MySQL error inserting into order_items:', err);
      return callback(err);
    }
    callback(null, result);
  });
}

/**
 * Load full order details with items + customer details
 */
function getOrderWithItems(orderId, callback) {
  const sql = `
    SELECT
      o.*,
      u.username,
      u.email,
      u.address,
      u.contact,
      oi.productID,
      oi.product_name,
      oi.unit_price,
      oi.quantity,
      oi.subtotal
    FROM \`order\` o
    JOIN users u ON o.userid = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.id = ?
  `;

  db.query(sql, [orderId], (err, rows) => {
    if (err) return callback(err);
    if (!rows.length) return callback(null, null);

    const base = rows[0];

    const order = {
      id: base.id,
      userid: base.userid,
      referenceId: base.referenceId,
      orderId: base.orderId,
      transactionalId: base.transactionalId,
      paymentMode: base.paymentMode,
      status: base.status,
      currency: base.currency,
      subtotal: base.subtotal,
      tax: base.tax,
      shipping_fee: base.shipping_fee,
      discount: base.discount,
      total: base.total,
      createOn: base.createOn,
      capturedOn: base.capturedOn,
      customer: {
        username: base.username,
        email: base.email,
        address: base.address,
        contact: base.contact
      },
      items: rows
        .filter(row => row.productID !== null)
        .map(row => ({
          productID: row.productID,
          product_name: row.product_name,
          unit_price: row.unit_price,
          quantity: row.quantity,
          subtotal: row.subtotal
        }))
    };

    callback(null, order);
  });
}
function getOrdersByUser(userId, callback) {
  const sql = `
    SELECT
      id,
      referenceId,
      paymentMode,
      status,
      total,
      createOn
    FROM \`order\`
    WHERE userid = ?
    ORDER BY createOn DESC, id DESC
  `;

  db.query(sql, [userId], (err, rows) => {
    if (err) {
      console.error('Error loading orders for user', userId, err);
      return callback(err);
    }
    callback(null, rows);
  });
}
module.exports = {
  createOrder,
  addItems,
  getOrderWithItems,
  getOrdersByUser
};