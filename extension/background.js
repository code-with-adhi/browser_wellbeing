// background.js

const API_URL = "http://localhost:3000";

let lastTabId = null;
let startTime = null;

// New, centralized function to handle tab changes
async function processTabChange(tabId) {
  // Guard against invalid tab IDs
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return;
  }

  // Save time for the previous active tab
  if (lastTabId !== null && startTime !== null && lastTabId !== tabId) {
    await saveTimeForLastTab(lastTabId);
  }

  // Set the new active tab
  lastTabId = tabId;
  startTime = Date.now();
}

// Listen for when a tab becomes active
chrome.tabs.onActivated.addListener((activeInfo) => {
  processTabChange(activeInfo.tabId);
});

// Listen for when a tab's URL is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process if the URL has changed and is a valid web page
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    !tab.url.startsWith("chrome://")
  ) {
    processTabChange(tabId);
  }
});

// Listen for when a tab is removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === lastTabId) {
    await saveTimeForLastTab(tabId);
    lastTabId = null;
    startTime = null;
  }
});

async function saveTimeForLastTab(tabId) {
  if (!tabId || !startTime) {
    return;
  }

  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);

  if (duration <= 0) return;

  chrome.tabs.get(tabId, async (tab) => {
    if (chrome.runtime.lastError) {
      console.warn(`Tab with ID ${tabId} no longer exists.`);
      return;
    }

    if (tab.url && !tab.url.startsWith("chrome://")) {
      const url = new URL(tab.url).hostname;
      const title = tab.title;

      const storage = await chrome.storage.local.get("websiteTime");
      let websiteTime = storage.websiteTime || {};

      websiteTime[url] = {
        title: title,
        totalTime:
          (websiteTime[url] ? websiteTime[url].totalTime : 0) + duration,
      };

      await chrome.storage.local.set({ websiteTime });
      console.log(
        `Saved ${duration}s for ${url}. Total: ${websiteTime[url].totalTime}s`
      );
    }
  });
}

chrome.alarms.create("sendDataAlarm", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sendDataAlarm") {
    // Save time for the currently active tab before sending data
    await saveTimeForLastTab(lastTabId);

    const storage = await chrome.storage.local.get(["token", "websiteTime"]);
    const token = storage.token;
    const websiteTime = storage.websiteTime || {};

    if (!token) {
      console.warn("User not logged in. Skipping data sync.");
      return;
    }

    const sendPromises = [];
    for (const url in websiteTime) {
      if (
        Object.prototype.hasOwnProperty.call(websiteTime, url) &&
        websiteTime[url].totalTime > 0
      ) {
        sendPromises.push(
          sendTimeDataToBackend(
            url,
            websiteTime[url].title,
            websiteTime[url].totalTime
          )
        );
      }
    }

    await Promise.all(sendPromises);
    await chrome.storage.local.set({ websiteTime: {} });
  }
});

async function sendTimeDataToBackend(
  website_url,
  website_title,
  total_time_seconds
) {
  const result = await chrome.storage.local.get("token");
  const token = result.token;

  if (!token) {
    console.warn("User not logged in. Time data not sent.");
    return;
  }

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
    } else {
      console.error("Failed to send time data:", await response.json());
    }
  } catch (error) {
    console.error("Error sending data:", error);
  }
}

// Authentication Functions
async function registerUser(username, password) {
  try {
    const response = await fetch(`${API_URL}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Registration failed:", error);
    return { error: "Could not connect to the server" };
  }
}

async function loginUser(username, password) {
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();

    if (response.ok) {
      chrome.storage.local.set({ token: data.token, username: username });
      return { success: true };
    } else {
      return { error: data.error };
    }
  } catch (error) {
    console.error("Login failed:", error);
    return { error: "Could not connect to the server" };
  }
}

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "register") {
    registerUser(request.username, request.password).then(sendResponse);
    return true;
  }
  if (request.action === "login") {
    loginUser(request.username, request.password).then(sendResponse);
    return true;
  }
});
