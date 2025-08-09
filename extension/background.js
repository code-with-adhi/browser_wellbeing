// background.js

const API_URL = "http://localhost:3000";

let lastTabId = null;
let startTime = null;

async function processTabChange(tabId) {
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return;
  }

  if (lastTabId !== null && startTime !== null && lastTabId !== tabId) {
    await saveTimeForLastTab(lastTabId);
  }

  lastTabId = tabId;
  startTime = Date.now();
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  processTabChange(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    !tab.url.startsWith("chrome://")
  ) {
    processTabChange(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await saveTimeForLastTab(tabId);
  if (tabId === lastTabId) {
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

  try {
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (result) => {
        if (chrome.runtime.lastError) {
          // Do not log a warning, as per your request
          return reject();
        }
        resolve(result);
      });
    });

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
  } catch (e) {
    // Silently ignore if the tab no longer exists.
    return;
  }
}

chrome.alarms.create("sendDataAlarm", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sendDataAlarm") {
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
