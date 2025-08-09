// background.js

const API_URL = "http://localhost:3000";

let lastTabId = null;
let startTime = null;

// Listen for when a tab is activated
chrome.tabs.onActivated.addListener(handleTabChange);

// Listen for when a tab's URL is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    handleTabChange(tabId);
  }
});

// Listen for when a tab is removed
chrome.tabs.onRemoved.addListener(handleTabRemoved);

async function handleTabChange(activeInfo) {
  const tabId = typeof activeInfo === "object" ? activeInfo.tabId : activeInfo;

  if (lastTabId !== null && startTime !== null && lastTabId !== tabId) {
    await saveTimeForLastTab();
  }

  lastTabId = tabId;
  startTime = Date.now();
}

async function handleTabRemoved(tabId) {
  if (tabId === lastTabId) {
    await saveTimeForLastTab();
    lastTabId = null;
    startTime = null;
  }
}

async function saveTimeForLastTab() {
  if (lastTabId && startTime) {
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    if (duration <= 0) return;

    try {
      const tab = await new Promise((resolve) =>
        chrome.tabs.get(lastTabId, resolve)
      );

      if (tab && tab.url && !tab.url.startsWith("chrome://")) {
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
    } catch (e) {
      console.error("Error getting tab info:", e);
    }
  }
}

chrome.alarms.create("sendDataAlarm", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sendDataAlarm") {
    await saveTimeForLastTab();

    const storage = await chrome.storage.local.get(["token", "websiteTime"]);
    const token = storage.token;
    const websiteTime = storage.websiteTime || {};

    if (!token) {
      console.warn("User not logged in. Skipping data sync.");
      return;
    }

    for (const url in websiteTime) {
      if (
        Object.prototype.hasOwnProperty.call(websiteTime, url) &&
        websiteTime[url].totalTime > 0
      ) {
        await sendTimeDataToBackend(
          url,
          websiteTime[url].title,
          websiteTime[url].totalTime
        );
      }
    }
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
