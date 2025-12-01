// controllers/FeedbackController.js

const db = require('../db');
const FeedbackModel = require('../models/FeedbackModel');

// Ensure the order belongs to the logged-in user
function getUserOrder(orderId, userId, callback) {
  const sql = `
    SELECT * FROM \`order\`
    WHERE id = ? AND userid = ?
    LIMIT 1
  `;
  db.query(sql, [orderId, userId], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows[0] || null);
  });
}

// ============= ORDER-SPECIFIC FEEDBACK =============

// GET /orders/:id/feedback
function showOrderFeedbackForm(req, res) {
  const user = req.session.user;
  const orderId = parseInt(req.params.id, 10);

  getUserOrder(orderId, user.id, (err, order) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Database error loading order.');
      return res.redirect('/my-orders');
    }
    if (!order) {
      req.flash('error', 'Order not found or not yours.');
      return res.redirect('/my-orders');
    }

    FeedbackModel.getFeedbackForOrderAndUser(orderId, user.id, (fbErr, existingFeedback) => {
      if (fbErr) {
        console.error(fbErr);
        req.flash('error', 'Error loading feedback.');
      }
      res.render('feedbackForm', {
        user,
        order,
        existingFeedback,
        active: 'feedback'
      });
    });
  });
}

// POST /orders/:id/feedback
function submitOrderFeedback(req, res) {
  const user = req.session.user;
  const orderId = parseInt(req.params.id, 10);
  let { rating, comment } = req.body;

  rating = parseInt(rating, 10);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    req.flash('error', 'Rating must be between 1 and 5.');
    return res.redirect(`/orders/${orderId}/feedback`);
  }

  getUserOrder(orderId, user.id, (err, order) => {
    if (err || !order) {
      req.flash('error', 'Order not found or not yours.');
      return res.redirect('/my-orders');
    }

    FeedbackModel.upsertOrderFeedback(user.id, orderId, rating, comment, (fbErr) => {
      if (fbErr) {
        console.error(fbErr);
        req.flash('error', 'Could not save feedback. Please try again.');
        return res.redirect(`/orders/${orderId}/feedback`);
      }
      req.flash('success', 'Thank you! Your feedback has been saved.');
      res.redirect(`/orders/${orderId}`);
    });
  });
}

// ============= GENERAL FEEDBACK (NO ORDER) =============

// GET /feedback/new
function showGeneralFeedbackForm(req, res) {
  res.render('feedbackForm', {
    user: req.session.user,
    order: null,
    existingFeedback: null,
    active: 'feedback'
  });
}

// POST /feedback/new
function submitGeneralFeedback(req, res) {
  const user = req.session.user;
  let { rating, comment } = req.body;

  rating = parseInt(rating, 10);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    req.flash('error', 'Rating must be between 1 and 5.');
    return res.redirect('/feedback/new');
  }

  FeedbackModel.createGeneralFeedback(user.id, rating, comment, (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Could not save feedback.');
      return res.redirect('/feedback/new');
    }
    req.flash('success', 'Thanks for your feedback!');
    res.redirect('/feedback');
  });
}

// ============= LISTING FEEDBACK =============

// GET /feedback  (for normal users – see all feedback)
function listFeedback(req, res) {
  FeedbackModel.getAllWithUser((err, feedbackList) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading feedback.');
      return res.redirect('/');
    }
    res.render('feedbackList', {
      user: req.session.user,
      feedbackList,
      isAdmin: req.session.user && req.session.user.role === 'admin',
      active: 'feedback'
    });
  });
}

// GET /admin/feedback  (admin-only – view all + delete buttons)
function adminListFeedback(req, res) {
  FeedbackModel.getAllWithUser((err, feedbackList) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Error loading feedback.');
      return res.redirect('/inventory');
    }
    res.render('feedbackList', {
      user: req.session.user,
      feedbackList,
      isAdmin: true,
      active: 'feedback'
    });
  });
}

// POST /admin/feedback/:id/delete
function deleteFeedback(req, res) {
  const id = parseInt(req.params.id, 10);

  FeedbackModel.deleteFeedback(id, (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Could not delete feedback.');
    } else {
      req.flash('success', 'Feedback deleted.');
    }
    res.redirect('/admin/feedback');
  });
}

module.exports = {
  showOrderFeedbackForm,
  submitOrderFeedback,
  showGeneralFeedbackForm,
  submitGeneralFeedback,
  listFeedback,
  adminListFeedback,
  deleteFeedback
};
