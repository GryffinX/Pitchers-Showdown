const PORT = process.env.PORT || 5000;

const app = require('./app');
const connect = require('./models/init');
const { adminConfig } = require('./middleware/adminAuth');

// Fail fast with a clear message instead of a 500 on the first login
const missing = ['DATABASE_URL', 'JWT_SECRET'].filter(name => !process.env[name]);
if (missing.length) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
}
if (!adminConfig()) {
    console.warn('Admin dashboard disabled: set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_JWT_SECRET to enable it');
} else if (process.env.ADMIN_JWT_SECRET === process.env.JWT_SECRET) {
    console.warn('ADMIN_JWT_SECRET should be different from JWT_SECRET');
}

connect();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
