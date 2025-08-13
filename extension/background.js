// =================================================================
// Configuration & State
// =================================================================
const API_URL = "http://localhost:3000";

// A single object to hold all information about the currently active tab.
// This prevents errors when trying to access details of a closed tab.
let activeTabInfo = {
  id: null,
  url: null,
  title: null,
  startTime: null,
};

// =================================================================
// Core Time Tracking Logic
// =================================================================

/**
 * Saves the time for the tab stored in the global 'activeTabInfo'.
 * This no longer needs a tabId because it uses the global state.
 */
async function saveTimeForLastTab() {
  if (!activeTabInfo.id || !activeTabInfo.startTime) {
    return; // No active tab was being tracked.
  }

  const endTime = Date.now();
  const duration = Math.round((endTime - activeTabInfo.startTime) / 1000);

  // Only save if a meaningful amount of time has passed.
  if (duration > 0) {
    try {
      const url = new URL(activeTabInfo.url).hostname;
      const title = activeTabInfo.title;

      const storage = await chrome.storage.local.get("websiteTime");
      const websiteTime = storage.websiteTime || {};

      // Aggregate time data locally before sending to the backend.
      if (!websiteTime[url]) {
        websiteTime[url] = { title: title, totalTime: 0 };
      }
      websiteTime[url].totalTime += duration;

      await chrome.storage.local.set({ websiteTime });
      console.log(`Locally saved ${duration}s for ${url}.`);
    } catch (e) {
      console.warn("Could not process URL:", activeTabInfo.url, e);
    }
  }

  // Reset the state to stop the timer.
  activeTabInfo = { id: null, url: null, title: null, startTime: null };
}

/**
 * Main function to handle a change in the active tab.
 * It saves time for the previous tab and starts tracking the new one.
 */
async function processTabChange(tabId) {
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return;
  }

  // Save any pending time for the previously active tab first.
  await saveTimeForLastTab();

  // Get details of the new tab and start its timer.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith("chrome://")) {
      activeTabInfo = {
        id: tabId,
        url: tab.url,
        title: tab.title,
        startTime: Date.now(),
      };
    }
  } catch (e) {
    // This can happen if the tab is closed very quickly.
    console.warn(`Could not get details for tabId: ${tabId}`);
  }
}

// =================================================================
// Event Listeners
// =================================================================

// Fires when the user switches to a different tab.
chrome.tabs.onActivated.addListener((activeInfo) => {
  processTabChange(activeInfo.tabId);
});

// Fires when a tab's URL changes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === "complete") {
    processTabChange(tabId);
  }
});

// Fires when a tab is closed.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // If the closed tab was the one we were tracking, save its time.
  if (tabId === activeTabInfo.id) {
    await saveTimeForLastTab();
  }
});

// CRITICAL FIX: Fires when the user switches to another program or window.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Focus lost, so pause the timer.
    await saveTimeForLastTab();
  } else {
    // Focus gained, so find the active tab in this window and resume.
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tab) {
      processTabChange(tab.id);
    }
  }
});

// =================================================================
// Data Syncing with Backend
// =================================================================

// Create an alarm to periodically send data to the backend.
chrome.alarms.create("sendDataAlarm", { periodInMinutes: 1 });

// CRITICAL FIX: This listener now safely syncs data and only
// deletes what has been successfully sent, preventing data loss.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sendDataAlarm") {
    // Make sure any final time is saved before syncing.
    await saveTimeForLastTab();

    const storage = await chrome.storage.local.get(["token", "websiteTime"]);
    const token = storage.token;
    const websiteTime = storage.websiteTime || {};

    if (!token || Object.keys(websiteTime).length === 0) {
      console.log("Nothing to sync or user not logged in.");
      return;
    }

    const successfullySyncedUrls = [];

    // Create an array of promises for all the API calls
    const sendPromises = Object.entries(websiteTime).map(([url, data]) =>
      sendTimeDataToBackend(url, data.title, data.totalTime, token).then(
        (success) => {
          if (success) {
            successfullySyncedUrls.push(url);
          }
        }
      )
    );

    await Promise.all(sendPromises);

    if (successfullySyncedUrls.length > 0) {
      console.log("Successfully synced:", successfullySyncedUrls);
      const newWebsiteTime = { ...websiteTime };
      successfullySyncedUrls.forEach((url) => delete newWebsiteTime[url]);
      await chrome.storage.local.set({ websiteTime: newWebsiteTime });
    }
  }
});

/**
 * Sends a single website's time data to the backend API.
 * Returns true on success, false on failure.
 */
async function sendTimeDataToBackend(
  website_url,
  website_title,
  total_time_seconds,
  token
) {
  try {
    const response = await fetch(`${API_URL}/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ website_url, website_title, total_time_seconds }),
    });

    if (response.ok) {
      console.log(`Time data sent successfully for ${website_url}`);
      return true;
    } else {
      console.error("Failed to send time data:", await response.json());
      return false;
    }
  } catch (error) {
    console.error("Error sending data:", error);
    return false;
  }
}

// =================================================================
// Authentication Logic (Unchanged)
// =================================================================

// Listens for login/register messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "register") {
    registerUser(request.username, request.password).then(sendResponse);
    return true; // Indicates an async response.
  }
  if (request.action === "login") {
    loginUser(request.username, request.password).then(sendResponse);
    return true; // Indicates an async response.
  }
});

async function registerUser(username, password) {
  try {
    const response = await fetch(`${API_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return await response.json(); // Forward backend response to popup
  } catch (error) {
    console.error("Registration failed:", error);
    return { error: "Could not connect to the server." };
  }
}

async function loginUser(username, password) {
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();

    if (response.ok) {
      // On successful login, save the session token and username.
      await chrome.storage.local.set({ token: data.token, username: username });
      return { success: true };
    } else {
      return { error: data.error };
    }
  } catch (error) {
    console.error("Login failed:", error);
    return { error: "Could not connect to the server." };
  }
}
