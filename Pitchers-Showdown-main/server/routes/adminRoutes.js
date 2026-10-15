const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const { is_admin } = require('../middleware/adminAuth');
const { rateLimit } = require('../middleware/rateLimit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Try again in a few minutes.',
});

router.post('/login', loginLimiter, admin.login);

// Everything below requires a valid admin session
router.use(is_admin);

router.post('/logout', admin.logout);
router.get('/me', admin.me);
router.get('/stats', admin.stats);

router.get('/teams', admin.listTeams);
router.post('/teams', admin.createTeam);
router.get('/teams/:id', admin.getTeam);
router.patch('/teams/:id', admin.updateTeam);
router.post('/teams/:id/reset-password', admin.resetPassword);
router.delete('/teams/:id', admin.deleteTeam);

module.exports = router;
