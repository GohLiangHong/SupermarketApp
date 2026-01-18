//the main web framework.
const express = require('express');
//enables user sessions (used for login persistence and cart storage).
const session = require('express-session');
//allows temporary “flash” messages (like “Login successful!” or “Admins only.”).
const flash = require('connect-flash');
//handles file uploads (e.g., product images).
const multer = require('multer');
//helps build safe file paths across systems.
const path = require('path');
//files logic for productController 
//const ProductController = require('./controllers/ProductController');
//ProductModel for database interaction with product table
//const ProductModel = require('./models/ProductModel');
//files logic for AuthController 
//const AuthController = require('./controllers/AuthController');

// Consolidated non-admin controllers (exposed via controllers/UserController.js)
const UserController = require('./controllers/UserController');
const AuthController = UserController.AuthController;
const ProductController = UserController.ProductController;
const CartController = UserController.CartController;
const OrderController = UserController.OrderController;

// Admin controller (ensure Admin routes have a handler)
const AdminUserController = require('./controllers/AdminUserController');

// Middleware (authentication & locals)
const { checkAuthenticated, checkAdmin } = require('./middleware/auth');
const { setLocals } = require('./middleware/locals');

const FeedbackController = require('./controllers/FeedbackController');
const PaymentController = require('./controllers/PaymentController');
const NetsPaymentController = require('./controllers/NetsPaymentController');
const WalletController = require('./controllers/WalletController');
const EwalletPaymentController = require('./controllers/EwalletPaymentController');


const app = express();

// ensure form POST bodies are parsed
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// single multer storage/upload definition
const storage = multer.diskStorage({
  //destination: saves images into /public/images.
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
  //filename: prefixes the uploaded filename with a timestamp (to avoid filename conflicts (duplicates)).
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
//upload → can now be used in routes like upload.single('image').
const upload = multer({ storage });

// view engine / static / body parsers
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// sessions + flash
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));
app.use(flash());

// locals for templates
app.use(setLocals);

// Routes

app.get('/', (req, res) => res.render('index', { user: req.session.user }));

// product listing (renders inventory for admins, shopping for users)
app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.list);
app.get('/shopping', checkAuthenticated, ProductController.list);

// product pages
app.get('/product/:id', checkAuthenticated, ProductController.getById);
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.getById);

// add / edit / delete product
app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
  res.render('addProduct', { user: req.session.user });
});
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.create);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.update);
// use POST for destructive actions to be safe
app.post('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.delete);

// cart
app.post('/add-to-cart/:id', checkAuthenticated, CartController.addToCart);
app.get('/cart', checkAuthenticated, CartController.viewCart);
app.post('/cart/update/:id', checkAuthenticated, CartController.updateItem);
app.post('/cart/remove/:id', checkAuthenticated, CartController.removeItem);
app.post('/cart/checkout', checkAuthenticated, CartController.checkout);
app.post('/cart/clear', checkAuthenticated, CartController.clearCart);

// Auth routes (use your AuthController)
app.get('/login', AuthController.loginForm);
app.post('/login', AuthController.login);
app.get('/register', AuthController.registerForm);
app.post('/register', AuthController.register);
app.get('/logout', AuthController.logout);

// OTP routes (setup + verify)
app.get('/otp/setup', checkAuthenticated, AuthController.otpSetupForm);        // shows QR + enable toggle
app.post('/otp/setup', checkAuthenticated, AuthController.otpSetup);          // saves secret + enable flag
app.get('/otp/verify', AuthController.otpVerifyForm);                         // page to enter code (after login POST)
app.post('/otp/verify', AuthController.otpVerify);                            // verify token and complete login

// NEW: reprovision (show QR for already-configured users)
app.get('/otp/reprovision', checkAuthenticated, AuthController.otpReprovisionForm);

// === Admin Users (CRUD) with bcrypt ===

app.get('/admin/users',            checkAuthenticated, checkAdmin, AdminUserController.getList);
app.get('/admin/users/new',        checkAuthenticated, checkAdmin, AdminUserController.getCreate);
app.post('/admin/users/new',       checkAuthenticated, checkAdmin, AdminUserController.postCreate);
app.get('/admin/users/:id/edit',   checkAuthenticated, checkAdmin, AdminUserController.getEdit);
app.post('/admin/users/:id/edit',  checkAuthenticated, checkAdmin, AdminUserController.postEdit);
app.post('/admin/users/:id/delete',checkAuthenticated, checkAdmin, AdminUserController.postDelete);
app.get('/admin/users/check-email', checkAuthenticated, checkAdmin, AdminUserController.checkEmail);

// order details
app.get('/my-orders', checkAuthenticated, OrderController.listOrders);
app.get('/orders/:id', checkAuthenticated, OrderController.viewOrder);
app.get('/orders/confirm/:id', checkAuthenticated, OrderController.showConfirmation);
app.post('/orders/confirm/:id', checkAuthenticated, OrderController.confirmOrder);

// ================== FEEDBACK ROUTES ==================

// Order-specific feedback
app.get('/orders/:id/feedback',
  checkAuthenticated,
  FeedbackController.showOrderFeedbackForm
);
app.post('/orders/:id/feedback',
  checkAuthenticated,
  FeedbackController.submitOrderFeedback
);

// General feedback (no specific order)
app.get('/feedback/new',
  checkAuthenticated,
  FeedbackController.showGeneralFeedbackForm
);
app.post('/feedback/new',
  checkAuthenticated,
  FeedbackController.submitGeneralFeedback
);

// Feedback listing (users see all)
app.get('/feedback',
  checkAuthenticated,
  FeedbackController.listFeedback
);

// Admin feedback management
app.get('/admin/feedback',
  checkAuthenticated,
  checkAdmin,
  FeedbackController.adminListFeedback
);
app.post('/admin/feedback/:id/delete',
  checkAuthenticated,
  checkAdmin,
  FeedbackController.deleteFeedback
);

// payments (PayPal)
app.get('/payments/paypal', checkAuthenticated, PaymentController.showPaymentPage);
app.post('/api/paypal/create-order', checkAuthenticated, PaymentController.createOrderApi);
app.post('/api/paypal/capture-order', checkAuthenticated, PaymentController.captureOrderApi);
// payments (NETS)
app.get('/payments/nets', checkAuthenticated, NetsPaymentController.showNetsPaymentPage);
app.get('/sse/nets/payment-status/:txnRetrievalRef', checkAuthenticated, NetsPaymentController.ssePaymentStatus);

// ✅ NETSDemo alias:
app.get('/sse/payment-status/:txnRetrievalRef', checkAuthenticated, NetsPaymentController.ssePaymentStatus);

app.get('/payments/nets/success', checkAuthenticated, NetsPaymentController.netsSuccess);
app.get('/payments/nets/fail', checkAuthenticated, NetsPaymentController.netsFail);
// ================== E-WALLET ROUTES ==================
app.get('/wallet', checkAuthenticated, WalletController.walletHome);
app.post('/wallet/topup', checkAuthenticated, WalletController.topupStart);

// PayPal for Wallet
app.post('/api/paypal/wallet/create-order', checkAuthenticated, WalletController.createWalletPaypalOrder);
app.post('/api/paypal/wallet/capture-order', checkAuthenticated, WalletController.captureWalletPaypalOrder);

app.get('/wallet', checkAuthenticated, WalletController.walletHome);
app.post('/wallet/topup', checkAuthenticated, WalletController.topupStart);

// NETS top up for Wallet
app.post('/wallet/topup/nets', checkAuthenticated, WalletController.topupStartNets);
app.get('/wallet/nets/success', checkAuthenticated, WalletController.netsWalletSuccess);
app.get('/wallet/nets/fail', checkAuthenticated, WalletController.netsWalletFail);

// payments (E-WALLET)
app.get('/payments/ewallet', checkAuthenticated, EwalletPaymentController.showEwalletPaymentPage);
app.post('/payments/ewallet/pay', checkAuthenticated, EwalletPaymentController.payWithEwallet);

// API for client-side wallet balance checks
app.get('/api/wallet/balance', WalletController.getBalance);

// export + start
module.exports = app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
