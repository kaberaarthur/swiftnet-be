const db = require('./db');
const crypto = require('crypto');

// Function to generate a short code for the URL
function generateShortCode() {
    return crypto.randomBytes(3).toString('hex');  // Generate a 6-character random string
}

// Function to shorten a URL
function shortenUrl(originalUrl, callback) {
    const shortCode = generateShortCode();

    // Insert the original URL and short code into the database
    const query = 'INSERT INTO urls (original_url, short_code) VALUES (?, ?)';
    db.query(query, [originalUrl, shortCode], (err, result) => {
        if (err) return callback(err);

        // Return the shortened URL (e.g., http://localhost:3000/shortCode)
        const shortUrl = `http://localhost:8000/${shortCode}`;
        callback(null, shortUrl);
    });
}

// Function to retrieve the original URL from the short code
function getOriginalUrl(shortCode, callback) {
    const query = 'SELECT original_url FROM urls WHERE short_code = ? LIMIT 1';
    db.query(query, [shortCode], (err, result) => {
        if (err) return callback(err);
        if (result.length === 0) return callback(new Error('URL not found'));

        callback(null, result[0].original_url);
    });
}

module.exports = {
    shortenUrl,
    getOriginalUrl
};
