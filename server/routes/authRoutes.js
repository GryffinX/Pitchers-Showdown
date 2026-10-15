const express = require('express');
const router = express.Router();
const { loginUser, registerUser, logoutUser } = require('../controllers/authController');
const { is_auth } = require('../middleware/middleware');

router.post('/login', loginUser);
router.post('/register', registerUser);
router.post('/logout', is_auth, logoutUser);

module.exports = router;