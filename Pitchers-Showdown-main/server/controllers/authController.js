const { User, Token } = require('../models/user');
const jwt = require('jsonwebtoken');
const { createTeam, ValidationError } = require('../services/teamService');

const crypto = require('crypto')

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Exact match first. Otherwise ignore surrounding spaces (team creation trims them) and letter case,
// but only when exactly one account matches, so similar usernames can never be confused
const findLoginUser = async (username) => {
    const exact = await User.findOne({ username });
    if (exact) return exact;

    const trimmed = username.trim();
    if (!trimmed) return null;
    const matches = await User.find({ username: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') }).limit(2);
    return matches.length === 1 ? matches[0] : null;
};

// Login controller function with JWT
const loginUser = async (req, res) => {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const user = await findLoginUser(username);

        if (!user || user.deletedAt || !(await User.checkPassword(password, user.password))) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        await Token.findOneAndDelete({ user: user._id })
        const token = new Token({ user: user._id, token: crypto.randomBytes(128).toString('hex') }); await token.save()
        const jwtToken = jwt.sign({ token: token.token }, process.env.JWT_SECRET);

        res.status(200).json({ message: 'Login successful', jwtToken: jwtToken, name: user.name, balance: user.Rbalance,  });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Public self-registration; off unless ALLOW_PUBLIC_REGISTRATION=true. Admins create teams via /api/admin/teams
const registerUser = async (req, res) => {
    if (process.env.ALLOW_PUBLIC_REGISTRATION !== 'true') {
        return res.status(403).json({ message: 'Public registration is disabled' });
    }

    const { username, password, name } = req.body;

    try {
        await createTeam({ username, password, name });
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(error.status === 409 ? 400 : error.status).json({ message: error.message });
        }
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = { loginUser,registerUser};
