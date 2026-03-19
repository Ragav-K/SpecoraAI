/**
 * Specora AI — Authentication Logic
 */
const Auth = (() => {
  let mode = 'login'; // 'login' | 'signup'
  let currentEmail = '';
  let forgotStep = 'email'; // 'email' | 'reset'
  let forgotEmail = '';

  function getStoredSession() {
    const raw = localStorage.getItem('specora_session');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      localStorage.removeItem('specora_session');
      return null;
    }
  }

  function persistSession(user, token) {
    localStorage.setItem('specora_session', JSON.stringify({ user, token }));
  }

  // ── Initialization ──
  function init() {
    // If already logged in, redirect to app
    if (getStoredSession()) {
      window.location.href = 'index.html';
      return;
    }

    setupOtpInputs();
    switchTab('login');
  }

  // ── UI State ──
  function switchTab(newMode) {
    mode = newMode;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');

    const nameGroup = document.getElementById('name-group');
    const nameInput = document.getElementById('name-input');
    const confirmPasswordGroup = document.getElementById('confirm-password-group');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const btnText = document.getElementById('btn-text');
    const forgotLink = document.getElementById('forgot-link');

    if (mode === 'signup') {
      nameGroup.style.display = 'block';
      nameInput.required = true;
      confirmPasswordGroup.style.display = 'block';
      confirmPasswordInput.required = true;
      title.textContent = 'Create an account';
      subtitle.textContent = 'Enter your details to get started';
      btnText.textContent = 'Create Account';
      if (forgotLink) forgotLink.style.display = 'none';
    } else {
      nameGroup.style.display = 'none';
      nameInput.required = false;
      confirmPasswordGroup.style.display = 'none';
      confirmPasswordInput.required = false;
      title.textContent = 'Welcome back';
      subtitle.textContent = 'Enter your email to sign in';
      btnText.textContent = 'Sign In';
      if (forgotLink) forgotLink.style.display = 'flex';
    }
  }

  function goBack() {
    document.getElementById('view-verify').style.display = 'none';
    document.getElementById('view-form').style.display = 'block';
  }

  function openForgotPassword() {
    resetForgotView(true);
    const loginEmail = document.getElementById('email-input').value.trim();
    if (loginEmail) {
      document.getElementById('forgot-email-input').value = loginEmail;
    }
    document.getElementById('view-form').style.display = 'none';
    document.getElementById('view-verify').style.display = 'none';
    document.getElementById('view-forgot').style.display = 'block';
    document.getElementById('forgot-email-input').focus();
  }

  function exitForgotPassword() {
    resetForgotView();
    document.getElementById('view-forgot').style.display = 'none';
    document.getElementById('view-verify').style.display = 'none';
    document.getElementById('view-form').style.display = 'block';
  }

  function resetForgotView(keepEmail = false) {
    forgotStep = 'email';
    forgotEmail = '';
    const emailInput = document.getElementById('forgot-email-input');
    const newPasswordInput = document.getElementById('forgot-new-password-input');
    const confirmPasswordInput = document.getElementById('forgot-confirm-password-input');
    if (!keepEmail) {
      emailInput.value = '';
    }
    emailInput.readOnly = false;
    document.getElementById('forgot-subtitle').textContent = 'Enter your email to receive a reset code.';
    document.getElementById('forgot-otp-section').style.display = 'none';
    document.getElementById('forgot-password-section').style.display = 'none';
    newPasswordInput.value = '';
    confirmPasswordInput.value = '';
    newPasswordInput.required = false;
    confirmPasswordInput.required = false;
    document
      .querySelectorAll('#forgot-otp-section .otp-input')
      .forEach((input) => (input.value = ''));
    const submitText = document.getElementById('forgot-submit-text');
    if (submitText) submitText.textContent = 'Send Reset Code';
  }

  // ── Handlers ──
  async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('email-input').value.trim();
    const name = document.getElementById('name-input').value.trim();
    const password = document.getElementById('password-input').value;
    const confirmPassword = document.getElementById('confirm-password-input').value;
    
    currentEmail = email;

    if (mode === 'signup' && password !== confirmPassword) {
      showNotif('Passwords do not match', '!');
      return;
    }

    const btnText = document.getElementById('btn-text');
    const spinner = document.getElementById('btn-spinner');
    const submitBtn = document.getElementById('submit-btn');

    try {
      setLoading(submitBtn, btnText, spinner, true);

      if (mode === 'signup') {
        await signup(email, name, password);
        // Success — show OTP view
        document.getElementById('view-form').style.display = 'none';
        document.getElementById('view-verify').style.display = 'block';
        document.getElementById('verify-email-display').textContent = email;
        setTimeout(() => document.querySelector('#view-verify .otp-input')?.focus(), 100);
        showNotif(`Verification code sent to ${email}`, '✉');
      } else {
        const data = await login(email, password);
        persistSession(data.user, data.token);
        showNotif('Login successful! Redirecting...', '✓');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1000);
      }
    } catch (error) {
      showNotif(error.message, '!');
    } finally {
      const resetText = mode === 'signup' ? 'Create Account' : 'Sign In';
      setLoading(submitBtn, btnText, spinner, false, resetText);
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();

    const emailInput = document.getElementById('forgot-email-input');
    const email = emailInput.value.trim().toLowerCase();
    const submitBtn = document.getElementById('forgot-submit-btn');
    const btnText = document.getElementById('forgot-submit-text');
    const spinner = document.getElementById('forgot-spinner');
    const otpInputs = document.querySelectorAll('#forgot-otp-section .otp-input');
    const newPasswordInput = document.getElementById('forgot-new-password-input');
    const confirmPasswordInput = document.getElementById('forgot-confirm-password-input');

    if (!email) {
      showNotif('Please enter your email', '!');
      return;
    }

    try {
      setLoading(submitBtn, btnText, spinner, true);

      if (forgotStep === 'email') {
        await API.requestPasswordReset(email);
        forgotEmail = email;
        forgotStep = 'reset';
        document.getElementById('forgot-subtitle').textContent = `Enter the code sent to ${email} and choose a new password.`;
        document.getElementById('forgot-otp-section').style.display = 'block';
        document.getElementById('forgot-password-section').style.display = 'block';
        newPasswordInput.required = true;
        confirmPasswordInput.required = true;
        otpInputs.forEach((input) => (input.value = ''));
        emailInput.readOnly = true;
        showNotif(`Reset code sent to ${email}`, '✉');
        setTimeout(() => document.querySelector('#forgot-otp-section .otp-input')?.focus(), 100);
      } else {
        if (email !== forgotEmail) {
          showNotif('Email changed. Please request a new code.', '!');
          resetForgotView();
          return;
        }

        let otp = '';
        otpInputs.forEach((input) => (otp += input.value));

        if (otp.length !== 6) {
          showNotif('Please enter all 6 digits', '!');
          return;
        }

        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (newPassword !== confirmPassword) {
          showNotif('Passwords do not match', '!');
          return;
        }

        if (newPassword.length < 6) {
          showNotif('Password must be at least 6 characters', '!');
          return;
        }

        await API.resetPassword(email, otp, newPassword);
        showNotif('Password updated. Please sign in.', '✓');
        exitForgotPassword();
        document.getElementById('email-input').value = email;
        document.getElementById('password-input').value = '';
        mode = 'login';
        switchTab('login');
        document.getElementById('password-input').focus();
      }
    } catch (error) {
      showNotif(error.message, '!');
      if (forgotStep === 'reset') {
        otpInputs.forEach((input) => (input.value = ''));
        document.querySelector('#forgot-otp-section .otp-input')?.focus();
      }
    } finally {
      const nextText = forgotStep === 'reset' ? 'Update Password' : 'Send Reset Code';
      setLoading(submitBtn, btnText, spinner, false, nextText);
    }
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    
    // Gather OTP from inputs
    const inputs = document.querySelectorAll('#view-verify .otp-input');
    let otp = '';
    inputs.forEach(input => otp += input.value);

    if (otp.length !== 6) {
      showNotif('Please enter all 6 digits', '!');
      return;
    }

    const btnText = document.getElementById('verify-text');
    const spinner = document.getElementById('verify-spinner');
    const verifyBtn = document.getElementById('verify-btn');

    try {
      setLoading(verifyBtn, btnText, spinner, true);

      let data;
      if (mode === 'signup') {
        data = await API.verifyOtp(currentEmail, otp);
      } else {
        // Can fallback to this if login requires OTP in the future, 
        // but for now mode === login shouldn't reach here since we redirect immediately
        throw new Error('Invalid authentication flow state');
      }

      // Success — save session and redirect
      persistSession(data.user, data.token);
      showNotif('Verified! Redirecting...', '✓');
      
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1000);

    } catch (error) {
      showNotif(error.message, '!');
      // Clear inputs on error so user can try again
      inputs.forEach(input => input.value = '');
      inputs[0].focus();
    } finally {
      if (btnText) setLoading(verifyBtn, btnText, spinner, false, 'Verify & Proceed');
    }
  }

  async function resendOtp() {
    const resendBtn = document.getElementById('resend-btn');
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';

    try {
      if (mode === 'signup') {
        const name = document.getElementById('name-input').value.trim();
        const password = document.getElementById('password-input').value;
        await signup(currentEmail, name, password);
      }
      showNotif('New verification code sent', '✓');
      
      let countdown = 60;
      const interval = setInterval(() => {
        countdown--;
        resendBtn.textContent = `Wait ${countdown}s`;
        if (countdown <= 0) {
          clearInterval(interval);
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend';
        }
      }, 1000);
      
    } catch (error) {
      showNotif(error.message, '!');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend';
    }
  }

  // ── API Calls ──
  async function signup(email, name, password) {
    return API.signup(email, name, password);
  }

  async function login(email, password) {
    return API.login(email, password);
  }

  async function verifySignupOtp(email, otp) {
    return API.verifyOtp(email, otp);
  }

  // ── Utilities ──

  function setupOtpInputs() {
    document.querySelectorAll('.otp-container').forEach((container) => {
      const inputs = Array.from(container.querySelectorAll('.otp-input'));

      inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
          const value = e.target.value.replace(/\D/g, '').charAt(0) || '';
          e.target.value = value;
          if (value && index < inputs.length - 1) {
            inputs[index + 1].focus();
          }
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && !e.target.value && index > 0) {
            inputs[index - 1].focus();
          }
        });

        input.addEventListener('paste', (e) => {
          e.preventDefault();
          const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, inputs.length);
          if (!pastedData) return;

          inputs.forEach((otpInput, idx) => {
            otpInput.value = pastedData[idx] || '';
          });

          if (pastedData.length === inputs.length) {
            const submitBtn = container.closest('form')?.querySelector('button[type="submit"]');
            submitBtn?.focus();
          }
        });
      });
    });
  }

  function setLoading(btn, textEl, spinnerEl, isLoading, text = '') {
    btn.disabled = isLoading;
    if (isLoading) {
      textEl.textContent = 'Processing...';
      spinnerEl.style.display = 'inline-block';
    } else {
      textEl.textContent = text;
      spinnerEl.style.display = 'none';
    }
  }

  function showNotif(msg, icon = '✓') {
    const el = document.getElementById('notif');
    document.getElementById('notif-msg').textContent = msg;
    document.getElementById('notif-icon').textContent = icon;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  return { 
    init, 
    switchTab, 
    goBack, 
    handleAuthSubmit, 
    handleOtpSubmit, 
    resendOtp,
    openForgotPassword,
    exitForgotPassword,
    handleForgotSubmit,
  };
})();

document.addEventListener('DOMContentLoaded', Auth.init);
