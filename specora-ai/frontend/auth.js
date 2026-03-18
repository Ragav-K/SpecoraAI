/**
 * Specora AI — Authentication Logic
 */
const Auth = (() => {
  let mode = 'login'; // 'login' | 'signup'
  let currentEmail = '';

  // ── Initialization ──
  function init() {
    // If already logged in, redirect to app
    if (localStorage.getItem('specora_user')) {
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

    if (mode === 'signup') {
      nameGroup.style.display = 'block';
      nameInput.required = true;
      confirmPasswordGroup.style.display = 'block';
      confirmPasswordInput.required = true;
      title.textContent = 'Create an account';
      subtitle.textContent = 'Enter your details to get started';
      btnText.textContent = 'Create Account';
    } else {
      nameGroup.style.display = 'none';
      nameInput.required = false;
      confirmPasswordGroup.style.display = 'none';
      confirmPasswordInput.required = false;
      title.textContent = 'Welcome back';
      subtitle.textContent = 'Enter your email to sign in';
      btnText.textContent = 'Sign In';    
    }
  }

  function goBack() {
    document.getElementById('view-verify').style.display = 'none';
    document.getElementById('view-form').style.display = 'block';
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
        setTimeout(() => document.querySelector('.otp-input').focus(), 100);
        showNotif(`Verification code sent to ${email}`, '✉');
      } else {
        const data = await login(email, password);
        // Login success - no OTP
        localStorage.setItem('specora_user', JSON.stringify(data.user));
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

  async function handleOtpSubmit(e) {
    e.preventDefault();
    
    // Gather OTP from inputs
    const inputs = document.querySelectorAll('.otp-input');
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
      localStorage.setItem('specora_user', JSON.stringify(data.user));
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
    const inputs = document.querySelectorAll('.otp-input');
    
    inputs.forEach((input, index) => {
      // Auto-advance on input
      input.addEventListener('input', (e) => {
        if (e.target.value.length === 1) {
          if (index < inputs.length - 1) inputs[index + 1].focus();
        }
      });

      // Handle backspace
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
          inputs[index - 1].focus();
        }
      });

      // Handle paste
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (pastedData) {
          for (let i = 0; i < pastedData.length; i++) {
            if (inputs[i]) {
              inputs[i].value = pastedData[i];
              inputs[i].dispatchEvent(new Event('input'));
            }
          }
          if (pastedData.length === 6) {
            document.getElementById('verify-btn').focus();
          }
        }
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

  return { init, switchTab, goBack, handleAuthSubmit, handleOtpSubmit, resendOtp };
})();

document.addEventListener('DOMContentLoaded', Auth.init);
