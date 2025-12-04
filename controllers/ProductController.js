// ...existing code...
const ProductModel = require('../models/ProductModel');
const CartModel = require('../models/CartModel'); // added

function list(req, res) {
    ProductModel.getAll((err, products) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        // Render inventory for admin, shopping for normal users
        if (req.path === '/inventory' ||
            (req.session && req.session.user && req.session.user.role === 'admin')) {
            return res.render('inventory', {
                products,
                user: req.session.user,
                error: req.flash('error'),
                success: req.flash('success')
            });
        }

        // normal shopping page
        // If user logged in, get their cart quantities so we can compute remaining stock per product
        if (req.session && req.session.user) {
            const userId = req.session.user.id;
            CartModel.getCartByUser(userId, (err2, items) => {
                if (err2) {
                    console.error(err2);
                    // render anyway with empty map
                    return res.render('shopping', {
                        products,
                        user: req.session.user,
                        cartMap: {},
                        error: req.flash('error'),
                        success: req.flash('success')
                    });
                }

                const cartMap = {};
                (items || []).forEach(it => {
                    cartMap[it.productId] = Number(it.cart_quantity || it.quantity || 0);
                });

                return res.render('shopping', {
                    products,
                    user: req.session.user,
                    cartMap,
                    error: req.flash('error'),
                    success: req.flash('success')
                });
            });

            return;
        }

        // not logged in -> no cartMap
        res.render('shopping', {
            products,
            user: req.session.user,
            cartMap: {},
            error: req.flash('error'),
            success: req.flash('success')
        });
    });
}


function getById(req, res) {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).send('Invalid product id');

    ProductModel.getById(id, (err, product) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        if (!product) return res.status(404).send('Product not found');

        // If the route is for editing, render the update form
        if (req.path.startsWith('/updateProduct')) {
            return res.render('updateProduct', { product, user: req.session.user });
        }

        // Otherwise render product detail view
        res.render('product', { product, user: req.session.user });
    });
}

function create(req, res) {
    // Expect multer to populate req.file
    const { name, quantity, price } = req.body;
    const image = req.file ? req.file.filename : null;

    if (!name || quantity == null || price == null) {
        req.flash('error', 'Missing required product fields');
        return res.redirect('/addProduct');
    }

    const product = {
        productName: name,
        quantity,
        price,
        image
    };

    ProductModel.add(product, (err/*, result*/) => {
        if (err) {
            console.error(err);
            req.flash('error', 'Error adding product');
            return res.redirect('/addProduct');
        }
        res.redirect('/inventory');
    });
}

function update(req, res) {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).send('Invalid product id');

    const { name, quantity, price, currentImage } = req.body;
    let image = currentImage || null;
    if (req.file) image = req.file.filename;

    if (!name || quantity == null || price == null) {
        req.flash('error', 'Missing required product fields');
        return res.redirect(`/updateProduct/${id}`);
    }

    const product = {
        productName: name,
        quantity,
        price,
        image
    };

    ProductModel.update(id, product, (err, result) => {
        if (err) {
            console.error(err);
            req.flash('error', 'Error updating product');
            return res.redirect(`/updateProduct/${id}`);
        }
        if (!result || result.affectedRows === 0) {
            req.flash('error', 'Product not found');
            return res.redirect('/inventory');
        }
        res.redirect('/inventory');
    });
}

function remove(req, res) {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).send('Invalid product id');

    ProductModel.delete(id, (err, result) => {
        if (err) {
            console.error(err);
            req.flash('error', 'Error deleting product');
            return res.redirect('/inventory');
        }
        if (!result || result.affectedRows === 0) {
            req.flash('error', 'Product not found');
        }
        res.redirect('/inventory');
    });
}

module.exports = {
    list,
    getById,
    create,
    update,
    delete: remove
};
// ...existing code...