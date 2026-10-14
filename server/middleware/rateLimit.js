// Small in-memory fixed-window limiter (single Render instance, so memory is enough)
function rateLimit({ windowMs, max, message }) {
    const hits = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
    }, windowMs).unref();

    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip;
        let entry = hits.get(key);
        if (!entry || entry.reset <= now) {
            entry = { count: 0, reset: now + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > max) {
            res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
            return res.status(429).json({ error: message });
        }
        next();
    };
}

module.exports = { rateLimit };
