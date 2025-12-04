// controllers/AuthController.js
const crypto = require('crypto');
const db = require('../db'); // MySQL connection (mysql2)
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

// Helper (kept for backward compatibility if any code still calls it)
function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

// =========================
//  Basic auth views
// =========================
function loginForm(req, res) {
  res.render('login', {
    user: req.session.user,
    error: req.flash('error')
  });
}

function registerForm(req, res) {
  res.render('register', {
    user: req.session.user,
    error: req.flash('error')
  });
}

// =========================
//  Registration
//  - If 2FA checkbox ticked:
//      * create user with otp_enabled = 0
//      * generate *temporary* secret (kept only in session)
//      * redirect to /otp/verify for first-time setup
//  - If 2FA not ticked:
//      * normal register -> /login
// =========================
async function register(req, res) {
  const { username, email, password, address = '', contact = '' } = req.body;

  // handle checkbox (hidden + checkbox can come as array or string)
  const rawOtp = (req.body && (req.body.otp_enabled || req.body.otp)) || '0';
  const otpValues = Array.isArray(rawOtp) ? rawOtp : [String(rawOtp)];
  const otpEnabledFlag = otpValues.some(
    v => v === '1' || v === 'on' || v === 'true'
  );
  console.log('parsed otpEnabledFlag =', otpEnabledFlag, 'rawOtp =', rawOtp);

  if (!username || !email || !password) {
    req.flash('error', 'Please provide username, email and password');
    return res.redirect('/register');
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const role = 'user';

    // create user with otp_enabled = 0 first
    const [result] = await db
      .promise()
      .query(
        'INSERT INTO users (username, email, password, address, contact, role, otp_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, email, hashed, address, contact, role, 0]
      );

    const newUserId = result.insertId;

    // If user chose 2FA at registration, go directly into OTP setup flow
    if (otpEnabledFlag) {
      const secret = speakeasy.generateSecret({
        name: `SupermarketApp:${email}`
      });

      // Keep secret only in session initially; we persist to DB only after
      // the user successfully verifies one OTP code.
      req.session.tempOtpSecret = secret.base32;
      req.session.pendingUserId = newUserId;

      req.flash('success', 'Account created. Please set up your 2FA now.');
      return res.redirect('/otp/verify');
    }

    // Normal registration (no 2FA)
    req.flash('success', 'Registration successful. Please log in.');
    return res.redirect('/login');
  } catch (err) {
    console.error('register error:', err);
    req.flash('error', 'Registration failed');
    return res.redirect('/register');
  }
}

// =========================
//  Login
//  - If otp_enabled = 0: normal login
//  - If otp_enabled = 1: go to /otp/verify (no QR, just code input)
// =========================
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error', 'Please provide email and password');
    return res.redirect('/login');
  }

  try {
    const [rows] = await db
      .promise()
      .query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];

    if (!user) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/login');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/login');
    }

    // If 2FA not enabled -> complete login immediately
    if (!user.otp_enabled) {
      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      };
      req.flash('success', 'Login successful');
      return res.redirect('/shopping');
    }

    // 2FA is enabled -> require OTP
    req.session.pendingUserId = user.id;

    // DO NOT generate new QR / secret here.
    // We will use the existing otp_secret stored in DB during /otp/verify.
    return res.redirect('/otp/verify');
  } catch (err) {
    console.error('login error:', err);
    req.flash('error', 'Login failed');
    return res.redirect('/login');
  }
}

// =========================
//  Logout
// =========================
function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}

// =========================
//  OTP SETUP (from profile)
//  - /otp/setup (GET): show QR + secret for enabling/disabling 2FA
//  - /otp/setup (POST): save secret + enabled flag
// =========================
async function otpSetupForm(req, res) {
  const sessionUser = req.session.user;
  const userId = sessionUser && sessionUser.id;
  if (!userId) return res.redirect('/login');

  try {
    const [rows] = await db
      .promise()
      .query(
        'SELECT id, email, otp_secret, otp_enabled FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
    const user = rows[0];

    let secretBase32;
    let otpauthUrl;

    if (user && user.otp_secret) {
      // Use existing secret
      secretBase32 = user.otp_secret;
      otpauthUrl = speakeasy.otpauthURL({
        secret: secretBase32,
        label: `SupermarketApp:${user.email || user.id}`,
        encoding: 'base32'
      });
    } else {
      // Generate a new secret for setup
      const tmpSecret = speakeasy.generateSecret({
        name: `SupermarketApp:${user && user.email ? user.email : userId}`
      });
      secretBase32 = tmpSecret.base32;
      otpauthUrl = tmpSecret.otpauth_url;
    }

    const qrData = await qrcode.toDataURL(otpauthUrl);

    return res.render('otpSetup', {
      qrData,
      secretBase32,
      user: sessionUser,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('otpSetupForm error:', err);
    req.flash('error', 'Unable to prepare OTP setup');
    return res.redirect('/shopping');
  }
}

async function otpSetup(req, res) {
  const sessionUser = req.session.user;
  const userId = sessionUser && sessionUser.id;
  const { secretBase32, enable } = req.body; // form should send secretBase32 and a checkbox/flag

  if (!userId || !secretBase32) {
    req.flash('error', 'Missing data');
    return res.redirect('/otp/setup');
  }

  try {
    const otpEnabled = enable === 'on' || enable === '1' ? 1 : 0;

    await db
      .promise()
      .query(
        'UPDATE users SET otp_secret = ?, otp_enabled = ? WHERE id = ?',
        [secretBase32, otpEnabled, userId]
      );

    req.flash('success', otpEnabled ? '2FA OTP enabled' : '2FA OTP disabled');
    return res.redirect('/shopping');
  } catch (err) {
    console.error('otpSetup error:', err);
    req.flash('error', 'Failed to save OTP settings');
    return res.redirect('/otp/setup');
  }
}

// =========================
//  OTP VERIFY (after login or registration)
//  - /otp/verify (GET):
//        * First-time setup (after register with 2FA ticked):
//              show QR + secret (from session tempOtpSecret)
//        * Normal login (otp_enabled = 1 and otp_secret in DB):
//              ONLY show 6-digit OTP input (no QR, no secret)
//  - /otp/verify (POST):
//        * verify token
//        * if first-time setup: save secret + enable 2FA
//        * complete login and clear pending session state
// =========================
async function otpVerifyForm(req, res) {
  const pendingId = req.session.pendingUserId;
  if (!pendingId) return res.redirect('/login');

  try {
    const [rows] = await db
      .promise()
      .query(
        'SELECT id, email, username, role, otp_secret, otp_enabled FROM users WHERE id = ? LIMIT 1',
        [pendingId]
      );
    const user = rows[0];

    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/login');
    }

    const sessionSecret = req.session.tempOtpSecret || null;
    const dbSecret = user.otp_secret || null;

    // First-time setup right after registration:
    //  - user has NO otp_secret in DB yet
    //  - we DO have a temp secret in the session
    if (!dbSecret && sessionSecret) {
      const secretBase32 = sessionSecret;
      const otpauth = speakeasy.otpauthURL({
        secret: secretBase32,
        label: `SupermarketApp:${user.email || 'user'}`,
        encoding: 'base32'
      });
      const qrData = await qrcode.toDataURL(otpauth);

      return res.render('otpVerify', {
        qrData,            // show QR ONLY in this case
        secretBase32,      // manual setup (only first-time)
        showQr: true,
        error: req.flash('error')
      });
    }

    // Normal login: user already has otp_secret in DB
    if (dbSecret) {
      return res.render('otpVerify', {
        qrData: null,
        secretBase32: null,
        showQr: false,     // no QR, no secret text
        error: req.flash('error')
      });
    }

    // Fallback: no secret anywhere
    req.flash('error', '2FA not configured. Please log in and set it up from your profile.');
    return res.redirect('/login');
  } catch (err) {
    console.error('otpVerifyForm error:', err);
    req.flash('error', 'Unable to prepare OTP verification');
    return res.redirect('/login');
  }
}

async function otpVerify(req, res) {
  const { token } = req.body;
  const pendingId = req.session.pendingUserId;

  if (!pendingId) {
    req.flash('error', 'Session expired, please login again');
    return res.redirect('/login');
  }

  if (!token) {
    req.flash('error', 'Please enter the 6-digit code');
    return res.redirect('/otp/verify');
  }

  try {
    const [rows] = await db
      .promise()
      .query(
        'SELECT id, email, username, role, otp_secret, otp_enabled FROM users WHERE id = ? LIMIT 1',
        [pendingId]
      );
    const user = rows[0];

    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/login');
    }

    const dbSecret = user.otp_secret || null;
    const sessionSecret = req.session.tempOtpSecret || null;
    const secretBase32 = dbSecret || sessionSecret;

    if (!secretBase32) {
      req.flash('error', 'OTP not configured');
      return res.redirect('/login');
    }

    const verified = speakeasy.totp.verify({
      secret: secretBase32,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      req.flash('error', 'Invalid OTP code');
      return res.redirect('/otp/verify');
    }

    // If we were in first-time setup, persist secret + enable 2FA
    if (!dbSecret && sessionSecret) {
      try {
        await db
          .promise()
          .query(
            'UPDATE users SET otp_secret = ?, otp_enabled = 1 WHERE id = ?',
            [sessionSecret, pendingId]
          );
      } catch (e) {
        console.warn('Failed to persist OTP secret to DB:', e && e.message ? e.message : e);
      }
    }

    // Complete login
    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };

    // Clear temporary session state
    delete req.session.pendingUserId;
    delete req.session.tempOtpSecret;

    req.flash('success', 'Login successful');
    return res.redirect('/shopping');
  } catch (err) {
    console.error('otpVerify error:', err);
    req.flash('error', 'OTP verification failed');
    return res.redirect('/login');
  }
}

// =========================
//  OTP Re-provision (show QR again for existing secret)
//  - Used when user wants to re-scan QR on a new phone
// =========================
async function otpReprovisionForm(req, res) {
  const sessionUser = req.session.user;
  const userId = sessionUser && sessionUser.id;
  if (!userId) return res.redirect('/login');

  try {
    const [rows] = await db
      .promise()
      .query(
        'SELECT id, email, otp_secret, otp_enabled FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
    const user = rows[0];

    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/shopping');
    }

    if (!user.otp_secret) {
      req.flash('error', '2FA not configured. Please set up first.');
      return res.redirect('/otp/setup');
    }

    const otpauth = speakeasy.otpauthURL({
      secret: user.otp_secret,
      label: `SupermarketApp:${user.email || userId}`,
      encoding: 'base32'
    });

    const qrData = await qrcode.toDataURL(otpauth);

    return res.render('otpSetup', {
      qrData,
      secretBase32: user.otp_secret,
      user: sessionUser,
      reprovision: true,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('otpReprovisionForm error:', err);
    req.flash('error', 'Unable to prepare 2FA reprovision');
    return res.redirect('/shopping');
  }
}

module.exports = {
  loginForm,
  login,
  logout,
  registerForm,
  register,
  otpSetupForm,
  otpSetup,
  otpVerifyForm,
  otpVerify,
  otpReprovisionForm
};
