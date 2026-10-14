const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const BusinessList = require('./routes/BusinessInfo');
const adminRoutes = require('./routes/adminRoutes');
const profileController = require('./controllers/profileController');
const {is_auth}=require('./middleware/middleware');

const app = express();

// Render sits behind one proxy; needed for a correct req.ip in login rate limiting
app.set('trust proxy', 1);

// Optional comma-separated allowlist, e.g. CORS_ORIGINS=https://pitchers-showdown.vercel.app
// Auth uses headers, not cookies, so no credentialed CORS is needed
const origins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));

app.use(express.json({ limit: '10kb' }));

// Render health check: 200 only once the database connection is up
app.get('/api/health', (req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({ status: dbReady ? 'ok' : 'unavailable', database: dbReady ? 'connected' : 'disconnected' });
});

app.use('/api/auth', authRoutes);

app.use('/api/business', BusinessList);

app.get('/api/profile',is_auth, profileController.profile);

app.use('/api/admin', adminRoutes);

// Malformed JSON and other uncaught errors: never send stack traces to clients
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
