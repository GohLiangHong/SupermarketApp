const db = require('../db');

function ensureWallet(userId) {
  const sql = `
    INSERT INTO wallets (user_id, balance)
    VALUES (?, 0.00)
    ON DUPLICATE KEY UPDATE user_id = user_id
  `;
  return new Promise((resolve, reject) => {
    db.query(sql, [userId], (err, r) => (err ? reject(err) : resolve(r)));
  });
}

function getWallet(userId) {
  const sql = `SELECT user_id, balance, updated_at FROM wallets WHERE user_id = ?`;
  return new Promise((resolve, reject) => {
    db.query(sql, [userId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows && rows[0] ? rows[0] : null);
    });
  });
}

function listTransactions(userId, limit = 10) {
  const sql = `
    SELECT id, type, amount, status,
           paypal_order_id, paypal_capture_id,
           nets_txn_ref,
           created_at
    FROM wallet_transactions
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `;
  return new Promise((resolve, reject) => {
    db.query(sql, [userId, Number(limit)], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function createTopupTransaction(userId, amount) {
  const sql = `
    INSERT INTO wallet_transactions (user_id, type, amount, status)
    VALUES (?, 'TOPUP', ?, 'CREATED')
  `;
  return new Promise((resolve, reject) => {
    db.query(sql, [userId, amount], (err, r) => {
      if (err) return reject(err);
      resolve(r.insertId);
    });
  });
}

function getTransactionById(txId) {
  const sql = `SELECT * FROM wallet_transactions WHERE id = ?`;
  return new Promise((resolve, reject) => {
    db.query(sql, [txId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows && rows[0] ? rows[0] : null);
    });
  });
}

function markPaypalOrderCreated(txId, paypalOrderId) {
  const sql = `
    UPDATE wallet_transactions
    SET status = 'PAYPAL_ORDER_CREATED', paypal_order_id = ?
    WHERE id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(sql, [paypalOrderId, txId], (err, r) => (err ? reject(err) : resolve(r)));
  });
}

function markNetsQrCreated(txId, userId, netsTxnRef, rawJsonObj) {
  const sql = `
    UPDATE wallet_transactions
    SET status = 'NETS_QR_CREATED', nets_txn_ref = ?, raw_json = ?
    WHERE id = ? AND user_id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(sql, [netsTxnRef, JSON.stringify(rawJsonObj || {}), txId, userId], (err, r) =>
      (err ? reject(err) : resolve(r))
    );
  });
}

function markStripeSessionCreated(txId, userId, stripeSessionId, rawJsonObj) {
  const sql = `
    UPDATE wallet_transactions
    SET raw_json = ?
    WHERE id = ? AND user_id = ?
  `;
  const payload = Object.assign({}, rawJsonObj || {}, { stripeSessionId });
  return new Promise((resolve, reject) => {
    db.query(sql, [JSON.stringify(payload), txId, userId], (err, r) => (err ? reject(err) : resolve(r)));
  });
}

/**
 * Atomically:
 * 1) mark tx completed
 * 2) add balance
 */
function completeTopup(txId, userId, paypalCaptureId, rawJsonObj) {
  return new Promise((resolve, reject) => {
    db.beginTransaction(async (err) => {
      if (err) return reject(err);

      try {
        const txRows = await new Promise((res, rej) => {
          db.query(`SELECT * FROM wallet_transactions WHERE id = ? FOR UPDATE`, [txId], (e, rows) => {
            if (e) return rej(e);
            res(rows);
          });
        });

        const tx = txRows && txRows[0];
        if (!tx) throw new Error('Transaction not found');
        if (tx.user_id !== userId) throw new Error('Not allowed');
        if (tx.status === 'COMPLETED') {
          await new Promise((res, rej) => db.commit((e) => (e ? rej(e) : res())));
          return resolve({ alreadyCompleted: true });
        }

        const amount = Number(tx.amount || 0).toFixed(2);
        if (amount === '0.00') throw new Error('Invalid amount');

        await new Promise((res, rej) => {
          db.query(
            `INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)
             ON DUPLICATE KEY UPDATE user_id = user_id`,
            [userId],
            (e) => (e ? rej(e) : res())
          );
        });

        await new Promise((res, rej) => {
          db.query(`SELECT * FROM wallets WHERE user_id = ? FOR UPDATE`, [userId], (e) => (e ? rej(e) : res()));
        });

        await new Promise((res, rej) => {
          db.query(
            `UPDATE wallet_transactions
             SET status='COMPLETED', paypal_capture_id=?, raw_json=?
             WHERE id=? AND user_id=?`,
            [paypalCaptureId, JSON.stringify(rawJsonObj || {}), txId, userId],
            (e) => (e ? rej(e) : res())
          );
        });

        await new Promise((res, rej) => {
          db.query(
            `UPDATE wallets
             SET balance = balance + ?
             WHERE user_id = ?`,
            [amount, userId],
            (e) => (e ? rej(e) : res())
          );
        });

        db.commit((e) => (e ? reject(e) : resolve({ success: true })));
      } catch (e) {
        db.rollback(() => reject(e));
      }
    });
  });
}

/**
 * NETS version (same atomic behavior)
 */
function completeTopupNets(txId, userId, netsTxnRef, rawJsonObj) {
  return new Promise((resolve, reject) => {
    db.beginTransaction(async (err) => {
      if (err) return reject(err);

      try {
        const txRows = await new Promise((res, rej) => {
          db.query(`SELECT * FROM wallet_transactions WHERE id = ? FOR UPDATE`, [txId], (e, rows) => {
            if (e) return rej(e);
            res(rows);
          });
        });

        const tx = txRows && txRows[0];
        if (!tx) throw new Error('Transaction not found');
        if (tx.user_id !== userId) throw new Error('Not allowed');
        if (tx.status === 'COMPLETED') {
          await new Promise((res, rej) => db.commit((e) => (e ? rej(e) : res())));
          return resolve({ alreadyCompleted: true });
        }

        const amount = Number(tx.amount || 0).toFixed(2);
        if (amount === '0.00') throw new Error('Invalid amount');

        await new Promise((res, rej) => {
          db.query(
            `INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)
             ON DUPLICATE KEY UPDATE user_id = user_id`,
            [userId],
            (e) => (e ? rej(e) : res())
          );
        });

        await new Promise((res, rej) => {
          db.query(`SELECT * FROM wallets WHERE user_id = ? FOR UPDATE`, [userId], (e) => (e ? rej(e) : res()));
        });

        await new Promise((res, rej) => {
          db.query(
            `UPDATE wallet_transactions
             SET status='COMPLETED', nets_txn_ref=?, raw_json=?
             WHERE id=? AND user_id=?`,
            [netsTxnRef, JSON.stringify(rawJsonObj || {}), txId, userId],
            (e) => (e ? rej(e) : res())
          );
        });

        await new Promise((res, rej) => {
          db.query(
            `UPDATE wallets
             SET balance = balance + ?
             WHERE user_id = ?`,
            [amount, userId],
            (e) => (e ? rej(e) : res())
          );
        });

        db.commit((e) => (e ? reject(e) : resolve({ success: true })));
      } catch (e) {
        db.rollback(() => reject(e));
      }
    });
  });
}

function markFailed(txId, userId, rawJsonObj) {
  const sql = `
    UPDATE wallet_transactions
    SET status='FAILED', raw_json=?
    WHERE id=? AND user_id=?
  `;
  return new Promise((resolve, reject) => {
    db.query(sql, [JSON.stringify(rawJsonObj || {}), txId, userId], (err, r) => (err ? reject(err) : resolve(r)));
  });
}
/**
 * Pay an order using wallet balance (atomic).
 * - locks wallet row
 * - checks balance >= amount
 * - deducts wallet
 * - marks order PAID (EWALLET)
 */
function payOrderWithWallet(userId, orderId, amount) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return Promise.reject(new Error('Invalid amount'));
  }

  // New safer flow:
  // 1) Check balance first (no transaction) and return early if insufficient.
  // 2) If enough, start a DB transaction and re-lock the wallet row with FOR UPDATE,
  //    re-check balance, deduct, mark order, commit.
  return new Promise(async (resolve, reject) => {
    try {
      // ensure wallet exists
      await ensureWallet(userId);

      // read current balance (no lock)
      const walletRows = await new Promise((res, rej) => {
        db.query(
          `SELECT user_id, balance FROM wallets WHERE user_id = ?`,
          [userId],
          (e, rows) => (e ? rej(e) : res(rows))
        );
      });

      const wallet = walletRows && walletRows[0];
      const balance = Number(wallet?.balance || 0);

      if (balance + 1e-9 < amt) {
        return resolve({
          success: false,
          insufficient: true,
          balance: Number(balance).toFixed(2)
        });
      }

      // begin transaction and perform atomic deduct + order update
      db.beginTransaction((err) => {
        if (err) return reject(err);

        // lock the wallet row
        new Promise((res, rej) => {
          db.query(
            `SELECT user_id, balance FROM wallets WHERE user_id = ? FOR UPDATE`,
            [userId],
            (e, rows) => (e ? rej(e) : res(rows))
          );
        })
          .then((rows) => {
            const w = rows && rows[0];
            const lockedBalance = Number(w?.balance || 0);
            if (lockedBalance + 1e-9 < amt) {
              // still insufficient after locking
              return new Promise((res, rej) => {
                db.rollback(() => res({ insufficient: true, balance: Number(lockedBalance).toFixed(2) }));
              });
            }

            // deduct
            return new Promise((res, rej) => {
              db.query(
                `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
                [amt.toFixed(2), userId],
                (e) => (e ? rej(e) : res())
              );
            });
          })
          .then((maybe) => {
            if (maybe && maybe.insufficient) {
              return resolve({
                success: false,
                insufficient: true,
                balance: Number(lockedBalance).toFixed(2)
              });
            }

            // mark order paid (same style as PayPal/NETS)
            const txnId = `EWALLET-${Date.now()}-${orderId}`;

            return new Promise((res, rej) => {
              db.query(
                `UPDATE \`order\`
                 SET paymentMode='EWALLET',
                     status='PAID',
                     transactionalId=?,
                     capturedOn=NOW()
                 WHERE id=? AND userid=?`,
                [txnId, orderId, userId],
                (e, r) => (e ? rej(e) : res(r))
              );
            });
          })
          .then(() => {
            db.commit((e) => {
              if (e) return reject(e);
              resolve({ success: true });
            });
          })
          .catch((e) => {
            db.rollback(() => reject(e));
          });
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  ensureWallet,
  getWallet,
  listTransactions,
  createTopupTransaction,
  getTransactionById,
  markPaypalOrderCreated,
  markNetsQrCreated,
  markStripeSessionCreated,
  completeTopup,
  completeTopupNets,
  markFailed,
  payOrderWithWallet // <-- add this
};

