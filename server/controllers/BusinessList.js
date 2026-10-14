const mongoose = require('mongoose');
const { User, Token } = require('../models/user')
const { Investment } = require('../models/pitcher');
const jwt = require('jsonwebtoken');
const { ACTIVE, displayName } = require('../services/teamService');

const BusinessList = async (req, res) => {
  try {
    res.json({
      teams: (await User.find(ACTIVE)).map(pitcher => ({
        id: pitcher._id,
        team_name: displayName(pitcher),
      }))})
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

const BusinessInfo = async (req, res) => {
  try {
    const teamId = req.params.id;
    const pitcher = mongoose.isValidObjectId(teamId) ? await User.findById(teamId) : null;

    if (pitcher && !pitcher.deletedAt) {
      res.json({
        team_name: displayName(pitcher),
        team_content: pitcher.desc,
        link: pitcher.ppt,
      });
    } else {
      res.status(404).json({ error: 'Team not found' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


const makeInvestment = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userSession = req.session && req.session.user;
    const pitcher = mongoose.isValidObjectId(teamId) ? await User.findById(teamId) : null;
    if (!pitcher || pitcher.deletedAt) {
      return res.status(404).json({ error: 'Team/User not found' });
    }
    if (userSession._id.toString() === pitcher._id.toString()) {
      return res.status(412).json({ error: 'Cannot invest in your own team' });
    }

    const amt = (req.body || {})['amt'];
    if (typeof amt !== 'number' || !Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' })

    const prevInvest = await Investment.findOne({ user: userSession._id, pitcher: pitcher._id });
    if (prevInvest) {
      return res.status(412).json({ error: 'An investment has already been made' });
    }

    // Check and deduct in one atomic update so parallel requests cannot overspend the purse
    const user = await User.findOneAndUpdate(
      { _id: userSession._id, ...ACTIVE, Rbalance: { $gte: amt } },
      { $inc: { Rbalance: -amt } },
      { new: true }
    );
    if (!user) return res.status(400).json({ error: 'Insufficient Balance' });

    try {
      await Investment({ user: user._id, pitcher: pitcher._id, amt }).save();
    } catch (err) {
      await User.updateOne({ _id: user._id }, { $inc: { Rbalance: amt } });
      throw err;
    }

    return res.json({ message: 'Investment successful', amt, team: displayName(pitcher), balance: user.Rbalance });
  } catch (error) {
    console.error('Investment error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


module.exports = { BusinessList, BusinessInfo, makeInvestment };