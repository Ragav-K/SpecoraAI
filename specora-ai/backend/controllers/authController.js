const User = require('../models/User');
const { sendOTPEmail, sendPasswordResetEmail } = require('../services/emailService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper to generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const JWT_SECRET = process.env.JWT_SECRET || 'specora-dev-secret';

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

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email. Please sign up.' });
    }

    if (!user.isVerified) {
      return res.status(400).json({ error: 'Account not verified. Please sign up again to receive a new code.' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials. Password is incorrect.' });
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

    if (!user || !user.isVerified) {
      return res.status(404).json({ error: 'No verified account found with this email' });
    }

    const otp = generateOTP();
    const hashedOtp = await hashValue(otp);
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

    user.resetOtp = hashedOtp;
    user.resetOtpExpiry = otpExpiry;
    await user.save();

    await sendPasswordResetEmail(email, otp, user.name);

    res.status(200).json({ message: 'Password reset code sent to ' + email });
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

    if (!user || !user.isVerified) {
      return res.status(404).json({ error: 'No verified account found with this email' });
    }

    if (!user.resetOtp || !(await verifyHashedValue(otp, user.resetOtp))) {
      return res.status(400).json({ error: 'Invalid OTP' });
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
