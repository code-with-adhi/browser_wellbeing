// popup.js

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const messageDiv = document.getElementById("message");

  const authContainer = document.getElementById("authContainer");
  const statusContainer = document.getElementById("statusContainer");
  const statusMessage = document.getElementById("statusMessage");
  const logoutButton = document.getElementById("logoutButton");

  const loginFormContainer = document.getElementById("loginFormContainer");
  const registerFormContainer = document.getElementById(
    "registerFormContainer"
  );
  const showRegisterLink = document.getElementById("showRegister");
  const showLoginLink = document.getElementById("showLogin");

  // Function to update the UI
  function updateUI(isLoggedIn, username = "") {
    if (isLoggedIn) {
      authContainer.style.display = "none";
      statusContainer.style.display = "block";
      statusMessage.textContent = `Hello, ${username}!`;
    } else {
      authContainer.style.display = "block";
      statusContainer.style.display = "none";
      messageDiv.textContent = "";

      loginFormContainer.style.display = "block";
      registerFormContainer.style.display = "none";
    }
  }

  // Check if the user is already logged in when the popup opens
  chrome.storage.local.get("username", (data) => {
    if (data.username) {
      updateUI(true, data.username);
    } else {
      updateUI(false);
    }
  });

  // Handle form visibility links
  showRegisterLink.addEventListener("click", (e) => {
    e.preventDefault();
    loginFormContainer.style.display = "none";
    registerFormContainer.style.display = "block";
  });

  showLoginLink.addEventListener("click", (e) => {
    e.preventDefault();
    registerFormContainer.style.display = "none";
    loginFormContainer.style.display = "block";
  });

  // Login Form Submission
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = document.getElementById("loginUsername").value;
      const password = document.getElementById("loginPassword").value;
      messageDiv.textContent = "Logging in...";

      chrome.runtime.sendMessage(
        { action: "login", username, password },
        (response) => {
          if (chrome.runtime.lastError) {
            messageDiv.textContent =
              "Error: Could not connect to the extension background. Please try again.";
            return;
          }
          if (response.success) {
            messageDiv.textContent = "";
            updateUI(true, username);
          } else {
            messageDiv.textContent = response.error || "Login failed.";
          }
        }
      );
    });
  }

  // Register Form Submission
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = document.getElementById("registerUsername").value;
      const password = document.getElementById("registerPassword").value;
      messageDiv.textContent = "Registering...";

      chrome.runtime.sendMessage(
        { action: "register", username, password },
        (response) => {
          if (chrome.runtime.lastError) {
            messageDiv.textContent =
              "Error: Could not connect to the extension background. Please try again.";
            return;
          }
          if (response.error) {
            messageDiv.textContent = response.error;
          } else {
            // This block runs on successful registration
            messageDiv.textContent = "User registered successfully!";
            // Automatically switch to the login form
            loginFormContainer.style.display = "block";
            registerFormContainer.style.display = "none";
          }
        }
      );
    });
  }

  // Logout Button Listener
  logoutButton.addEventListener("click", () => {
    chrome.storage.local.remove(["token", "username"], () => {
      updateUI(false);
    });
  });
});
