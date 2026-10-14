const jwt = require('jsonwebtoken');
const { AdminSession } = require('../models/admin');

const ADMIN_AUDIENCE = 'pitchers-showdown-admin';
const ADMIN_TOKEN_TTL_SECONDS = 2 * 60 * 60;

const adminConfig = () => {
    const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH, ADMIN_JWT_SECRET } = process.env;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !ADMIN_JWT_SECRET) return null;
    return { username: ADMIN_USERNAME, passwordHash: ADMIN_PASSWORD_HASH, secret: ADMIN_JWT_SECRET };
};

// Admin tokens use their own secret and audience, so a team JWT can never pass this check
async function is_admin(req, res, next) {
    const config = adminConfig();
    if (!config) return res.status(503).json({ error: 'Admin access is not configured' });

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Admin authentication required' });

    let payload;
    try {
        payload = jwt.verify(token, config.secret, { audience: ADMIN_AUDIENCE, algorithms: ['HS256'] });
    } catch (err) {
        const expired = err.name === 'TokenExpiredError';
        return res.status(401).json({ error: expired ? 'Admin session expired' : 'Invalid admin token' });
    }

    try {
        if (payload.role !== 'admin' || payload.sub !== config.username)
            return res.status(401).json({ error: 'Invalid admin token' });

        const session = await AdminSession.findOne({ jti: payload.jti });
        if (!session) return res.status(401).json({ error: 'Admin session has ended' });

        req.admin = { username: payload.sub, jti: payload.jti, expiresAt: session.expiresAt };
        return next();
    } catch (err) {
        console.error('Admin auth error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { is_admin, adminConfig, ADMIN_AUDIENCE, ADMIN_TOKEN_TTL_SECONDS };
