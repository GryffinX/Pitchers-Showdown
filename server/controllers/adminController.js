const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { User, Token } = require('../models/user');
const { Investment } = require('../models/pitcher');
const { AdminSession } = require('../models/admin');
const { PointAward, KINDS, ADD, pointTotals, multiplierTotals } = require('../models/points');
const leaderboard = require('./leaderboard');
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

// Game score for every active team, computed live with the leaderboard formula:
// 0.6 x (investment received / highest received) + 0.4 x (profit from investments / highest profit),
// plus the team's added points, all multiplied by its multiplier. Admin only: players never see scores.
// Deleted teams have no score.
const scoresFrom = (scoreboard) => Object.fromEntries(scoreboard.map((row, i) => [row.id, {
    value: row.finalScore,
    formula: row.formulaScore,
    points: row.points,
    multiplier: row.multiplier,
    rank: i + 1,
    received: row.IR,
    profit: row.PI,
}]));

const teamScores = async () => scoresFrom(await leaderboard.getScoreboardWithScores());

// Every value that goes into one team's score, step by step, for the team details view
const scoreCalculation = (score, board, made, multiplierCount) => {
    if (!score) return null;   // deleted teams are not scored
    const { stats, irMap } = board;
    const receivedRatio = score.received / stats.maxIR;
    const profitRatio = score.profit / stats.maxPI;
    return {
        weights: stats.weights,
        teamCount: stats.teamCount,
        totalReceived: stats.totalIR,
        averageReceived: stats.avgIR,
        maxReceived: stats.maxIR,
        maxProfit: stats.maxPI,
        received: score.received,
        profit: score.profit,
        receivedRatio,
        profitRatio,
        receivedPart: stats.weights.IR * receivedRatio,
        profitPart: stats.weights.PI * profitRatio,
        formula: score.formula,
        adminPoints: score.points,
        beforeMultiplier: score.formula + score.points,
        multiplier: score.multiplier,
        multiplierCount,
        final: score.value,
        // How the profit is made up: each investment x (that team's IR / average IR)
        profitItems: made.map(inv => {
            const targetReceived = irMap[String(inv.pitcher && inv.pitcher._id)] || 0;
            return {
                id: inv._id,
                team: inv.pitcher ? (inv.pitcher.name || inv.pitcher.username) : null,
                deleted: !!(inv.pitcher && inv.pitcher.deletedAt),
                amt: inv.amt,
                teamReceived: targetReceived,
                profit: stats.avgIR > 0 ? inv.amt * (targetReceived / stats.avgIR) : 0,
            };
        }),
    };
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

        let total, teams, scores;
        if (req.query.sort === 'score') {
            // The score is calculated, not stored, so sort and paginate in memory.
            // Deleted teams have no score and always come last.
            let all;
            [all, scores] = await Promise.all([User.find(filter), teamScores()]);
            const scoreOf = (t) => (scores[t._id.toString()] ? scores[t._id.toString()].value : null);
            all.sort((a, b) => {
                const sa = scoreOf(a), sb = scoreOf(b);
                if (sa === null || sb === null) return (sa === null) - (sb === null);
                return (sa - sb) * order || String(b._id).localeCompare(String(a._id));
            });
            total = all.length;
            teams = all.slice((page - 1) * limit, page * limit);
        } else {
            [total, teams, scores] = await Promise.all([
                User.countDocuments(filter),
                User.find(filter).sort({ [sortField]: order, _id: order }).skip((page - 1) * limit).limit(limit),
                teamScores(),
            ]);
        }

        const points = await pointTotals(teams.map(t => t._id));
        return res.json({
            teams: teams.map(t => ({
                ...serializeTeam(t),
                points: points[t._id.toString()] || 0,
                score: scores[t._id.toString()] || null,
            })),
            total, page, pages: Math.max(1, Math.ceil(total / limit)), limit,
        });
    } catch (err) {
        return sendError(res, err, 'Admin list teams');
    }
};

const getTeam = async (req, res) => {
    try {
        const team = await findTeam(req.params.id);
        const [made, received, points, multipliers, multiplierCount, board] = await Promise.all([
            Investment.find({ user: team._id }).populate('pitcher', 'name username deletedAt').lean(),
            Investment.find({ pitcher: team._id }).populate('user', 'name username deletedAt').lean(),
            pointTotals([team._id]),
            multiplierTotals([team._id]),
            PointAward.countDocuments({ team: team._id, revokedAt: null, kind: 'multiply' }),
            leaderboard.getScoreboard(),
        ]);
        const scores = scoresFrom(board.scoreboard);

        const describe = (other) => other
            ? { id: other._id, name: other.name, username: other.username, deleted: !!other.deletedAt }
            : null;

        return res.json({
            team: {
                ...serializeTeam(team),
                points: points[team._id.toString()] || 0,
                multiplier: multipliers[team._id.toString()] ?? 1,
                score: scores[team._id.toString()] || null,
            },
            rankedTeams: Object.keys(scores).length,
            calculation: scoreCalculation(scores[team._id.toString()], board, made, multiplierCount),
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

// --- Reverting investments ---

// direction 'received': investments other teams made into this team (each investor is refunded)
// direction 'made': investments this team made into others (this team is refunded)
const REVERT_SIDE = { received: 'pitcher', made: 'user' };

const revertInvestments = (direction) => async (req, res) => {
    try {
        const body = req.body || {};
        const team = await findTeam(req.params.id);
        if (body.confirmUsername !== team.username)
            throw new ValidationError('Confirmation username does not match this team');

        const ids = body.investmentIds;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every(id => typeof id === 'string' && mongoose.isValidObjectId(id)))
            throw new ValidationError('Choose at least one investment to revert');

        const refunds = {};   // investor id -> amount given back
        let reverted = 0;
        for (const id of [...new Set(ids)]) {
            // Deleting first means two admins reverting at once can never refund the same investment twice
            const inv = await Investment.findOneAndDelete({ _id: id, [REVERT_SIDE[direction]]: team._id });
            if (!inv) continue;   // already reverted, or not on this side of this team
            try {
                await User.updateOne({ _id: inv.user }, { $inc: { Rbalance: inv.amt } });
            } catch (err) {
                await Investment.collection.insertOne(inv.toObject());   // put it back so nothing is lost
                throw err;
            }
            refunds[inv.user] = (refunds[inv.user] || 0) + inv.amt;
            reverted++;
        }

        const investors = await User.find({ _id: { $in: Object.keys(refunds) } }).select('name username Rbalance');
        return res.json({
            reverted,
            skipped: new Set(ids).size - reverted,
            refunded: Object.values(refunds).reduce((a, b) => a + b, 0),
            refunds: investors.map(u => ({ id: u._id, name: u.name || u.username, username: u.username, amount: refunds[u._id], balance: u.Rbalance })),
        });
    } catch (err) {
        return sendError(res, err, `Admin revert ${direction} investments`);
    }
};

// --- Points ---

// Bonus entries sit on the same scale as the formula score (0 to 1). Decimals are allowed.
//   add:      each entry, and the team's total of active add entries, between -1 and 1 (not 0)
//   multiply: each entry between -1 and 1 (0 allowed: it zeroes the score); the product of
//             several stays within -1..1 by itself
const MAX_POINTS = 1;
const MAX_REASON = 120;
const EPSILON = 1e-9;   // tolerance for floating-point sums such as 0.1 + 0.2

const validateKind = (value) => {
    if (value === undefined) return 'add';
    if (!KINDS.includes(value)) throw new ValidationError('Kind must be "add" or "multiply"');
    return value;
};

const validatePoints = (value, kind = 'add') => {
    const zeroOk = kind === 'multiply';
    if (typeof value !== 'number' || !Number.isFinite(value) || (value === 0 && !zeroOk) || Math.abs(value) > MAX_POINTS)
        throw new ValidationError(kind === 'multiply'
            ? `Multiplier must be a number between -${MAX_POINTS} and ${MAX_POINTS}`
            : `Points must be a number between -${MAX_POINTS} and ${MAX_POINTS}, not 0`);
    return value;
};

// Sum of the team's active add entries (multipliers are not part of the total)
const activeTotal = async (teamId, excludeId) => {
    const match = { team: teamId, revokedAt: null, ...ADD };
    if (excludeId) match._id = { $ne: excludeId };
    const [row] = await PointAward.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$points' } } }]);
    return row ? row.total : 0;
};

// Refuse a change that takes the team's total outside -1..1 (or further outside, for older data)
const checkTotal = (before, after) => {
    if (Math.abs(after) > MAX_POINTS + EPSILON && Math.abs(after) > Math.abs(before) + EPSILON)
        throw new ValidationError(`This would make the team's total bonus ${Number(after.toFixed(6))}; it must stay between -${MAX_POINTS} and ${MAX_POINTS}`);
};

const validateReason = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.trim().length > MAX_REASON)
        throw new ValidationError(`Reason must be at most ${MAX_REASON} characters`);
    return value.trim();
};

const kindOf = (award) => award.kind || 'add';

const serializeAward = (award) => ({
    id: award._id,
    kind: kindOf(award),
    points: award.points,
    reason: award.reason || '',
    createdAt: award.createdAt,
    editedAt: award.editedAt || null,
    revoked: !!award.revokedAt,
    revokedAt: award.revokedAt || null,
});

const pointsResponse = async (team) => {
    const awards = await PointAward.find({ team: team._id }).sort({ createdAt: -1, _id: -1 });
    const active = awards.filter(a => !a.revokedAt);
    return {
        team: serializeTeam(team),
        total: active.filter(a => kindOf(a) === 'add').reduce((sum, a) => sum + a.points, 0),
        multiplier: active.filter(a => kindOf(a) === 'multiply').reduce((product, a) => product * a.points, 1),
        awards: awards.map(serializeAward),
    };
};

const listPoints = async (req, res) => {
    try {
        const team = await findTeam(req.params.id);
        return res.json(await pointsResponse(team));
    } catch (err) {
        return sendError(res, err, 'Admin list points');
    }
};

const awardPoints = async (req, res) => {
    try {
        const body = req.body || {};
        const team = await findTeam(req.params.id);
        if (team.deletedAt) throw new ValidationError('Deleted teams cannot get points', 409);

        const kind = validateKind(body.kind);
        const points = validatePoints(body.points, kind);
        const reason = validateReason(body.reason);
        if (kind === 'add') {
            const before = await activeTotal(team._id);
            checkTotal(before, before + points);
        }

        await PointAward.create({ team: team._id, kind, points, reason });
        return res.status(201).json(await pointsResponse(team));
    } catch (err) {
        return sendError(res, err, 'Admin award points');
    }
};

const POINT_FIELDS = ['points', 'reason', 'revoked'];

// Edit an award's value or reason, or revoke / restore it
const updatePoints = async (req, res) => {
    try {
        const body = req.body || {};
        const unknown = Object.keys(body).filter(key => !POINT_FIELDS.includes(key));
        if (unknown.length) throw new ValidationError(`Field(s) cannot be edited: ${unknown.join(', ')}`);
        if (!Object.keys(body).length) throw new ValidationError('Nothing to update');
        if ('revoked' in body && typeof body.revoked !== 'boolean') throw new ValidationError('revoked must be true or false');

        if (!mongoose.isValidObjectId(req.params.awardId)) throw new ValidationError('Invalid points entry id');
        const award = await PointAward.findById(req.params.awardId);
        if (!award) throw new ValidationError('Points entry not found', 404);

        const team = await findTeam(award.team);
        if (team.deletedAt) throw new ValidationError('Points of deleted teams cannot be changed', 409);

        // The kind can't be changed: revoke the entry and add a new one instead
        const kind = kindOf(award);
        const points = 'points' in body ? validatePoints(body.points, kind) : award.points;
        const reason = 'reason' in body ? validateReason(body.reason) : award.reason;

        if (kind === 'add') {
            const wasActive = !award.revokedAt;
            const willBeActive = typeof body.revoked === 'boolean' ? !body.revoked : wasActive;
            const others = await activeTotal(team._id, award._id);
            checkTotal(others + (wasActive ? award.points : 0), others + (willBeActive ? points : 0));
        }

        if (points !== award.points || reason !== award.reason) {
            award.points = points;
            award.reason = reason;
            award.editedAt = new Date();
        }
        if (body.revoked === true && !award.revokedAt) award.revokedAt = new Date();
        if (body.revoked === false) award.revokedAt = null;
        await award.save();

        return res.json(await pointsResponse(team));
    } catch (err) {
        return sendError(res, err, 'Admin update points');
    }
};

module.exports = {
    login, logout, me, stats,
    listTeams, getTeam, createTeam: createTeamHandler, updateTeam, resetPassword, deleteTeam,
    listPoints, awardPoints, updatePoints,
    revertReceived: revertInvestments('received'),
    revertMade: revertInvestments('made'),
};
