const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { User, Token } = require('../models/user');
const { Investment } = require('../models/pitcher');
const { AdminSession } = require('../models/admin');
const { adminConfig, ADMIN_AUDIENCE, ADMIN_TOKEN_TTL_SECONDS } = require('../middleware/adminAuth');
const {
    ACTIVE, ValidationError, validateName, validatePassword, createTeam, serializeTeam,
} = require('../services/teamService');

const STARTING_BALANCE = User.schema.path('Rbalance').defaultValue;

const sendError = (res, err, context) => {
    if (err instanceof ValidationError) return res.status(err.status).json({ error: err.message });
    console.error(`${context} error:`, err);
    return res.status(500).json({ error: 'Internal server error' });
};

const sameString = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPositiveInt = (value, fallback, max) => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return max ? Math.min(n, max) : n;
};

const findTeam = async (id) => {
    if (!mongoose.isValidObjectId(id)) throw new ValidationError('Invalid team id');
    const team = await User.findById(id);
    if (!team) throw new ValidationError('Team not found', 404);
    return team;
};

// --- Session ---

const login = async (req, res) => {
    const config = adminConfig();
    if (!config) return res.status(503).json({ error: 'Admin access is not configured' });

    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
        return res.status(400).json({ error: 'Username and password are required' });

    try {
        // Always run bcrypt so a wrong username takes as long as a wrong password
        const passwordOk = await bcrypt.compare(password, config.passwordHash);
        const usernameOk = sameString(username, config.username);

        if (!passwordOk || !usernameOk) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }

        const jti = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + ADMIN_TOKEN_TTL_SECONDS * 1000);
        const token = jwt.sign({ role: 'admin', jti }, config.secret, {
            subject: config.username,
            audience: ADMIN_AUDIENCE,
            expiresIn: ADMIN_TOKEN_TTL_SECONDS,
            algorithm: 'HS256',
        });
        await AdminSession.create({ jti, admin: config.username, expiresAt });

        return res.json({ token, admin: { username: config.username }, expiresAt });
    } catch (err) {
        return sendError(res, err, 'Admin login');
    }
};

const logout = async (req, res) => {
    try {
        await AdminSession.deleteOne({ jti: req.admin.jti });
        return res.json({ message: 'Logged out' });
    } catch (err) {
        return sendError(res, err, 'Admin logout');
    }
};

const me = (req, res) => res.json({ admin: { username: req.admin.username }, expiresAt: req.admin.expiresAt });

// --- Dashboard ---

const stats = async (req, res) => {
    try {
        const [activeTeams, deletedTeams, balanceAgg, investmentAgg, investors, recentTeams] = await Promise.all([
            User.countDocuments(ACTIVE),
            User.countDocuments({ deletedAt: { $ne: null } }),
            User.aggregate([{ $match: ACTIVE }, { $group: { _id: null, total: { $sum: '$Rbalance' } } }]),
            Investment.aggregate([{ $group: { _id: null, total: { $sum: '$amt' }, count: { $sum: 1 } } }]),
            Investment.distinct('user'),
            User.find(ACTIVE).sort({ _id: -1 }).limit(5),
        ]);

        return res.json({
            startingBalance: STARTING_BALANCE,
            activeTeams,
            deletedTeams,
            totalRemainingBalance: balanceAgg[0] ? balanceAgg[0].total : 0,
            totalInvested: investmentAgg[0] ? investmentAgg[0].total : 0,
            investmentCount: investmentAgg[0] ? investmentAgg[0].count : 0,
            teamsThatInvested: investors.length,
            recentTeams: recentTeams.map(serializeTeam),
        });
    } catch (err) {
        return sendError(res, err, 'Admin stats');
    }
};

// --- Teams ---

const SORT_FIELDS = { name: 'name', username: 'username', balance: 'Rbalance', createdAt: '_id' };

const listTeams = async (req, res) => {
    try {
        const page = toPositiveInt(req.query.page, 1);
        const limit = toPositiveInt(req.query.limit, 20, 100);
        const sortField = SORT_FIELDS[req.query.sort] || '_id';
        const order = req.query.order === 'asc' ? 1 : -1;

        const filter = {};
        if (req.query.status === 'deleted') filter.deletedAt = { $ne: null };
        else if (req.query.status !== 'all') Object.assign(filter, ACTIVE);

        const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
        if (q) {
            const re = new RegExp(escapeRegex(q), 'i');
            filter.$or = [{ name: re }, { username: re }];
        }

        const [total, teams] = await Promise.all([
            User.countDocuments(filter),
            User.find(filter).sort({ [sortField]: order, _id: order }).skip((page - 1) * limit).limit(limit),
        ]);

        return res.json({ teams: teams.map(serializeTeam), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
    } catch (err) {
        return sendError(res, err, 'Admin list teams');
    }
};

const getTeam = async (req, res) => {
    try {
        const team = await findTeam(req.params.id);
        const [made, received] = await Promise.all([
            Investment.find({ user: team._id }).populate('pitcher', 'name username deletedAt').lean(),
            Investment.find({ pitcher: team._id }).populate('user', 'name username deletedAt').lean(),
        ]);

        const describe = (other) => other
            ? { id: other._id, name: other.name, username: other.username, deleted: !!other.deletedAt }
            : null;

        return res.json({
            team: serializeTeam(team),
            investmentsMade: made.map(inv => ({ id: inv._id, amt: inv.amt, team: describe(inv.pitcher) })),
            investmentsReceived: received.map(inv => ({ id: inv._id, amt: inv.amt, team: describe(inv.user) })),
            totalInvested: made.reduce((sum, inv) => sum + inv.amt, 0),
            totalReceived: received.reduce((sum, inv) => sum + inv.amt, 0),
        });
    } catch (err) {
        return sendError(res, err, 'Admin get team');
    }
};

const createTeamHandler = async (req, res) => {
    const { username, password, name } = req.body || {};
    try {
        const team = await createTeam({ username, password, name });
        return res.status(201).json({ team: serializeTeam(team) });
    } catch (err) {
        return sendError(res, err, 'Admin create team');
    }
};

const EDITABLE_FIELDS = ['name'];

const updateTeam = async (req, res) => {
    try {
        const body = req.body || {};
        const unknown = Object.keys(body).filter(key => !EDITABLE_FIELDS.includes(key));
        if (unknown.length) throw new ValidationError(`Field(s) cannot be edited: ${unknown.join(', ')}`);
        if (!('name' in body)) throw new ValidationError('Nothing to update');

        const team = await findTeam(req.params.id);
        if (team.deletedAt) throw new ValidationError('Deleted teams cannot be edited', 409);

        const name = validateName(body.name);
        if (name === team.name) return res.json({ team: serializeTeam(team) });

        team.name = name;
        await team.save();
        return res.json({ team: serializeTeam(team) });
    } catch (err) {
        return sendError(res, err, 'Admin update team');
    }
};

const resetPassword = async (req, res) => {
    try {
        const team = await findTeam(req.params.id);
        if (team.deletedAt) throw new ValidationError('Deleted teams cannot be modified', 409);

        team.password = validatePassword((req.body || {}).password);
        await team.save();
        // Sign the team out everywhere: is_auth requires a matching Token document
        await Token.deleteMany({ user: team._id });

        return res.json({ message: 'Password reset' });
    } catch (err) {
        return sendError(res, err, 'Admin reset password');
    }
};

// Soft delete: investments made and received are kept so balances and scores stay consistent
const deleteTeam = async (req, res) => {
    try {
        const team = await findTeam(req.params.id);
        if (team.deletedAt) throw new ValidationError('Team is already deleted', 409);

        // Guards against acting on a stale or mistaken selection in the UI
        if ((req.body || {}).confirmUsername !== team.username)
            throw new ValidationError('Confirmation username does not match this team');

        team.deletedAt = new Date();
        await team.save();
        await Token.deleteMany({ user: team._id });

        return res.json({ team: serializeTeam(team) });
    } catch (err) {
        return sendError(res, err, 'Admin delete team');
    }
};

module.exports = {
    login, logout, me, stats,
    listTeams, getTeam, createTeam: createTeamHandler, updateTeam, resetPassword, deleteTeam,
};
