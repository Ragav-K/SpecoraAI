const User = require('../models/User');
const { sendOTPEmail, sendPasswordResetEmail } = require('../services/emailService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_SECRET } = require('../config/jwt');

// Helper to generate 6-digit OTP.
// SECURITY: crypto.randomInt, not Math.random — Math.random is a predictable
// PRNG and its output can be reconstructed from observed values.
const generateOTP = () => String(crypto.randomInt(100000, 1000000));

const signToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '12h' });

const formatUser = (user) => ({ id: user._id, email: user.email, name: user.name });

const hashValue = async (value) => bcrypt.hash(value, 10);

const verifyHashedValue = async (plain, hash) => {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
};

// ── Signup ────────────────────────────────────────────────────────┐
exports.signup = async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    let user = await User.findOne({ email });

    if (user && user.isVerified) {
      return res.status(400).json({ error: 'User already exists and is verified. Please log in.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate new OTP
    const otp = generateOTP();
    const hashedOtp = await hashValue(otp);
    // Expiry: 10 minutes from now
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

    if (user) {
      // Update unverified user with new details and OTP
      user.name = name;
      user.password = hashedPassword;
      user.otp = hashedOtp;
      user.otpExpiry = otpExpiry;
    } else {
      // Create new unverified user
      user = new User({ email, name, password: hashedPassword, otp: hashedOtp, otpExpiry });
    }

    await user.save();
    
    // Send email
    await sendOTPEmail(email, otp, name);

    res.status(200).json({ message: 'OTP sent successfully to ' + email });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Verify Signup OTP ─────────────────────────────────────────────┐
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: 'User is already verified. Please log in.' });
    }

    if (!user.otp || !(await verifyHashedValue(otp, user.otp))) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // OTP is valid
    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    const token = signToken(user);
    const userData = formatUser(user);
    res.status(200).json({ message: 'Email verified successfully', user: userData, token });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Login ─────────────────────────────────────────────────────────┐
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });

    // SECURITY: unknown email and wrong password must be indistinguishable, or
    // the endpoint becomes a registered-user oracle. Always run a bcrypt
    // comparison so the response time does not leak account existence either.
    const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const isMatch = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ error: 'Account not verified. Please sign up again to receive a new code.' });
    }

    const userData = formatUser(user);
    const token = signToken(user);
    res.status(200).json({ message: 'Login successful', user: userData, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Forgot Password: Request OTP ────────────────────────────────┐
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email });

    // SECURITY: always answer identically. Revealing "no verified account with
    // this email" turns password reset into a user-enumeration oracle.
    const genericResponse = {
      message: 'If an account exists for that email, a password reset code has been sent.',
    };

    if (!user || !user.isVerified) {
      return res.status(200).json(genericResponse);
    }

    const otp = generateOTP();
    const hashedOtp = await hashValue(otp);
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

    user.resetOtp = hashedOtp;
    user.resetOtpExpiry = otpExpiry;
    await user.save();

    // SECURITY: a send failure must not change the response. Otherwise a known
    // address (500) is still distinguishable from an unknown one (200).
    try {
      await sendPasswordResetEmail(email, otp, user.name);
    } catch (mailError) {
      console.error('Password reset email failed to send:', mailError.message);
    }

    res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Forgot Password: Reset ──────────────────────────────────────┐
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const user = await User.findOne({ email });

    // SECURITY: same generic failure whether the account is absent, unverified,
    // or the code is simply wrong.
    if (!user || !user.isVerified) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    if (!user.resetOtp || !(await verifyHashedValue(otp, user.resetOtp))) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    if (!user.resetOtpExpiry || new Date() > user.resetOtpExpiry) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new code.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
