const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const userRoutes = require('./userRoutes');
const paymentRoutes = require('./paymentRoutes');
const companyRoutes = require('./companyRoutes');
const voucherRoutes = require('./voucherRoutes');
const routerRoutes = require('./routerRoutes');
const { shortenUrl, getOriginalUrl } = require('./urlShortener');

const app = express();
const port = 8000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Use the user management routes
// app.use('/api', userRoutes);
app.use(userRoutes);
app.use(paymentRoutes)
app.use(companyRoutes)
app.use(voucherRoutes)
app.use(routerRoutes)

// Allow requests from any origin
app.use(cors({
    origin: '*',  // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE'],  // Specify allowed methods
    credentials: true,  // Optional: Use this if your requests need to include cookies
}));

// Home route
app.get('/', (req, res) => {
    res.send('Welcome to the Home Page of our Node.js Application!');
});

// Route to shorten a URL
app.post('/shorten', (req, res) => {
    const { originalUrl } = req.body;
    if (!originalUrl) return res.status(400).send('Original URL is required');

    shortenUrl(originalUrl, (err, shortUrl) => {
        if (err) return res.status(500).send('Error shortening URL');
        res.json({ shortUrl });
    });
});

// Route to redirect to the original URL using the short code
app.get('/:shortCode', (req, res) => {
    const { shortCode } = req.params;

    getOriginalUrl(shortCode, (err, originalUrl) => {
        if (err) return res.status(404).send('URL not found');
        res.redirect(originalUrl);
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
