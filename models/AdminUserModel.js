// models/AdminUserModel.js
const db = require('../db'); // mysql2 connection (callbacks)

module.exports = {
  // Get all users
  all(cb) {
    const sql = 'SELECT id, username, email, address, contact, role FROM users ORDER BY id DESC';
    db.query(sql, [], (err, rows) => cb(err, rows));
  },

  // Find a user by ID
  findById(id, cb) {
    const sql = 'SELECT id, username, email, address, contact, role FROM users WHERE id = ? LIMIT 1';
    db.query(sql, [id], (err, rows) => cb(err, (rows && rows[0]) || null));
  },

  // ✅ Find a user by email (used to prevent duplicates)
  findByEmail(email, cb) {
    const sql = 'SELECT id FROM users WHERE email = ? LIMIT 1';
    db.query(sql, [email], (err, rows) => cb(err, (rows && rows[0]) || null));
  },

  // Create a new user (with hashed password)
  create({ username, email, password_hash, address, contact, role }, cb) {
    const sql = `
      INSERT INTO users (username, email, password, address, contact, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [username, email, password_hash, address, contact, role], (err, result) => {
      if (err) return cb(err);
      cb(null, { id: result.insertId });
    });
  },

  // Update user details (except password)
  update(id, { username, email, address, contact, role }, cb) {
    const sql = `
      UPDATE users
         SET username = ?, email = ?, address = ?, contact = ?, role = ?
       WHERE id = ?
    `;
    db.query(sql, [username, email, address, contact, role, id], (err) => cb(err));
  },

  // Update only the password
  updatePassword(id, password_hash, cb) {
    const sql = 'UPDATE users SET password = ? WHERE id = ?';
    db.query(sql, [password_hash, id], (err) => cb(err));
  },

  // Delete a user
  remove(id, cb) {
    const sql = 'DELETE FROM users WHERE id = ?';
    db.query(sql, [id], (err) => cb(err));
  },
};
