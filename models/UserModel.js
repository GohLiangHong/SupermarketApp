// models/UserModel.js
const db = require('../db');

module.exports = {
  findByEmail(email, cb) {
    db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email], (err, rows) => {
      if (err) return cb(err);
      cb(null, rows[0] || null);
    });
  },

  create({ username, email, passwordSha1, address, contact, role = 'user' }, cb) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [username, email, passwordSha1, address, contact, role], (err, result) => {
      if (err) return cb(err);
      cb(null, { id: result.insertId });
    });
  }
};
