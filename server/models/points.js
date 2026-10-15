const mongoose = require('mongoose');

// Points an admin gives a team by hand (or takes away, with a negative value).
// An award is never deleted: revoking sets revokedAt, so it can be restored later.
// A team's total is the sum of its awards that are not revoked.
const PointAwardSchema = new mongoose.Schema({
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    points: { type: Number, required: true },
    reason: { type: String, default: '' },
    revokedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },   // last change to points or reason (revoke/restore doesn't count)
}, { timestamps: true });

const PointAward = mongoose.model('PointAward', PointAwardSchema);

// { teamId: total } for the given teams, counting only awards that are not revoked
const pointTotals = async (teamIds) => {
    const rows = await PointAward.aggregate([
        { $match: { team: { $in: teamIds }, revokedAt: null } },
        { $group: { _id: '$team', total: { $sum: '$points' } } },
    ]);
    return Object.fromEntries(rows.map(r => [r._id.toString(), r.total]));
};

module.exports = { PointAward, pointTotals };
