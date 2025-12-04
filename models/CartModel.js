// models/CartModel.js
const db = require('../db');

// Get all cart items for a user (with product details + current stock)
function getCartByUser(userId, callback) {
  const sql = `
    SELECT 
      ci.cart_id,
      ci.product_id AS productId,
      ci.quantity AS cart_quantity,
      p.productName,
      p.price,
      p.image,
      p.quantity AS stock
    FROM cart_item ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = ?
    ORDER BY ci.create_at DESC, ci.cart_id DESC
  `;
  db.query(sql, [userId], (err, results) => {
    if (err) return callback(err);
    // convert numeric-like strings to numbers for convenience in views/controllers
    const mapped = results.map(r => ({
      ...r,
      // ensure both names exist: cart_quantity (DB alias) and quantity (common usage elsewhere)
      cart_quantity: Number(r.cart_quantity) || 0,
      quantity: Number(r.cart_quantity) || 0,
      price: Number(r.price) || 0,
      stock: Number(r.stock) || 0
    }));
    callback(null, mapped);
  });
}

// Add new item or increase quantity if already in cart
function addOrUpdateItem(userId, productId, quantity, callback) {
  const selectSql = `
    SELECT cart_id, quantity AS cart_quantity
    FROM cart_item
    WHERE user_id = ? AND product_id = ?
  `;
  db.query(selectSql, [userId, productId], (err, rows) => {
    if (err) return callback(err);

    const now = new Date();
    const qty = Number(quantity) || 0;

    if (rows.length > 0) {
      const existingQty = Number(rows[0].cart_quantity) || 0;
      const newQty = existingQty + qty;
      const updateSql = `
        UPDATE cart_item
        SET quantity = ?, updated_at = ?
        WHERE cart_id = ?
      `;
      return db.query(updateSql, [newQty, now, rows[0].cart_id], callback);
    }

    const insertSql = `
      INSERT INTO cart_item (user_id, product_id, quantity, create_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(insertSql, [userId, productId, qty, now, now], callback);
  });
}

// Update quantity for a specific item (by user + product)
function updateItem(userId, productId, quantity, callback) {
  const now = new Date();
  const qty = Number(quantity) || 0;
  const sql = `
    UPDATE cart_item
    SET quantity = ?, updated_at = ?
    WHERE user_id = ? AND product_id = ?
  `;
  db.query(sql, [qty, now, userId, productId], callback);
}

// Remove single item from cart (by user + product)
function removeItem(userId, productId, callback) {
  const sql = `
    DELETE FROM cart_item
    WHERE user_id = ? AND product_id = ?
  `;
  db.query(sql, [userId, productId], callback);
}

// Clear all items from cart for a user
function clearCart(userId, callback) {
  const sql = `
    DELETE FROM cart_item 
    WHERE user_id = ?
  `;
  db.query(sql, [userId], callback);
}

// Clear only selected items from cart for a user
function clearSelectedItems(userId, productIds, callback) {
  if (!productIds || !productIds.length) {
    return callback(null);
  }

  const placeholders = productIds.map(() => '?').join(', ');
  const sql = `
    DELETE FROM cart_item
    WHERE user_id = ?
      AND product_id IN (${placeholders})
  `;
  const params = [userId, ...productIds];
  db.query(sql, params, callback);
}

module.exports = {
  getCartByUser,
  addOrUpdateItem,
  updateItem,
  removeItem,
  clearCart,
  clearSelectedItems
};
