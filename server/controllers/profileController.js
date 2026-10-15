const { User } = require('../models/user')
const { Investment } = require('../models/pitcher');
const { displayName } = require('../services/teamService');

// Only the other team's display name and whether it was removed; never other account fields
const describe = (inv, other) => ({
    amt: inv.amt,
    team: displayName(other),
    teamDeleted: !other || !!other.deletedAt,
});

let profile = async (req, res) => {
    try {
        const userSession = req.session && req.session.user;
        // Only the investments this team made. Who invested in a team, and how much, stays hidden from players.
        const [user, made] = await Promise.all([
            User.findById(userSession._id).select('name username Rbalance').lean(),
            Investment.find({ user: userSession._id }).populate('pitcher', 'name username deletedAt').lean(),
        ]);

        return res.json({
            name: displayName(user),
            balance: user ? user.Rbalance : userSession.Rbalance,
            investments: made.map(inv => describe(inv, inv.pitcher)),
        });
    } catch (err) {
        console.error('Profile error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { profile };
