// controllers/NetsPaymentController.js
const db = require("../db");
const OrderModel = require("../models/Order");
const CartModel = require("../models/CartModel");
const netsService = require("../services/netsService");

// GET /payments/nets?orderId=123
function showNetsPaymentPage(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect("/login");

  const orderId = parseInt(req.query.orderId, 10);
  if (Number.isNaN(orderId)) {
    req.flash("error", "Invalid order ID.");
    return res.redirect("/shopping");
  }

  OrderModel.getOrderWithItems(orderId, async (err, order) => {
    if (err || !order) {
      req.flash("error", "Order not found.");
      return res.redirect("/shopping");
    }
    if (order.userid !== user.id && user.role !== "admin") {
      req.flash("error", "You are not allowed to pay for this order.");
      return res.redirect("/shopping");
    }

    const total = Number(order.total || 0).toFixed(2);

    try {
      const netsResp = await netsService.requestQr(total);
      const qrData = netsResp?.result?.data;

      // NETSDemo success condition
      if (
        qrData &&
        qrData.response_code === "00" &&
        qrData.txn_status === 1 &&
        qrData.qr_code &&
        qrData.txn_retrieval_ref
      ) {
        // store mapping so success can update order
        req.session.netsPayments = req.session.netsPayments || {};
        req.session.netsPayments[qrData.txn_retrieval_ref] = {
          orderId: order.id,
          userId: user.id,
        };

        return res.render("NetsPayment", {
          user,
          order,
          total,
          qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
          txnRetrievalRef: qrData.txn_retrieval_ref,
          timer: 300,
          error: req.flash("error"),
          success: req.flash("success"),
        });
      }

      // If not success condition, treat as fail like NETSDemo
      return res.redirect(`/payments/nets/fail?orderId=${encodeURIComponent(order.id)}`);
    } catch (e) {
      console.error("NETS QR request error:", e?.response?.data || e.message);
      return res.redirect(`/payments/nets/fail?orderId=${encodeURIComponent(order.id)}`);
    }
  });
}

// SSE endpoint: matches NETSDemo polling behavior closely
async function ssePaymentStatus(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;

  let pollCount = 0;
  const maxPolls = 60; // 5 minutes if polling every 5 seconds
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async () => {
    pollCount++;

    try {
      const response = await netsService.queryTxn(txnRetrievalRef, frontendTimeoutStatus);

      // send full response to frontend (NETSDemo does this)
      res.write(`data: ${JSON.stringify(response)}\n\n`);

      const resData = response?.result?.data;

      // success condition (NETSDemo)
      if (resData && resData.response_code == "00" && resData.txn_status === 1) {
        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
        clearInterval(interval);
        return res.end();
      } else if (
        frontendTimeoutStatus == 1 &&
        resData &&
        (resData.response_code !== "00" || resData.txn_status === 2)
      ) {
        // fail condition (NETSDemo)
        res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
        clearInterval(interval);
        return res.end();
      }
    } catch (err) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      return res.end();
    }

    // timeout (NETSDemo)
    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      res.write(`data: ${JSON.stringify({ fail: true, error: "Timeout" })}\n\n`);
      return res.end();
    }
  }, 5000);

  req.on("close", () => clearInterval(interval));
}

function netsSuccess(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect("/login");

  const txn = String(req.query.txn || "");
  if (!txn) {
    req.flash("error", "Missing NETS transaction reference.");
    return res.redirect("/shopping");
  }

  const mapping = req.session.netsPayments?.[txn];
  if (!mapping || mapping.userId !== user.id) {
    req.flash("error", "Invalid or expired NETS session.");
    return res.redirect("/shopping");
  }

  const orderId = mapping.orderId;

  const sql = `
    UPDATE \`order\`
    SET paymentMode = 'NETS',
        status = 'PAID',
        transactionalId = ?,
        capturedOn = NOW()
    WHERE id = ? AND userid = ?
  `;

  db.query(sql, [txn, orderId, user.id], (err, result) => {
    if (err || result.affectedRows === 0) {
      console.error("NETS success update error:", err);
      req.flash("error", "Failed to finalize NETS payment.");
      return res.redirect(`/orders/confirm/${orderId}`);
    }

    const sqlItems = `
      SELECT DISTINCT productID
      FROM order_items
      WHERE order_id = ?
    `;

    db.query(sqlItems, [orderId], (err2, rows) => {
      delete req.session.netsPayments[txn];

      if (err2) {
        console.error(err2);
        req.flash("success", "NETS payment successful (cart not updated).");
        return res.redirect(`/orders/${orderId}`);
      }

      const productIds = rows.map((r) => r.productID);
      if (!productIds.length) {
        req.flash("success", "NETS payment successful!");
        return res.redirect(`/orders/${orderId}`);
      }

      CartModel.clearSelectedItems(user.id, productIds, (err3) => {
        if (err3) {
          console.error(err3);
          req.flash("success", "NETS payment successful, but some cart items may remain.");
          return res.redirect(`/orders/${orderId}`);
        }

        req.flash("success", "NETS payment successful! Your cart has been updated.");
        return res.redirect(`/orders/${orderId}`);
      });
    });
  });
}

function netsFail(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect("/login");

  const orderId = req.query.orderId;
  req.flash("error", "NETS payment failed or timed out. Please try again.");

  if (orderId) return res.redirect(`/orders/confirm/${orderId}`);
  return res.redirect("/shopping");
}

module.exports = {
  showNetsPaymentPage,
  ssePaymentStatus,
  netsSuccess,
  netsFail,
};
