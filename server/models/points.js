const mongoose = require('mongoose');

// Bonus entries an admin gives a team by hand. Two kinds:
//   add      - points added to the score (negative takes away)
//   multiply - the score is multiplied by this value
// final score = (formula + sum of add entries) x product of multiply entries
// An entry is never deleted: revoking sets revokedAt, so it can be restored later.
// Entries saved before multiply existed have no kind and count as add.
const KINDS = ['add', 'multiply'];

const PointAwardSchema = new mongoose.Schema({
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: KINDS, default: 'add' },
    points: { type: Number, required: true },
    reason: { type: String, default: '' },
    revokedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },   // last change to points or reason (revoke/restore doesn't count)
}, { timestamps: true });

const PointAward = mongoose.model('PointAward', PointAwardSchema);

const ADD = { kind: { $ne: 'multiply' } };   // includes older entries without a kind

// { teamId: sum of active add entries } for the given teams
const pointTotals = async (teamIds) => {
    const rows = await PointAward.aggregate([
        { $match: { team: { $in: teamIds }, revokedAt: null, ...ADD } },
        { $group: { _id: '$team', total: { $sum: '$points' } } },
    ]);
    return Object.fromEntries(rows.map(r => [r._id.toString(), r.total]));
};

// { teamId: product of active multiply entries } for the given teams; teams without any are left out (x1)
const multiplierTotals = async (teamIds) => {
    const rows = await PointAward.find({ team: { $in: teamIds }, revokedAt: null, kind: 'multiply' }).select('team points').lean();
    const result = {};
    rows.forEach(r => { result[r.team.toString()] = (result[r.team.toString()] ?? 1) * r.points; });
    return result;
};

module.exports = { PointAward, KINDS, ADD, pointTotals, multiplierTotals };
