// ...existing code...
const db = require('../db');

function getAll(callback) {
    const sql = 'SELECT id, productName, quantity, price, image FROM products';
    db.query(sql, (err, results) => {
        if (err) return callback(err);
        callback(null, results);
    });
}

function getById(id, callback) {
    const sql = 'SELECT id, productName, quantity, price, image FROM products WHERE id = ?';
    db.query(sql, [id], (err, results) => {
        if (err) return callback(err);
        // return single object or null
        callback(null, results.length ? results[0] : null);
    });
}

function add(product, callback) {
    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    const params = [product.productName, product.quantity, product.price, product.image];
    db.query(sql, params, (err, result) => {
        if (err) return callback(err);
        callback(null, { insertId: result.insertId });
    });
}

function update(id, product, callback) {
    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
    const params = [product.productName, product.quantity, product.price, product.image, id];
    db.query(sql, params, (err, result) => {
        if (err) return callback(err);
        callback(null, { affectedRows: result.affectedRows });
    });
}

function remove(id, callback) {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return callback(err);
        callback(null, { affectedRows: result.affectedRows });
    });
}

module.exports = {
    getAll,
    getById,
    add,
    update,
    delete: remove
};
// ...existing code...