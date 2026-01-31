// models/VoucherModel.js
const db = require('../db');

function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function getByCode(code, cb) {
  const normalized = normalizeCode(code);
  if (!normalized) return cb(null, null);

  const sql = `
    SELECT id, code, discount_percent, min_spend, expires_at, is_used, created_at
    FROM vouchers
    WHERE code = ?
    LIMIT 1
  `;
  db.query(sql, [normalized], (err, rows) => {
    if (err) return cb(err);
    cb(null, rows && rows[0] ? rows[0] : null);
  });
}

function listAll(cb) {
  const sql = `
    SELECT id, code, discount_percent, min_spend, expires_at, is_used, created_at
    FROM vouchers
    ORDER BY created_at DESC, id DESC
  `;
  db.query(sql, (err, rows) => {
    if (err) return cb(err);
    cb(null, rows || []);
  });
}

function create(voucher, cb) {
  const code = normalizeCode(voucher.code);
  const discountPercent = Number(voucher.discount_percent || 0);
  const minSpend = Number(voucher.min_spend || 0);
  const expiresAt = voucher.expires_at || null;
  const isUsed = voucher.is_used ? 1 : 0;

  const sql = `
    INSERT INTO vouchers (code, discount_percent, min_spend, expires_at, is_used, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;
  db.query(
    sql,
    [code, discountPercent, minSpend, expiresAt, isUsed],
    (err, result) => {
      if (err) return cb(err);
      cb(null, { id: result.insertId });
    }
  );
}

function markUsedByCode(code, cb) {
  const normalized = normalizeCode(code);
  if (!normalized) return cb(null, { skipped: true });

  const sql = `
    UPDATE vouchers
    SET is_used = 1
    WHERE code = ? AND is_used = 0
  `;
  db.query(sql, [normalized], (err, result) => {
    if (err) return cb(err);
    cb(null, result);
  });
}

function markUsedForOrder(orderId, cb) {
  if (!orderId) return cb(null, { skipped: true });

  const sql = `SELECT voucherCode FROM \`order\` WHERE id = ? LIMIT 1`;
  db.query(sql, [orderId], (err, rows) => {
    if (err) return cb(err);
    const code = rows && rows[0] ? rows[0].voucherCode : null;
    if (!code) return cb(null, { skipped: true });
    return markUsedByCode(code, cb);
  });
}

module.exports = {
  normalizeCode,
  getByCode,
  listAll,
  create,
  markUsedByCode,
  markUsedForOrder
};
