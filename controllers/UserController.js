// ...existing code...
// This module *exposes* the non-admin controllers so app.js can import them from one file.
// It does not change any controller logic or DB structure — it only re-exports.
const AuthController = require('./AuthController');
const ProductController = require('./ProductController');
const CartController = require('./CartController');
const OrderController = require('./OrderController');

// Export each controller under a property so other files can use the exact same names
module.exports = {
  AuthController,
  ProductController,
  CartController,
  OrderController
};
// ...existing code...