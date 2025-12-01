// controllers/AuthController.js
const crypto = require('crypto');
const User = require('../models/UserModel');
const db = require('../db'); // your existing db module
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

function loginForm(req, res) {
  res.render('login', { user: req.session.user, error: req.flash('error') });
}

async function register(req, res) {
  const { username, email, password, address = '', contact = '' } = req.body;
  // tolerant read of checkbox (handles hidden+checkbox => array)
  // safe normalization compatible with all Node versions
  const rawOtp = (req.body && (req.body.otp_enabled || req.body.otp)) || '0';
  const otpValues = Array.isArray(rawOtp) ? rawOtp : [String(rawOtp)];
  const otpEnabledFlag = otpValues.some(v => v === '1' || v === 'on' || v === 'true');
  console.log('parsed otpEnabledFlag=', otpEnabledFlag, 'rawOtp=', rawOtp);

  if (!username || !email || !password) {
    req.flash('error', 'Please provide username, email and password');
    return res.redirect('/register');
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const role = 'user';

    // create user with otp_enabled = 0 initially
    const [result] = await db.promise().query(
      'INSERT INTO users (username, email, password, address, contact, role, otp_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, email, hashed, address, contact, role, 0]
    );
    const newUserId = result.insertId;

    if (otpEnabledFlag) {
      // generate secret; try to persist to DB, fallback to session transient
      const secret = speakeasy.generateSecret({ name: `SupermarketApp:${email}` });
      try {
        await db.promise().query('UPDATE users SET otp_secret = ?, otp_enabled = 1 WHERE id = ?', [secret.base32, newUserId]);
      } catch (err) {
        // ignore DB failure, keep secret in session for immediate provisioning
        req.session.tempOtpSecret = secret.base32;
        req.session._pendingOtpTransient = true;
      }
      // mark pending login flow so /otp/verify knows which user to provision
      req.session.pendingUserId = newUserId;
      return res.redirect('/otp/verify');
    }

    req.flash('success', 'Registration successful. Please log in.');
    return res.redirect('/login');
  } catch (err) {
    console.error('register error:', err);
    req.flash('error', 'Registration failed');
    return res.redirect('/register');
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'Please provide email and password');
    return res.redirect('/login');
  }

  try {
    const [rows] = await db.promise().query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
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

    // if 2FA not enabled, complete login
    if (!user.otp_enabled) {
      req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role };
      req.flash('success', 'Login successful');
      return res.redirect('/shopping');
    }

    // 2FA is enabled -> require OTP
    req.session.pendingUserId = user.id;

    // if DB has no secret (enabled flag set but secret missing), create transient secret so QR can be shown now
    if (!user.otp_secret) {
      const secret = speakeasy.generateSecret({ name: `SupermarketApp:${user.email}` });
      req.session.tempOtpSecret = secret.base32;
      req.session._pendingOtpTransient = true;
    }

    return res.redirect('/otp/verify');
  } catch (err) {
    console.error('login error:', err);
    req.flash('error', 'Login failed');
    return res.redirect('/login');
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}

// NEW: show registration form
function registerForm(req, res) {
  res.render('register', { user: req.session.user, error: req.flash('error') });
}

// NEW/updated register: persists otp_enabled and, when enabled, generates & stores a secret
async function register(req, res) {
  const { username, email, password, address = '', contact = '' } = req.body;
  // tolerant read of checkbox (handles hidden+checkbox => array)
  // safe normalization compatible with all Node versions
  const rawOtp = (req.body && (req.body.otp_enabled || req.body.otp)) || '0';
  const otpValues = Array.isArray(rawOtp) ? rawOtp : [String(rawOtp)];
  const otpEnabledFlag = otpValues.some(v => v === '1' || v === 'on' || v === 'true');
  console.log('parsed otpEnabledFlag=', otpEnabledFlag, 'rawOtp=', rawOtp);

  if (!username || !email || !password) {
    req.flash('error', 'Please provide username, email and password');
    return res.redirect('/register');
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const role = 'user';

    // create user with otp_enabled = 0 initially
    const [result] = await db.promise().query(
      'INSERT INTO users (username, email, password, address, contact, role, otp_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, email, hashed, address, contact, role, 0]
    );
    const newUserId = result.insertId;

    if (otpEnabledFlag) {
      // generate secret; try to persist to DB, fallback to session transient
      const secret = speakeasy.generateSecret({ name: `SupermarketApp:${email}` });
      try {
        await db.promise().query('UPDATE users SET otp_secret = ?, otp_enabled = 1 WHERE id = ?', [secret.base32, newUserId]);
      } catch (err) {
        // ignore DB failure, keep secret in session for immediate provisioning
        req.session.tempOtpSecret = secret.base32;
        req.session._pendingOtpTransient = true;
      }
      // mark pending login flow so /otp/verify knows which user to provision
      req.session.pendingUserId = newUserId;
      return res.redirect('/otp/verify');
    }

    req.flash('success', 'Registration successful. Please log in.');
    return res.redirect('/login');
  } catch (err) {
    console.error('register error:', err);
    req.flash('error', 'Registration failed');
    return res.redirect('/register');
  }
}

async function otpSetupForm(req, res) {
  const userId = req.session.user?.id;
  if (!userId) return res.redirect('/login');

  // If user already has secret show QR from stored secret, else generate a temporary secret to display
  try {
    const [rows] = await db.promise().query('SELECT otp_secret FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows[0];
    let secret;
    if (user?.otp_secret) {
      secret = { base32: user.otp_secret, otpauth_url: speakeasy.otpauthURL({ secret: user.otp_secret, label: `${userId}`, encoding: 'base32' }) };
    } else {
      secret = speakeasy.generateSecret({ name: `SupermarketApp:${req.session.user.email}` });
    }
    const qrData = await qrcode.toDataURL(secret.otpauth_url || secret.otpauth_url);
    res.render('otpSetup', { qrData, secretBase32: secret.base32, user: req.session.user, error: req.flash('error'), success: req.flash('success') });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Unable to prepare OTP setup');
    return res.redirect('/shopping');
  }
}

async function otpSetup(req, res) {
  const userId = req.session.user?.id;
  const { secretBase32, enable } = req.body; // form should send secretBase32 and a checkbox/flag
  if (!userId || !secretBase32) {
    req.flash('error', 'Missing data');
    return res.redirect('/otp/setup');
  }
  try {
    const otpEnabled = enable === 'on' ? 1 : 0;
    await db.promise().query('UPDATE users SET otp_secret = ?, otp_enabled = ? WHERE id = ?', [secretBase32, otpEnabled, userId]);
    req.flash('success', otpEnabled ? 'OTP enabled' : 'OTP disabled');
    return res.redirect('/shopping');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to save OTP settings');
    return res.redirect('/otp/setup');
  }
}

// otpVerifyForm: when pendingUserId present, generate QR from stored secret (or session-stored)
async function otpVerifyForm(req, res) {
  const pendingId = req.session.pendingUserId;
  if (!pendingId) return res.redirect('/login');

  try {
    const [rows] = await db.promise().query(
      'SELECT id, email, otp_secret, otp_enabled FROM users WHERE id = ? LIMIT 1',
      [pendingId]
    );
    const user = rows[0];
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/login');
    }

    // prefer DB secret, fall back to session-transient secret
    const secretBase32 = user.otp_secret || req.session.tempOtpSecret;
    if (!secretBase32) {
      req.flash('error', '2FA not configured. Please set up first.');
      return res.redirect('/otp/setup');
    }

    // Always generate QR image when a secret is available (DB or session)
    const otpauth = speakeasy.otpauthURL({
      secret: secretBase32,
      label: `SupermarketApp:${user.email || 'user'}`,
      encoding: 'base32'
    });
    const qrData = await qrcode.toDataURL(otpauth);

    // pass qrData and secret to the view
    return res.render('otpVerify', { qrData, secretBase32, showQr: true, error: req.flash('error') });
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

  try {
    const [rows] = await db.promise().query('SELECT id, email, otp_secret FROM users WHERE id = ? LIMIT 1', [pendingId]);
    const user = rows[0];

    const secretBase32 = user.otp_secret || req.session.tempOtpSecret;
    if (!secretBase32) {
      req.flash('error', 'OTP not configured');
      return res.redirect('/otp/setup');
    }

    const verified = speakeasy.totp.verify({ secret: secretBase32, encoding: 'base32', token, window: 1 });
    if (!verified) {
      req.flash('error', 'Invalid OTP code');
      return res.redirect('/otp/verify');
    }

    // on success: finish login
    req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role };

    // if secret was only in session, persist it now so QR is not shown again
    if (!user.otp_secret && req.session.tempOtpSecret) {
      try {
        await db.promise().query('UPDATE users SET otp_secret = ?, otp_enabled = 1 WHERE id = ?', [req.session.tempOtpSecret, pendingId]);
      } catch (e) {
        console.warn('Failed to persist OTP secret to DB:', e?.message || e);
      }
      delete req.session.tempOtpSecret;
      delete req.session._pendingOtpTransient;
    }

    delete req.session.pendingUserId;
    req.flash('success', 'Login successful');
    return res.redirect('/shopping');
  } catch (err) {
    console.error('otpVerify error:', err);
    req.flash('error', 'OTP verification failed');
    return res.redirect('/login');
  }
}

async function otpReprovisionForm(req, res) {
  const userId = req.session.user?.id;
  if (!userId) return res.redirect('/login');

  try {
    const [rows] = await db.promise().query('SELECT id, email, otp_secret, otp_enabled FROM users WHERE id = ? LIMIT 1', [userId]);
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

    // reuse otpSetup view (it should accept qrData / secretBase32)
    return res.render('otpSetup', {
      qrData,
      secretBase32: user.otp_secret,
      user: req.session.user,
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

module.exports = { loginForm, login, logout, registerForm, register, otpSetupForm, otpSetup, otpVerifyForm, otpVerify, otpReprovisionForm };
