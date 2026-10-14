// Added by Aakar Gupta
const jwt = require('jsonwebtoken');
const { Token, User } = require('../models/user');

async function is_auth(req, res, next) {
    try {
        // Get token from header
        const token = req.headers['x-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (typeof decoded.token !== 'string') {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const db_token = await Token.findOne({ token: decoded.token }).populate('user');
        if (!db_token || !db_token.user || db_token.user.deletedAt) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        req.session = req.session || {};
        req.session.user = {
            _id: db_token.user._id,
            username: db_token.user.username,
            name: db_token.user.name,
            Rbalance: db_token.user.Rbalance
        };

        return next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { is_auth };