const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        required: true,
    },
    password: {
        type: String,
        set: pass => bcrypt.hashSync(pass, 10),   // older cost-5 hashes still verify
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    Rbalance: {   // remaining balance
        type: Number,
        default: 7000,
    },
    desc: {
        type: String, required: true
    },
    ppt: String,
    deletedAt: {   // set when an admin deletes the team; history (investments) is kept
        type: Date,
        default: null,
    },
});

// Async so a burst of logins does not block the event loop
UserSchema.statics.checkPassword = function (inputPassword, hashedPassword) {
    return bcrypt.compare(inputPassword, hashedPassword);
};

const User = mongoose.model('User', UserSchema);

const TokenSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    token: {
        type: String,
        default: crypto.randomBytes(128).toString('hex'),
        unique: true,
    },
});

const Token = mongoose.model('Token', TokenSchema);

module.exports = { User, Token };
