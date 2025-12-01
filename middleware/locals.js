// middleware/locals.js
function setLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
}

module.exports = { setLocals };
