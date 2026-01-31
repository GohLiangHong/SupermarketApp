// controllers/VoucherController.js
const VoucherModel = require('../models/VoucherModel');
const CartModel = require('../models/CartModel');

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return false;
  return exp.getTime() < Date.now();
}

function validateVoucherForAmount(voucher, amount) {
  if (!voucher) {
    return { ok: false, message: 'Invalid voucher code.' };
  }
  if (Number(voucher.is_used) === 1) {
    return { ok: false, message: 'This voucher has already been used.' };
  }
  if (isExpired(voucher.expires_at)) {
    return { ok: false, message: 'This voucher has expired.' };
  }

  const discountPercent = Number(voucher.discount_percent || 0);
  if (!(discountPercent > 0)) {
    return { ok: false, message: 'This voucher has no discount configured.' };
  }

  const minSpend = Number(voucher.min_spend || 0);
  if (amount < minSpend) {
    return {
      ok: false,
      message: `Minimum spend of $${minSpend.toFixed(2)} is required to use this voucher.`
    };
  }

  return { ok: true, discountPercent, minSpend };
}

function parseSelectedIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(s => parseInt(String(s).trim(), 10))
    .filter(n => !Number.isNaN(n));
}

function computeSubtotalFromCart(cart, selectedIds) {
  const itemsToCheckout = cart.filter(item =>
    selectedIds.includes(Number(item.productId))
  );
  let subtotal = 0;
  itemsToCheckout.forEach(item => {
    const qty = Number(item.cart_quantity || item.quantity || 0);
    subtotal += Number(item.price || 0) * qty;
  });
  return Number(subtotal.toFixed(2));
}

// POST /cart/apply-voucher
function applyToCart(req, res) {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Please log in to use vouchers.'
    });
  }

  const codeRaw = req.body.code;
  const code = VoucherModel.normalizeCode(codeRaw);
  if (!code) {
    return res.status(400).json({
      success: false,
      message: 'Voucher code is required.'
    });
  }

  const selectedIds = parseSelectedIds(req.body.selectedProductIds);
  if (!selectedIds.length) {
    return res.status(400).json({
      success: false,
      message: 'Please select at least one item before applying a voucher.'
    });
  }

  CartModel.getCartByUser(userId, (err, cart) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: 'Failed to load cart items. Please try again.'
      });
    }

    if (!cart || !cart.length) {
      return res.status(400).json({
        success: false,
        message: 'Your cart is empty.'
      });
    }

    const subtotal = computeSubtotalFromCart(cart, selectedIds);
    if (!(subtotal > 0)) {
      return res.status(400).json({
        success: false,
        message: 'Select items in your cart before applying a voucher.'
      });
    }

    VoucherModel.getByCode(code, (vErr, voucher) => {
      if (vErr) {
        console.error('Voucher apply error:', vErr);
        return res.status(500).json({
          success: false,
          message: 'Failed to apply voucher. Please try again.'
        });
      }

      const validation = validateVoucherForAmount(voucher, subtotal);
      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          message: validation.message
        });
      }

      const discountValue = Number((subtotal * (validation.discountPercent / 100)).toFixed(2));
      const finalTotal = Number((subtotal - discountValue).toFixed(2));

      return res.json({
        success: true,
        code,
        subtotal,
        discountPercent: validation.discountPercent,
        minSpend: validation.minSpend,
        discountValue,
        finalTotal
      });
    });
  });
}

// GET /admin/vouchers
function adminList(req, res) {
  VoucherModel.listAll((err, vouchers) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to load vouchers.');
      return res.render('adminvoucher', {
        user: req.session.user,
        vouchers: [],
        error: req.flash('error'),
        success: req.flash('success')
      });
    }

    res.render('adminvoucher', {
      user: req.session.user,
      vouchers,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
}

// POST /admin/vouchers
function adminCreate(req, res) {
  const code = VoucherModel.normalizeCode(req.body.code);
  const discountPercent = Number(req.body.discount_percent || 0);
  const condition = String(req.body.condition || 'none');
  const isUsed = String(req.body.is_used || '') === 'on';

  let minSpend = 0;
  if (condition === 'min_20') minSpend = 20;
  if (condition === 'min_50') minSpend = 50;
  if (condition === 'min_100') minSpend = 100;

  if (!code) {
    req.flash('error', 'Voucher code is required.');
    return res.redirect('/admin/vouchers');
  }
  if (!(discountPercent > 0 && discountPercent <= 100)) {
    req.flash('error', 'Discount percent must be between 1 and 100.');
    return res.redirect('/admin/vouchers');
  }

  const expiryDateRaw = String(req.body.expires_at || '').trim();
  const expiresAt = expiryDateRaw ? `${expiryDateRaw} 23:59:59` : null;

  VoucherModel.create(
    {
      code,
      discount_percent: discountPercent,
      min_spend: minSpend,
      expires_at: expiresAt,
      is_used: isUsed
    },
    (err) => {
      if (err) {
        console.error(err);
        req.flash('error', 'Failed to create voucher. Code might already exist.');
        return res.redirect('/admin/vouchers');
      }

      req.flash('success', 'Voucher created successfully.');
      return res.redirect('/admin/vouchers');
    }
  );
}

module.exports = {
  applyToCart,
  adminList,
  adminCreate,
  validateVoucherForAmount
};
