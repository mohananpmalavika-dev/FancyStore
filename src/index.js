const express = require('express');
const productsRouter = require('./routes/products');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const auth = require('./middleware/auth');
const sendEmail = require('./utils/email');
const storefrontRouter = require('./routes/storefront');
const { formatRupees } = require('./utils/currency');
const { getStoreProfile } = require('./utils/storeProfile');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.formatRupees = formatRupees;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(cookieParser());
app.use((req, res, next) => {
	res.locals.storeProfile = getStoreProfile();
	next();
});

app.get('/health', (req, res) => {
	res.status(200).json({ ok: true });
});

// apply CSRF protection only to admin UI routes (forms)
const csrfProtection = csurf({ cookie: true });

// Basic rate limiter for sensitive routes
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

app.use('/auth', authLimiter, authRouter);
app.use('/products', apiLimiter, productsRouter);
app.use('/admin', csrfProtection, (req, res, next) => {
	// expose token for views
	res.locals.csrfToken = req.csrfToken();
	next();
}, adminRouter);
app.use('/offers', require('./routes/offers'));
app.use('/cart', require('./routes/cart'));
app.use('/favorites', require('./routes/favorites'));
app.use('/recurring', require('./routes/recurring'));
app.use('/events', require('./routes/events'));
app.use('/scheduled', require('./routes/scheduled'));

// Email test endpoint - admin only. Accepts optional smtp override in body (for debugging).
app.post('/email/test', auth.authenticateJWT, auth.authorizeRole(['admin']), async (req, res) => {
	const { to, subject, text, smtp } = req.body;
	if (!to) return res.status(400).json({ error: 'to is required' });
	try {
		let info;
		if (smtp && typeof smtp === 'object') {
			// build transport options from provided smtp object
			const transportOptions = {
				host: smtp.host || process.env.SMTP_HOST,
				port: smtp.port ? Number(smtp.port) : Number(process.env.SMTP_PORT) || 587,
				secure: !!smtp.secure,
				auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
			};
			info = await sendEmail(to, subject || 'Test Email', text || 'This is a test', transportOptions, smtp.from);
		} else {
			info = await sendEmail(to, subject || 'Test Email', text || 'This is a test');
		}
		res.json({ ok: true, info });
	} catch (err) {
		res.status(500).json({ error: 'failed to send', details: err.message });
	}
});

app.use('/', storefrontRouter);

const port = process.env.PORT || 3000;
if (require.main === module) {
	app.listen(port, () => console.log(`Server listening on ${port}`));
}

module.exports = app;
