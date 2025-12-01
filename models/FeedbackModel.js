// models/FeedbackModel.js
const db = require('../db');

// Create / update feedback for a specific order by a specific user
function upsertOrderFeedback(userId, orderId, rating, comment, callback) {
  // Check if feedback already exists
  const checkSql = `
    SELECT id FROM feedback
    WHERE user_id = ? AND order_id = ?
    LIMIT 1
  `;
  db.query(checkSql, [userId, orderId], (err, rows) => {
    if (err) return callback(err);

    if (rows.length > 0) {
      // Update existing feedback
      const updateSql = `
        UPDATE feedback
        SET rating = ?, comment = ?, status = 'updated'
        WHERE id = ?
      `;
      db.query(updateSql, [rating, comment, rows[0].id], callback);
    } else {
      // Insert new feedback
      const insertSql = `
        INSERT INTO feedback (user_id, order_id, rating, comment)
        VALUES (?, ?, ?, ?)
      `;
      db.query(insertSql, [userId, orderId, rating, comment], callback);
    }
  });
}

// Create general feedback (no specific order)
function createGeneralFeedback(userId, rating, comment, callback) {
  const sql = `
    INSERT INTO feedback (user_id, order_id, rating, comment)
    VALUES (?, NULL, ?, ?)
  `;
  db.query(sql, [userId, rating, comment], callback);
}

// Get feedback for an order by the current user (to pre-fill form)
function getFeedbackForOrderAndUser(orderId, userId, callback) {
  const sql = `
    SELECT * FROM feedback
    WHERE order_id = ? AND user_id = ?
    LIMIT 1
  `;
  db.query(sql, [orderId, userId], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows[0] || null);
  });
}

// Get all feedback (join with users + order reference)
function getAllWithUser(callback) {
  const sql = `
    SELECT
      f.*,
      u.username,
      o.referenceId
    FROM feedback f
    JOIN users u ON f.user_id = u.id
    LEFT JOIN \`order\` o ON f.order_id = o.id
    ORDER BY f.created_at DESC
  `;
  db.query(sql, (err, rows) => {
    if (err) return callback(err);
    callback(null, rows);
  });
}

// Delete a feedback (admin only)
function deleteFeedback(id, callback) {
  const sql = 'DELETE FROM feedback WHERE id = ?';
  db.query(sql, [id], callback);
}

module.exports = {
  upsertOrderFeedback,
  createGeneralFeedback,
  getFeedbackForOrderAndUser,
  getAllWithUser,
  deleteFeedback,
};
