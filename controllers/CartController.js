// controllers/CartController.js
// controllers/CartController.js
const ProductModel = require('../models/ProductModel');
const CartModel = require('../models/CartModel');
const OrderModel = require('../models/Order');   // order header + items
const db = require('../db');                     // direct SQL for stock updates

// POST /add-to-cart/:id
function addToCart(req, res) {
  const user = req.session.user;
  if (!user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }

  const userId = user.id;
  const productId = parseInt(req.params.id, 10);
  const quantity = parseInt(req.body.quantity || '1', 10);

  if (Number.isNaN(productId)) {
    req.flash('error', 'Invalid product.');
    return res.redirect('/shopping');
  }
  if (Number.isNaN(quantity) || quantity <= 0) {
    req.flash('error', 'Invalid quantity.');
    return res.redirect('/shopping');
  }

  // Re-check product exists before adding
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

    CartModel.addOrUpdateItem(userId, productId, quantity, (err2) => {
      if (err2) {
        console.error(err2);
        req.flash('error', 'Could not update cart.');
        return res.redirect('/shopping');
      }

      req.flash('success', 'Item added to cart.');
      return res.redirect('/cart');
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

  if (Number.isNaN(quantity) || quantity <= 0) {
    // treat as remove
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

  CartModel.updateItem(userId, productId, quantity, (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Could not update cart quantity.');
      return res.redirect('/cart');
    }

    req.flash('success', 'Cart updated.');
    return res.redirect('/cart');
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

  const selectedRaw = req.body.selectedProductIds || '';
  const selectedIds = selectedRaw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !Number.isNaN(n));

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
      const qty = Number(item.quantity);
      const stock = Number(item.stock);
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
      subtotal += Number(item.price) * Number(item.quantity);
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
      total: subtotal
    };

    // 5) Create order header
    OrderModel.createOrder(userId, totals, (err2, orderData) => {
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
          const newQty = Number(item.stock) - Number(item.quantity);
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
