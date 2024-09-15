const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const userRoutes = require('./userRoutes');
const paymentRoutes = require('./paymentRoutes');
const companyRoutes = require('./companyRoutes');
const voucherRoutes = require('./voucherRoutes');

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

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
