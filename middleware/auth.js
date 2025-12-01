// middleware/auth.js
function checkAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash('error', 'Please log in first.');
  return res.redirect('/login');
}

function checkAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  req.flash('error', 'Admins only.');
  return res.redirect('/shopping');
}

module.exports = { checkAuthenticated, checkAdmin };
