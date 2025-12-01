// controllers/AdminUserController.js
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const AdminUser = require('../models/AdminUserModel');

module.exports = {
  // === [GET] /admin/users ===
  getList(req, res) {
    AdminUser.all((err, users) => {
      if (err) {
        req.flash('error', 'Failed to load users.');
        return res.redirect('/');
      }
      res.render('manageUsers', {
        title: 'Users',
        users,
        user: req.session.user || null,
        error: req.flash('error'),
        success: req.flash('success')
      });
    });
  },

  // === [GET] /admin/users/new ===
  getCreate(req, res) {
    res.render('userForm', {
      title: 'Create User',
      isEdit: false,
      user: req.session.user || null,
      formUser: { username: '', email: '', address: '', contact: '', role: 'user' },
      error: req.flash('error'),
      success: req.flash('success')
    });
  },

  // === [POST] /admin/users/new ===
  postCreate: async (req, res) => {
    try {
      const { username, email, password, address, contact, role } = req.body;

      // 1) Check for duplicate email before creating
      AdminUser.findByEmail(email, async (err, existing) => {
        if (err) {
          req.flash('error', 'Database error while checking email.');
          return res.redirect('/admin/users/new');
        }

        if (existing) {
          // Set flash and redirect with ?dupe=1 for pop-up message
          req.flash('error', 'This email is already in use. Please use another email.');
          return res.redirect('/admin/users/new?dupe=1');
        }

        // tolerant read of checkbox (hidden+checkbox may produce array)
        const rawOtp = (req.body && (req.body.otp_enabled || req.body.otp)) || '0';
        const otpValues = Array.isArray(rawOtp) ? rawOtp : [String(rawOtp)];
        const otpEnabledFlag = otpValues.some(v => v === '1' || v === 'on' || v === 'true');

        // 2) Create new user if not duplicate
        const password_hash = await bcrypt.hash(password, 10);
        AdminUser.create(
          {
            username,
            email,
            password_hash,
            address,
            contact,
            role: role === 'admin' ? 'admin' : 'user'
          },
          (err2) => {
            if (err2) {
              req.flash('error', 'Failed to create user.');
              return res.redirect('/admin/users/new');
            }
            req.flash('success', 'User created successfully.');
            return res.redirect('/admin/users');
          }
        );
      });
    } catch (e) {
      console.error(e);
      req.flash('error', 'Unexpected error.');
      return res.redirect('/admin/users/new');
    }
  },

  // === [GET] /admin/users/:id/edit ===
  getEdit(req, res) {
    AdminUser.findById(req.params.id, (err, formUser) => {
      if (err) {
        req.flash('error', 'Database error.');
        return res.redirect('/admin/users');
      }
      if (!formUser) {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/users');
      }

      res.render('userForm', {
        title: 'Edit User',
        isEdit: true,
        user: req.session.user || null,
        formUser,
        error: req.flash('error'),
        success: req.flash('success')
      });
    });
  },

  // === [POST] /admin/users/:id/edit ===
  postEdit: async (req, res) => {
    try {
      const id = req.params.id;
      const { username, email, address, contact, role, password } = req.body;

      AdminUser.update(id, { username, email, address, contact, role: role === 'admin' ? 'admin' : 'user' }, async (err) => {
        if (err) {
          req.flash('error', 'Failed to update user.');
          return res.redirect('/admin/users');
        }

        // Optional password update
        if (password && password.trim().length > 0) {
          const password_hash = await bcrypt.hash(password, 10);
          AdminUser.updatePassword(id, password_hash, (err2) => {
            if (err2) {
              req.flash('error', 'Failed to update password.');
              return res.redirect('/admin/users');
            }
            req.flash('success', 'User updated successfully.');
            return res.redirect('/admin/users');
          });
        } else {
          req.flash('success', 'User updated successfully.');
          return res.redirect('/admin/users');
        }
      });
    } catch (e) {
      console.error(e);
      req.flash('error', 'Unexpected error.');
      return res.redirect('/admin/users');
    }
  },

  // === [POST] /admin/users/:id/delete ===
  postDelete(req, res) {
    if (String(req.session.user?.id) === String(req.params.id)) {
      req.flash('error', "You can't delete your own account while logged in.");
      return res.redirect('/admin/users');
    }

    AdminUser.remove(req.params.id, (err) => {
      if (err) {
        req.flash('error', 'Failed to delete user.');
        return res.redirect('/admin/users');
      }
      req.flash('success', 'User deleted successfully.');
      return res.redirect('/admin/users');
    });
  },

  // === [GET] /admin/users/check-email (optional live check) ===
  checkEmail: (req, res) => {
    const { email } = req.query;
    if (!email) return res.json({ ok: false, exists: false });
    AdminUser.findByEmail(email, (err, existing) => {
      if (err) return res.json({ ok: false, exists: false });
      return res.json({ ok: true, exists: !!existing });
    });
  },
};
