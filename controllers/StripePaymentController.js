// controllers/StripePaymentController.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// IMPORTANT: use your existing OrderModel / CartModel methods.
// I’m keeping these as placeholders because your model functions aren’t shown here.
const OrderModel = require('../models/Order');
const CartModel = require('../models/CartModel');
const VoucherModel = require('../models/VoucherModel');

module.exports = {
  // 1) Show stripe page (your stripe.ejs)
  async showStripePage(req, res) {
    try {
      const userId = req.session.user?.id;
      const orderId = req.query.orderId;

      if (!orderId) return res.status(400).send('Missing orderId');
      if (!userId) return res.status(401).send('Unauthenticated');

      // ✅ Always load total from DB (not from client) to prevent tampering
      const order = await OrderModel.getOrderForUser(orderId, userId);
      if (!order) return res.status(404).send('Order not found');

      // Optional: block if already paid
      if (String(order.status).toLowerCase() === 'paid') {
        return res.redirect(`/orders/${orderId}`);
      }

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.render('stripe', {
        user: req.session.user,
        order,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Failed to load Stripe payment page');
    }
  },

  // 2) Create Stripe Checkout Session (server-side)
  async createCheckoutSession(req, res) {
    try {
      const userId = req.session.user?.id;
      const { orderId } = req.body;

      if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

      const order = await OrderModel.getOrderForUser(orderId, userId);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const total = Number(order.total || 0);
      if (!(total > 0)) return res.status(400).json({ error: 'Invalid order total' });

      // Stripe uses smallest currency unit (cents)
      const amountInCents = Math.round(total * 100);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'sgd',
              product_data: {
                name: `Order #${order.id}`,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}&orderId=${encodeURIComponent(orderId)}`,
        cancel_url: `${process.env.STRIPE_CANCEL_URL}?orderId=${encodeURIComponent(orderId)}`,
        metadata: {
          orderId: String(orderId),
          userId: String(userId),
        },
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create Stripe session' });
    }
  },

  // 3) Handle success redirect (basic approach)
  // NOTE: Best practice is webhook verification, but for school projects this is a common pattern.
  async stripeSuccess(req, res) {
    try {
      const userId = req.session.user?.id;
      const { session_id, orderId } = req.query;

      if (!userId) return res.status(401).send('Unauthenticated');
      if (!session_id || !orderId) return res.status(400).send('Missing session_id/orderId');

      // Verify session with Stripe
      const session = await stripe.checkout.sessions.retrieve(session_id);

      // Ensure it is paid
      if (session.payment_status !== 'paid') {
        return res.redirect(`/payments/stripe/cancel?orderId=${encodeURIComponent(orderId)}`);
      }

      // Ensure this order belongs to the user
      const order = await OrderModel.getOrderForUser(orderId, userId);
      if (!order) return res.status(404).send('Order not found');

      // ✅ Update order as paid (store stripe session/payment intent if you want)
      await OrderModel.markOrderPaid(orderId, {
        method: 'STRIPE',
        reference: session.payment_intent || session.id
      });

      await new Promise((resolve) => {
        VoucherModel.markUsedForOrder(orderId, (vErr) => {
          if (vErr) console.error('Failed to mark voucher used for order', orderId, vErr);
          resolve();
        });
      });

      // ✅ Clear purchased items from cart (match your PayPal behavior)
      await CartModel.clearPurchasedItemsForOrder(userId, orderId);

      return res.redirect(`/orders/${orderId}`);
    } catch (err) {
      console.error(err);
      res.status(500).send('Stripe success handling failed');
    }
  },

  async stripeCancel(req, res) {
    const { orderId } = req.query;
    // You can show a page or just redirect back to confirmation
    return res.redirect(`/orders/confirm/${encodeURIComponent(orderId)}`);
  }
};
