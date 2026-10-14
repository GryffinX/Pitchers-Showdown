const { User } = require('../models/user');

// Matches documents where deletedAt is null or missing (older accounts)
const ACTIVE = { deletedAt: null };

const USERNAME_RE = /^[A-Za-z0-9_.@-]{3,64}$/;

class ValidationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const validateUsername = (username) => {
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim()))
        throw new ValidationError('Username must be 3-64 characters: letters, numbers, _ . @ -');
    return username.trim();
};

const validateName = (name) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
        throw new ValidationError('Team name is required (max 60 characters)');
    return name.trim();
};

// bcrypt only uses the first 72 bytes of a password
const validatePassword = (password) => {
    if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72)
        throw new ValidationError('Password must be 6-72 characters');
    return password;
};

// Shared by public registration and admin team creation
const createTeam = async ({ username, password, name }) => {
    username = validateUsername(username);
    name = validateName(name);
    password = validatePassword(password);

    // Case-insensitive, because player login accepts any letter case when it is unambiguous
    const usernameRe = new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (await User.exists({ username: usernameRe }))
        throw new ValidationError('Username already exists', 409);

    try {
        // password is hashed by the schema setter; Rbalance takes the schema default
        return await new User({ username, password, name, desc: ' ', ppt: ' ' }).save();
    } catch (err) {
        if (err.code === 11000) throw new ValidationError('Username already exists', 409);
        throw err;
    }
};

// Name shown to players. Some older accounts were saved without a name, so fall back to the username
const displayName = (user) => (user && (user.name || user.username)) || null;

// Safe public shape of a team: never includes password, desc or internal fields
const serializeTeam = (user) => ({
    id: user._id,
    username: user.username,
    name: user.name,
    balance: user.Rbalance,
    createdAt: user._id.getTimestamp(),
    deletedAt: user.deletedAt || null,
    status: user.deletedAt ? 'deleted' : 'active',
});

module.exports = {
    ACTIVE,
    ValidationError,
    validateUsername,
    validateName,
    validatePassword,
    createTeam,
    displayName,
    serializeTeam,
};
