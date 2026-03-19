const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Signup - Request OTP
router.post('/signup', authController.signup);

// Signup - Verify OTP
router.post('/verify-otp', authController.verifyOtp);

// Login
router.post('/login', authController.login);

// Forgot password
router.post('/forgot-password', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
