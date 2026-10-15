const mongoose = require('mongoose');

// One document per issued admin token; deleting it revokes the token (logout)
const AdminSessionSchema = new mongoose.Schema({
    jti: { type: String, required: true, unique: true },
    admin: { type: String, required: true },
    expiresAt: { type: Date, required: true },
});
AdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AdminSession = mongoose.model('AdminSession', AdminSessionSchema);

module.exports = { AdminSession };
