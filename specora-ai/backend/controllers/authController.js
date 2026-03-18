const User = require('../models/User');
const { sendOTPEmail } = require('../services/emailService');
const bcrypt = require('bcryptjs');

// Helper to generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

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
    // Expiry: 10 minutes from now
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

    if (user) {
      // Update unverified user with new details and OTP
      user.name = name;
      user.password = hashedPassword;
      user.otp = otp;
      user.otpExpiry = otpExpiry;
    } else {
      // Create new unverified user
      user = new User({ email, name, password: hashedPassword, otp, otpExpiry });
    }

    await user.save();
    
    // Send email
    await sendOTPEmail(email, otp, name);

    res.status(200).json({ message: 'OTP sent successfully to ' + email });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during signup' });
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

    if (user.otp !== otp) {
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

    // Return user data (could also return a JWT token here)
    const userData = { id: user._id, email: user.email, name: user.name };
    res.status(200).json({ message: 'Email verified successfully', user: userData });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Server error during OTP verification' });
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

    // Login successful
    const userData = { id: user._id, email: user.email, name: user.name };
    res.status(200).json({ message: 'Login successful', user: userData });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};
