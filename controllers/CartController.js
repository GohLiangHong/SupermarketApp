// controllers/CartController.js
// controllers/CartController.js
const ProductModel = require('../models/ProductModel');
const CartModel = require('../models/CartModel');
const OrderModel = require('../models/Order');   // order header + items
const db = require('../db');                     // direct SQL for stock updates
const VoucherModel = require('../models/VoucherModel');

function isVoucherExpired(expiresAt) {
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
  if (isVoucherExpired(voucher.expires_at)) {
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

// POST /add-to-cart/:id
function addToCart(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }

  const userId = user.id;
  const productId = parseInt(req.params.id, 10);
  let quantity = parseInt(req.body.quantity || '1', 10);
  if (Number.isNaN(productId)) {
    req.flash('error', 'Invalid product.');
    return res.redirect('/shopping');
  }
  if (Number.isNaN(quantity) || quantity <= 0) {
    req.flash('error', 'Invalid quantity.');
    return res.redirect('/shopping');
  }

  // Get product stock
  ProductModel.getById(productId, (err, product) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error adding to cart.');
      return res.redirect('/shopping');
    }
    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/shopping');
    }

    const stock = Number(product.quantity) || 0;

    // If user tries to add more than total stock in one shot
    if (quantity > stock) {
      req.flash(
        'error',
        `Only ${stock} unit(s) available. You cannot add more than the stock quantity.`
      );
      return res.redirect('/shopping');
    }

    // Check how many of this product are already in the cart
    CartModel.getCartByUser(userId, (err2, items) => {
      if (err2) {
        console.error(err2);
        req.flash('error', 'Error checking your cart.');
        return res.redirect('/shopping');
      }

      const existingItem = Array.isArray(items)
        ? items.find(it => Number(it.productId) === Number(productId))
        : null;

      const existingQty = existingItem ? Number(existingItem.cart_quantity || existingItem.quantity || 0) : 0;
      const totalRequested = existingQty + quantity;

      // BLOCK if total in cart would exceed stock
      if (totalRequested > stock) {
        req.flash(
          'error',
          `You already have ${existingQty} in your cart. Only ${stock} unit(s) are in stock, so you cannot add more.`
        );
        return res.redirect('/shopping');
      }

      // Safe to add/update cart
      CartModel.addOrUpdateItem(userId, productId, quantity, (err3) => {
        if (err3) {
          console.error(err3);
          req.flash('error', 'Could not update cart.');
          return res.redirect('/shopping');
        }

        req.flash('success', 'Item added to cart.');
        return res.redirect('/cart');
      });
    });
  });
}

// GET /cart
function viewCart(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }
  const userId = user.id;

  CartModel.getCartByUser(userId, (err, cart) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading cart.');
      return res.redirect('/shopping');
    }

    res.render('cart', {
      user,
      cart,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
}

// POST /cart/update/:id
// POST /cart/update/:id
function updateItem(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }
  const userId = user.id;
  const productId = parseInt(req.params.id, 10);
  const quantity = parseInt(req.body.quantity, 10);

  if (Number.isNaN(productId)) {
    req.flash('error', 'Invalid item.');
    return res.redirect('/cart');
  }

  // If quantity invalid or <= 0, treat as remove (your original behaviour)
  if (Number.isNaN(quantity) || quantity <= 0) {
    return CartModel.removeItem(userId, productId, (err) => {
      if (err) {
        console.error(err);
        req.flash('error', 'Could not update cart item.');
      } else {
        req.flash('success', 'Item removed from cart.');
      }
      return res.redirect('/cart');
    });
  }

  // 🔍 Check stock before updating quantity
  ProductModel.getById(productId, (err, product) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error updating cart.');
      return res.redirect('/cart');
    }
    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/cart');
    }

    const stock = Number(product.quantity) || 0;

    if (quantity > stock) {
      req.flash(
        'error',
        `You cannot set quantity to ${quantity}. Only ${stock} unit(s) are in stock.`
      );
      return res.redirect('/cart');
    }

    // ✅ Safe to update quantity
    CartModel.updateItem(userId, productId, quantity, (err2) => {
      if (err2) {
        console.error(err2);
        req.flash('error', 'Could not update cart quantity.');
        return res.redirect('/cart');
      }

      req.flash('success', 'Cart updated.');
      return res.redirect('/cart');
    });
  });
}

// POST /cart/remove/:id
function removeItem(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }
  const userId = user.id;
  const productId = parseInt(req.params.id, 10);

  if (Number.isNaN(productId)) {
    req.flash('error', 'Invalid item.');
    return res.redirect('/cart');
  }

  CartModel.removeItem(userId, productId, (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Could not remove item.');
      return res.redirect('/cart');
    }

    req.flash('success', 'Item removed from cart.');
    return res.redirect('/cart');
  });
}

// POST /cart/checkout
// → only SELECTED checkbox items are checked out and removed
function checkout(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }
  const userId = user.id;

  const selectedIds = parseSelectedIds(req.body.selectedProductIds || '');

  if (!selectedIds.length) {
    req.flash('error', 'Please select at least one item to checkout.');
    return res.redirect('/cart');
  }

  // 1) Load full cart
  CartModel.getCartByUser(userId, (err, cart) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading cart for checkout.');
      return res.redirect('/cart');
    }

    if (!cart || !cart.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    // 2) Filter only selected items
    const itemsToCheckout = cart.filter(item =>
      selectedIds.includes(Number(item.productId))
    );

    if (!itemsToCheckout.length) {
      req.flash('error', 'Selected items were not found in cart.');
      return res.redirect('/cart');
    }

    // 3) Validate stock
    for (const item of itemsToCheckout) {
      const qty = Number(item.cart_quantity || item.quantity || 0);
      const stock = Number(item.stock || 0);
      if (qty > stock) {
        req.flash(
          'error',
          `Not enough stock for ${item.productName}. Available: ${stock}, in cart: ${qty}.`
        );
        return res.redirect('/cart');
      }
    }

    // 4) Compute totals
    let subtotal = 0;
    itemsToCheckout.forEach(item => {
      const qty = Number(item.cart_quantity || item.quantity || 0);
      subtotal += Number(item.price || 0) * qty;
    });
    subtotal = Number(subtotal.toFixed(2));

    const totals = {
      paymentMode: 'CASH',
      status: 'PENDING',
      currency: 'SGD',
      subtotal,
      tax: 0,
      shipping_fee: 0,
      discount: 0,
      total: subtotal,
      voucherCode: null
    };

    const voucherCodeRaw = req.body.voucherCode || req.body.voucher_code || '';
    const voucherCode = VoucherModel.normalizeCode(voucherCodeRaw);

    function proceedToCreateOrder(finalTotals) {
      // 5) Create order header
      OrderModel.createOrder(userId, finalTotals, (err2, orderData) => {
      if (err2) {
        console.error(err2);
        req.flash('error', 'Failed to create order.');
        return res.redirect('/cart');
      }

      const orderId = orderData.id;

      // 6) Insert order items
      OrderModel.addItems(orderId, itemsToCheckout, (err3) => {
        if (err3) {
          console.error(err3);
          req.flash('error', 'Order created but failed to save items.');
          return res.redirect('/cart');
        }
        // 7) Update product stock one by one
        const updateNext = (index) => {
          if (index >= itemsToCheckout.length) {
            // ✅ Do NOT clear cart here anymore; just go to confirmation page
            req.flash('success', 'Checkout successful! Please confirm your order.');
            return res.redirect(`/orders/confirm/${orderId}`);
          }

          const item = itemsToCheckout[index];
          const itemQty = Number(item.cart_quantity || item.quantity || 0);
          const newQty = Number(item.stock || 0) - itemQty;
          const sql = 'UPDATE products SET quantity = ? WHERE id = ?';

          db.query(
            sql,
            [newQty, item.productId],
            (err4) => {
              if (err4) {
                console.error(err4);
                req.flash(
                  'error',
                  'Order saved but failed to update product stock.'
                );
                return res.redirect('/cart');
              }

              updateNext(index + 1);
            }
          );
        };

        updateNext(0);

      });
    });
    }

    if (!voucherCode) {
      return proceedToCreateOrder(totals);
    }

    VoucherModel.getByCode(voucherCode, (vErr, voucher) => {
      if (vErr) {
        console.error(vErr);
        req.flash('error', 'Failed to apply voucher. Please try again.');
        return res.redirect('/cart');
      }

      const validation = validateVoucherForAmount(voucher, subtotal);
      if (!validation.ok) {
        req.flash('error', validation.message);
        return res.redirect('/cart');
      }

      const discountValue = Number((subtotal * (validation.discountPercent / 100)).toFixed(2));
      const finalTotal = Number((subtotal - discountValue).toFixed(2));

      const finalTotals = {
        ...totals,
        discount: discountValue,
        total: finalTotal,
        voucherCode
      };

      return proceedToCreateOrder(finalTotals);
    });
  });
}

// POST /cart/clear
// → clear ALL items from the current user's cart
function clearCart(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }
  const userId = user.id;

  CartModel.clearCart(userId, (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to clear cart.');
      return res.redirect('/cart');
    }

    req.flash('success', 'Cart has been cleared.');
    return res.redirect('/cart');
  });
}

module.exports = {
  addToCart,
  viewCart,
  updateItem,
  removeItem,
  checkout,
  clearCart
};
