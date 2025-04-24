// ==UserScript==
// @name         Bluesky Community Verifications
// @namespace    https://tangled.sh/@dunkirk.sh/bunplayground
// @version      0.2
// @description  Shows verification badges from trusted community members on Bluesky
// @author       Kieran Klukas
// @match        https://bsky.app/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  // Script has already been initialized check
  if (window.bskyTrustedUsersInitialized) {
    console.log("Trusted Users script already initialized");
    return;
  }

  // Mark script as initialized
  window.bskyTrustedUsersInitialized = true;

  // Define storage keys
  const TRUSTED_USERS_STORAGE_KEY = "bsky_trusted_users";
  const VERIFICATION_CACHE_STORAGE_KEY = "bsky_verification_cache";
  const CACHE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours
  const BADGE_TYPE_STORAGE_KEY = "bsky_verification_badge_type";
  const BADGE_COLOR_STORAGE_KEY = "bsky_verification_badge_color";

  // Default badge configuration
  const DEFAULT_BADGE_TYPE = "checkmark";
  const DEFAULT_BADGE_COLOR = "#0070ff";

  // Functions to get/set badge configuration
  const getBadgeType = () => {
    return localStorage.getItem(BADGE_TYPE_STORAGE_KEY) || DEFAULT_BADGE_TYPE;
  };

  const getBadgeColor = () => {
    return localStorage.getItem(BADGE_COLOR_STORAGE_KEY) || DEFAULT_BADGE_COLOR;
  };

  const saveBadgeType = (type) => {
    localStorage.setItem(BADGE_TYPE_STORAGE_KEY, type);
  };

  const saveBadgeColor = (color) => {
    localStorage.setItem(BADGE_COLOR_STORAGE_KEY, color);
  };

  const getBadgeContent = (type) => {
    switch (type) {
      case "checkmark":
        return "✓";
      case "star":
        return "★";
      case "heart":
        return "♥";
      case "shield":
        return "🛡️";
      case "lock":
        return "🔒";
      case "verified":
        return `<svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="white" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>
                </svg>`;
      default:
        return "✓";
    }
  };

  // Function to get trusted users from local storage
  const getTrustedUsers = () => {
    const storedUsers = localStorage.getItem(TRUSTED_USERS_STORAGE_KEY);
    return storedUsers ? JSON.parse(storedUsers) : [];
  };

  // Function to save trusted users to local storage
  const saveTrustedUsers = (users) => {
    localStorage.setItem(TRUSTED_USERS_STORAGE_KEY, JSON.stringify(users));
  };

  // Function to add a trusted user
  const addTrustedUser = (handle) => {
    const users = getTrustedUsers();
    if (!users.includes(handle)) {
      users.push(handle);
      saveTrustedUsers(users);
    }
  };

  // Function to remove a trusted user
  const removeTrustedUser = (handle) => {
    const users = getTrustedUsers();
    const updatedUsers = users.filter((user) => user !== handle);
    saveTrustedUsers(updatedUsers);
  };

  // Cache functions
  const getVerificationCache = () => {
    const cache = localStorage.getItem(VERIFICATION_CACHE_STORAGE_KEY);
    return cache ? JSON.parse(cache) : {};
  };

  const saveVerificationCache = (cache) => {
    localStorage.setItem(VERIFICATION_CACHE_STORAGE_KEY, JSON.stringify(cache));
  };

  const getCachedVerifications = (user) => {
    const cache = getVerificationCache();
    return cache[user] || null;
  };

  const cacheVerifications = (user, records) => {
    const cache = getVerificationCache();
    cache[user] = {
      records,
      timestamp: Date.now(),
    };
    saveVerificationCache(cache);
  };

  const isCacheValid = (cacheEntry) => {
    return cacheEntry && Date.now() - cacheEntry.timestamp < CACHE_EXPIRY_TIME;
  };

  // Function to remove a specific user from the verification cache
  const removeUserFromCache = (handle) => {
    const cache = getVerificationCache();
    if (cache[handle]) {
      delete cache[handle];
      saveVerificationCache(cache);
      console.log(`Removed ${handle} from verification cache`);
    }
  };

  const clearCache = () => {
    localStorage.removeItem(VERIFICATION_CACHE_STORAGE_KEY);
    console.log("Verification cache cleared");
  };

  // Store all verifiers for a profile
  let profileVerifiers = [];

  // Store current profile DID
  let currentProfileDid = null;

  // Function to check if a trusted user has verified the current profile
  const checkTrustedUserVerifications = async (profileDid) => {
    currentProfileDid = profileDid; // Store for recheck functionality
    const trustedUsers = getTrustedUsers();
    profileVerifiers = []; // Reset the verifiers list

    if (trustedUsers.length === 0) {
      console.log("No trusted users to check for verifications");
      return false;
    }

    console.log(`Checking if any trusted users have verified ${profileDid}`);

    // Use Promise.all to fetch all verification data in parallel
    const verificationPromises = trustedUsers.map(async (trustedUser) => {
      try {
        // Helper function to fetch all verification records with pagination
        const fetchAllVerifications = async (user) => {
          // Check cache first
          const cachedData = getCachedVerifications(user);
          if (cachedData && isCacheValid(cachedData)) {
            console.log(`Using cached verification data for ${user}`);
            return cachedData.records;
          }

          console.log(`Fetching fresh verification data for ${user}`);
          let allRecords = [];
          let cursor = null;
          let hasMore = true;

          while (hasMore) {
            const url = cursor
              ? `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${user}&collection=app.bsky.graph.verification&cursor=${cursor}`
              : `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${user}&collection=app.bsky.graph.verification`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.records && data.records.length > 0) {
              allRecords = [...allRecords, ...data.records];
            }

            if (data.cursor) {
              cursor = data.cursor;
            } else {
              hasMore = false;
            }
          }

          // Save to cache
          cacheVerifications(user, allRecords);
          return allRecords;
        };

        // Fetch all verification records for this trusted user
        const records = await fetchAllVerifications(trustedUser);

        console.log(`Received verification data from ${trustedUser}`, {
          records,
        });

        // Check if this trusted user has verified the current profile
        if (records.length > 0) {
          for (const record of records) {
            if (record.value && record.value.subject === profileDid) {
              console.log(
                `${profileDid} is verified by trusted user ${trustedUser}`,
              );

              // Add to verifiers list
              profileVerifiers.push(trustedUser);
              break; // Once we find a verification, we can stop checking
            }
          }
        }
        return { trustedUser, success: true };
      } catch (error) {
        console.error(
          `Error checking verifications from ${trustedUser}:`,
          error,
        );
        return { trustedUser, success: false, error };
      }
    });

    // Wait for all verification checks to complete
    const results = await Promise.all(verificationPromises);

    // Log summary of API calls
    console.log(`API calls completed: ${results.length}`);
    console.log(`Successful calls: ${results.filter((r) => r.success).length}`);
    console.log(`Failed calls: ${results.filter((r) => !r.success).length}`);

    // If we have verifiers, display the badge
    if (profileVerifiers.length > 0) {
      displayVerificationBadge(profileVerifiers);
      return true;
    }

    console.log(`${profileDid} is not verified by any trusted users`);

    return false;
  };

  // Function to display verification badge on the profile
  const displayVerificationBadge = (verifierHandles) => {
    // Find the profile header or name element to add the badge to
    const nameElements = document.querySelectorAll(
      '[data-testid="profileHeaderDisplayName"]',
    );
    const nameElement = nameElements[nameElements.length - 1];

    console.log(nameElement);

    if (nameElement) {
      // Remove existing badge if present
      const existingBadge = document.getElementById(
        "user-trusted-verification-badge",
      );
      if (existingBadge) {
        existingBadge.remove();
      }

      const badge = document.createElement("span");
      badge.id = "user-trusted-verification-badge";

      // Get user badge preferences
      const badgeType = getBadgeType();
      const badgeColor = getBadgeColor();

      // Set badge content based on type
      badge.innerHTML = getBadgeContent(badgeType);

      // Create tooltip text with all verifiers
      const verifiersText =
        verifierHandles.length > 1
          ? `Verified by: ${verifierHandles.join(", ")}`
          : `Verified by ${verifierHandles[0]}`;

      badge.title = verifiersText;
      badge.style.cssText = `
        background-color: ${badgeColor};
        color: white;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        margin-left: 8px;
        font-size: 12px;
        font-weight: bold;
        cursor: help;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      `;

      // Add a click event to show all verifiers
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        showVerifiersPopup(verifierHandles);
      });

      nameElement.appendChild(badge);
    }
  };

  // Function to show a popup with all verifiers
  const showVerifiersPopup = (verifierHandles) => {
    // Remove existing popup if any
    const existingPopup = document.getElementById("verifiers-popup");
    if (existingPopup) {
      existingPopup.remove();
    }

    // Create popup
    const popup = document.createElement("div");
    popup.id = "verifiers-popup";
    popup.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: #24273A;
      padding: 20px;
      border-radius: 10px;
      z-index: 10002;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      max-width: 400px;
      width: 90%;
    `;

    // Create popup content
    popup.innerHTML = `
      <h3 style="margin-top: 0; color: white;">Profile Verifiers</h3>
      <div style="max-height: 300px; overflow-y: auto;">
        ${verifierHandles
          .map(
            (handle) => `
          <div style="padding: 8px 0; border-bottom: 1px solid #444; color: white;">
            ${handle}
          </div>
        `,
          )
          .join("")}
      </div>
      <button id="close-verifiers-popup" style="
        margin-top: 15px;
        padding: 8px 15px;
        background-color: #473A3A;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      ">Close</button>
    `;

    // Add to body
    document.body.appendChild(popup);

    // Add close handler
    document
      .getElementById("close-verifiers-popup")
      .addEventListener("click", () => {
        popup.remove();
      });

    // Close when clicking outside
    document.addEventListener("click", function closePopup(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener("click", closePopup);
      }
    });
  };

  // Create settings modal
  let settingsModal = null;

  // Function to update the list of trusted users in the UI
  const updateTrustedUsersList = () => {
    const trustedUsersList = document.getElementById("trustedUsersList");
    if (!trustedUsersList) return;

    const users = getTrustedUsers();
    trustedUsersList.innerHTML = "";

    if (users.length === 0) {
      trustedUsersList.innerHTML = "<p>No trusted users added yet.</p>";
      return;
    }

    for (const user of users) {
      const userItem = document.createElement("div");
      userItem.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid #eee;
      `;

      userItem.innerHTML = `
        <span>${user}</span>
        <button class="remove-user" data-handle="${user}" style="background-color: #CE3838; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer;">Remove</button>
      `;

      trustedUsersList.appendChild(userItem);
    }

    // Add event listeners to remove buttons
    const removeButtons = document.querySelectorAll(".remove-user");
    for (const btn of removeButtons) {
      btn.addEventListener("click", (e) => {
        const handle = e.target.getAttribute("data-handle");
        removeTrustedUser(handle);
        removeUserFromCache(handle);
        updateTrustedUsersList();
      });
    }
  };

  const searchUsers = async (searchQuery) => {
    if (!searchQuery || searchQuery.length < 2) return [];

    try {
      const response = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?term=${encodeURIComponent(searchQuery)}&limit=5`,
      );
      const data = await response.json();
      return data.actors || [];
    } catch (error) {
      console.error("Error searching for users:", error);
      return [];
    }
  };

  // Function to create and show the autocomplete dropdown
  const showAutocompleteResults = (results, inputElement) => {
    // Remove existing dropdown if any
    const existingDropdown = document.getElementById("autocomplete-dropdown");
    if (existingDropdown) existingDropdown.remove();

    if (results.length === 0) return;

    // Create dropdown
    const dropdown = document.createElement("div");
    dropdown.id = "autocomplete-dropdown";
    dropdown.style.cssText = `
      position: absolute;
      background-color: #2A2E3D;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      max-height: 300px;
      overflow-y: auto;
      width: ${inputElement.offsetWidth}px;
      z-index: 10002;
      margin-top: 2px;
    `;

    // Position dropdown below input
    const inputRect = inputElement.getBoundingClientRect();
    dropdown.style.left = `${inputRect.left}px`;
    dropdown.style.top = `${inputRect.bottom}px`;

    // Add results to dropdown
    for (const user of results) {
      const userItem = document.createElement("div");
      userItem.className = "autocomplete-item";
      userItem.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
        color: white;
        border-bottom: 1px solid #444;
      `;
      userItem.onmouseover = () => {
        userItem.style.backgroundColor = "#3A3F55";
      };
      userItem.onmouseout = () => {
        userItem.style.backgroundColor = "";
      };

      // Add profile picture
      const avatar = document.createElement("img");
      avatar.src = user.avatar || "https://bsky.app/static/default-avatar.png";
      avatar.style.cssText = `
        width: 32px;
        height: 32px;
        border-radius: 50%;
        margin-right: 10px;
        object-fit: cover;
      `;

      // Add user info
      const userInfo = document.createElement("div");
      userInfo.style.cssText = `
        display: flex;
        flex-direction: column;
      `;

      const displayName = document.createElement("div");
      displayName.textContent = user.displayName || user.handle;
      displayName.style.fontWeight = "bold";

      const handle = document.createElement("div");
      handle.textContent = user.handle;
      handle.style.fontSize = "0.8em";
      handle.style.opacity = "0.8";

      userInfo.appendChild(displayName);
      userInfo.appendChild(handle);

      userItem.appendChild(avatar);
      userItem.appendChild(userInfo);

      // Handle click on user item
      userItem.addEventListener("click", () => {
        inputElement.value = user.handle;
        dropdown.remove();
      });

      dropdown.appendChild(userItem);
    }

    document.body.appendChild(dropdown);

    // Close dropdown when clicking outside
    document.addEventListener("click", function closeDropdown(e) {
      if (e.target !== inputElement && !dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener("click", closeDropdown);
      }
    });
  };

  // Function to import verifications from the current user
  const importVerificationsFromSelf = async () => {
    try {
      // Check if we can determine the current user
      const bskyStorageData = localStorage.getItem("BSKY_STORAGE");
      let userData = null;

      if (bskyStorageData) {
        try {
          const bskyStorage = JSON.parse(bskyStorageData);
          if (bskyStorage.session.currentAccount) {
            userData = bskyStorage.session.currentAccount;
          }
        } catch (error) {
          console.error("Error parsing BSKY_STORAGE data:", error);
        }
      }

      if (!userData || !userData.handle) {
        alert(
          "Could not determine your Bluesky handle. Please ensure you're logged in.",
        );
        return;
      }

      if (!userData || !userData.handle) {
        alert(
          "Unable to determine your Bluesky handle. Make sure you're logged in.",
        );
        return;
      }

      const userHandle = userData.handle;

      // Show loading state
      const importButton = document.getElementById("importVerificationsBtn");
      const originalText = importButton.textContent;
      importButton.textContent = "Importing...";
      importButton.disabled = true;

      // Fetch verification records from the user's account with pagination
      let allRecords = [];
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const url = cursor
          ? `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${userHandle}&collection=app.bsky.graph.verification&cursor=${cursor}`
          : `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${userHandle}&collection=app.bsky.graph.verification`;

        const verificationResponse = await fetch(url);
        const data = await verificationResponse.json();

        if (data.records && data.records.length > 0) {
          allRecords = [...allRecords, ...data.records];
        }

        if (data.cursor) {
          cursor = data.cursor;
        } else {
          hasMore = false;
        }
      }

      const verificationData = { records: allRecords };

      if (!verificationData.records || verificationData.records.length === 0) {
        alert("No verification records found in your account.");
        importButton.textContent = originalText;
        importButton.disabled = false;
        return;
      }

      // Extract the handles of verified users
      const verifiedUsers = [];
      for (const record of verificationData.records) {
        console.log(record.value.handle);
        verifiedUsers.push(record.value.handle);
      }

      // Add all found users to trusted users
      let addedCount = 0;
      for (const handle of verifiedUsers) {
        const existingUsers = getTrustedUsers();
        if (!existingUsers.includes(handle)) {
          addTrustedUser(handle);
          addedCount++;
        }
      }

      // Update the UI
      updateTrustedUsersList();

      // Reset button state
      importButton.textContent = originalText;
      importButton.disabled = false;

      // Show result
      alert(
        `Successfully imported ${addedCount} verified users from your account.`,
      );
    } catch (error) {
      console.error("Error importing verifications:", error);
      alert("Error importing verifications. Check console for details.");
      const importButton = document.getElementById("importVerificationsBtn");
      if (importButton) {
        importButton.textContent = "Import Verifications";
        importButton.disabled = false;
      }
    }
  };

  const addSettingsButton = () => {
    // Check if we're on the settings page
    if (!window.location.href.includes("bsky.app/settings")) {
      return;
    }

    // Check if our button already exists to avoid duplicates
    if (document.getElementById("community-verifications-settings-button")) {
      return;
    }

    // Find the right place to insert our button (after content-and-media link)
    const contentMediaLink = document.querySelector(
      'a[href="/settings/content-and-media"]',
    );
    if (!contentMediaLink) {
      console.log("Could not find content-and-media link to insert after");
      return;
    }

    // Clone the existing link and modify it
    const verificationButton = contentMediaLink.cloneNode(true);
    verificationButton.id = "community-verifications-settings-button";
    verificationButton.href = "#"; // No actual link, we'll handle click with JS
    verificationButton.setAttribute("aria-label", "Community Verifications");

    const highlightColor =
      verificationButton.firstChild.style.backgroundColor || "rgb(30,41,54)";

    // Add hover effect to highlight the button
    verificationButton.addEventListener("mouseover", () => {
      verificationButton.firstChild.style.backgroundColor = highlightColor;
    });

    verificationButton.addEventListener("mouseout", () => {
      verificationButton.firstChild.style.backgroundColor = null;
    });

    // Update the text content
    const textDiv = verificationButton.querySelector(".css-146c3p1");
    if (textDiv) {
      textDiv.textContent = "Community Verifications";
    }

    // Update the icon
    const iconDiv = verificationButton.querySelector(
      ".css-175oi2r[style*='width: 28px']",
    );
    if (iconDiv) {
      iconDiv.innerHTML = `
        <svg fill="none" width="28" viewBox="0 0 24 24" height="28" style="color: rgb(241, 243, 245);">
          <path fill="hsl(211, 20%, 95.3%)" d="M21.2,9.3c-0.5-0.5-1.1-0.7-1.8-0.7h-2.3V6.3c0-2.1-1.7-3.7-3.7-3.7h-3c-2.1,0-3.7,1.7-3.7,3.7v2.3H4.6
          c-0.7,0-1.3,0.3-1.8,0.7c-0.5,0.5-0.7,1.1-0.7,1.8v9.3c0,0.7,0.3,1.3,0.7,1.8c0.5,0.5,1.1,0.7,1.8,0.7h14.9c0.7,0,1.3-0.3,1.8-0.7
          c0.5-0.5,0.7-1.1,0.7-1.8v-9.3C22,10.4,21.7,9.8,21.2,9.3z M14.1,15.6l-1.3,1.3c-0.1,0.1-0.3,0.2-0.5,0.2c-0.2,0-0.3-0.1-0.5-0.2l-3.3-3.3
          c-0.1-0.1-0.2-0.3-0.2-0.5c0-0.2,0.1-0.3,0.2-0.5l1.3-1.3c0.1-0.1,0.3-0.2,0.5-0.2c0.2,0,0.3,0.1,0.5,0.2l1.5,1.5l4.2-4.2
          c0.1-0.1,0.3-0.2,0.5-0.2c0.2,0,0.3,0.1,0.5,0.2l1.3,1.3c0.1,0.1,0.2,0.3,0.2,0.5c0,0.2-0.1,0.3-0.2,0.5L14.1,15.6z M9.7,6.3
          c0-0.9,0.7-1.7,1.7-1.7h3c0.9,0,1.7,0.7,1.7,1.7v2.3H9.7V6.3z"/>
        </svg>
      `;
    }

    // Insert our button after the content-and-media link
    const parentElement = contentMediaLink.parentElement;
    parentElement.insertBefore(
      verificationButton,
      contentMediaLink.nextSibling,
    );

    // Add click event to open our settings modal
    verificationButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (settingsModal) {
        settingsModal.style.display = "flex";
        updateTrustedUsersList();
      } else {
        createSettingsModal();
      }
    });

    console.log("Added Community Verifications button to settings page");
  };

  // Function to create the settings modal
  const createSettingsModal = () => {
    // Create modal container
    settingsModal = document.createElement("div");
    settingsModal.id = "bsky-trusted-settings-modal";
    settingsModal.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 10001;
      justify-content: center;
      align-items: center;
    `;

    // Create modal content
    const modalContent = document.createElement("div");
    modalContent.style.cssText = `
      background-color: #24273A;
      padding: 20px;
      border-radius: 10px;
      width: 400px;
      max-height: 80vh;
      overflow-y: auto;
    `;

    // Create modal header
    const modalHeader = document.createElement("div");
    modalHeader.innerHTML = `<h2 style="margin-top: 0;">Trusted Bluesky Users</h2>`;

    const badgeCustomization = document.createElement("div");
    badgeCustomization.style.cssText = `
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    `;

    badgeCustomization.innerHTML = `
      <h3 style="margin-top: 0; color: white;">Badge Customization</h3>

      <div style="margin-bottom: 15px;">
        <p style="margin-bottom: 8px; color: white;">Badge Type:</p>
        <div style="display: flex; flex-wrap: wrap; gap: 10px;">
          <label style="display: flex; align-items: center; cursor: pointer; color: white;">
            <input type="radio" name="badgeType" value="checkmark" ${getBadgeType() === "checkmark" ? "checked" : ""}>
            <span style="margin-left: 5px;">Checkmark (✓)</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer; color: white;">
            <input type="radio" name="badgeType" value="star" ${getBadgeType() === "star" ? "checked" : ""}>
            <span style="margin-left: 5px;">Star (★)</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer; color: white;">
            <input type="radio" name="badgeType" value="heart" ${getBadgeType() === "heart" ? "checked" : ""}>
            <span style="margin-left: 5px;">Heart (♥)</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer; color: white;">
            <input type="radio" name="badgeType" value="shield" ${getBadgeType() === "shield" ? "checked" : ""}>
            <span style="margin-left: 5px;">Shield (🛡️)</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer; color: white;">
            <input type="radio" name="badgeType" value="lock" ${getBadgeType() === "lock" ? "checked" : ""}>
            <span style="margin-left: 5px;">Lock (🔒)</span>
          </label>
          <label style="display: flex; align-items: center; cursor: pointer; color: white;">
            <input type="radio" name="badgeType" value="verified" ${getBadgeType() === "verified" ? "checked" : ""}>
            <span style="margin-left: 5px;">Verified</span>
          </label>
        </div>
      </div>

      <div>
        <p style="margin-bottom: 8px; color: white;">Badge Color:</p>
        <div style="display: flex; align-items: center;">
          <input type="color" id="badgeColorPicker" value="${getBadgeColor()}" style="margin-right: 10px;">
          <span id="badgeColorPreview" style="display: inline-block; width: 24px; height: 24px; background-color: ${getBadgeColor()}; border-radius: 50%; margin-right: 10px;"></span>
          <button id="resetBadgeColor" style="padding: 5px 10px; background: #473A3A; color: white; border: none; border-radius: 4px; cursor: pointer;">Reset to Default</button>
        </div>
      </div>

      <div style="margin-top: 20px;">
        <p style="color: white;">Preview:</p>
        <div style="display: flex; align-items: center; margin-top: 8px;">
          <span style="color: white; font-weight: bold;">User Name</span>
          <span id="badgePreview" style="
            background-color: ${getBadgeColor()};
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            margin-left: 8px;
            font-size: 12px;
            font-weight: bold;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          ">${getBadgeContent(getBadgeType())}</span>
        </div>
      </div>
    `;

    // Add the badge customization section to the modal content
    modalContent.appendChild(badgeCustomization);

    // Add event listeners for the badge customization controls
    setTimeout(() => {
      // Badge type selection
      const badgeTypeRadios = document.querySelectorAll(
        'input[name="badgeType"]',
      );
      for (const radio of badgeTypeRadios) {
        radio.addEventListener("change", (e) => {
          const selectedType = e.target.value;
          saveBadgeType(selectedType);
          updateBadgePreview();
        });
      }

      // Badge color picker
      const colorPicker = document.getElementById("badgeColorPicker");
      const colorPreview = document.getElementById("badgeColorPreview");

      colorPicker.addEventListener("input", (e) => {
        const selectedColor = e.target.value;
        colorPreview.style.backgroundColor = selectedColor;
        saveBadgeColor(selectedColor);
        updateBadgePreview();
      });

      // Reset color button
      const resetColorBtn = document.getElementById("resetBadgeColor");
      resetColorBtn.addEventListener("click", () => {
        colorPicker.value = DEFAULT_BADGE_COLOR;
        colorPreview.style.backgroundColor = DEFAULT_BADGE_COLOR;
        saveBadgeColor(DEFAULT_BADGE_COLOR);
        updateBadgePreview();
      });

      // Function to update the badge preview
      function updateBadgePreview() {
        const badgePreview = document.getElementById("badgePreview");
        const selectedType = getBadgeType();
        const selectedColor = getBadgeColor();

        badgePreview.innerHTML = getBadgeContent(selectedType);
        badgePreview.style.backgroundColor = selectedColor;
      }

      // Initialize preview
      updateBadgePreview();
    }, 100);

    // Create input form
    const form = document.createElement("div");
    form.innerHTML = `
        <p>Add Bluesky handles you trust:</p>
        <div style="display: flex; margin-bottom: 15px; position: relative;">
          <input id="trustedUserInput" type="text" placeholder="Search for a user..." style="flex: 1; padding: 8px; margin-right: 10px; border: 1px solid #ccc; border-radius: 4px;">
          <button id="addTrustedUserBtn" style="background-color: #2D578D; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer;">Add</button>
        </div>
      `;

    // Create import button
    const importContainer = document.createElement("div");
    importContainer.style.cssText = `
      margin-top: 10px;
      margin-bottom: 15px;
    `;

    const importButton = document.createElement("button");
    importButton.id = "importVerificationsBtn";
    importButton.textContent = "Import Your Verifications";
    importButton.style.cssText = `
      background-color: #2D578D;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 15px;
      cursor: pointer;
      width: 100%;
    `;

    importButton.addEventListener("click", importVerificationsFromSelf);
    importContainer.appendChild(importButton);

    // Create trusted users list
    const trustedUsersList = document.createElement("div");
    trustedUsersList.id = "trustedUsersList";
    trustedUsersList.style.cssText = `
      margin-top: 15px;
      border-top: 1px solid #eee;
      padding-top: 15px;
    `;

    // Create cache control buttons
    const cacheControls = document.createElement("div");
    cacheControls.style.cssText = `
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    `;

    const clearCacheButton = document.createElement("button");
    clearCacheButton.textContent = "Clear Verification Cache";
    clearCacheButton.style.cssText = `
      padding: 8px 15px;
      background-color: #735A5A;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 10px;
    `;
    clearCacheButton.addEventListener("click", () => {
      clearCache();
      alert(
        "Verification cache cleared. Fresh data will be fetched on next check.",
      );
    });

    cacheControls.appendChild(clearCacheButton);

    // Create close button
    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style.cssText = `
      margin-top: 20px;
      padding: 8px 15px;
      background-color: #473A3A;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;

    // Assemble modal
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(form);
    modalContent.appendChild(importContainer);
    modalContent.appendChild(trustedUsersList);
    modalContent.appendChild(cacheControls);
    modalContent.appendChild(closeButton);
    settingsModal.appendChild(modalContent);

    // Add to document
    document.body.appendChild(settingsModal);

    const userInput = document.getElementById("trustedUserInput");

    // Add input event for autocomplete
    let debounceTimeout;
    userInput.addEventListener("input", (e) => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(async () => {
        const searchQuery = e.target.value.trim();
        if (searchQuery.length >= 2) {
          const results = await searchUsers(searchQuery);
          showAutocompleteResults(results, userInput);
        } else {
          const dropdown = document.getElementById("autocomplete-dropdown");
          if (dropdown) dropdown.remove();
        }
      }, 300); // Debounce for 300ms
    });

    // Event listeners
    closeButton.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });

    // Function to add a user from the input field
    const addUserFromInput = () => {
      const input = document.getElementById("trustedUserInput");
      const handle = input.value.trim();
      if (handle) {
        addTrustedUser(handle);
        input.value = "";
        updateTrustedUsersList();

        // Remove dropdown if present
        const dropdown = document.getElementById("autocomplete-dropdown");
        if (dropdown) dropdown.remove();
      }
    };

    // Add trusted user button event
    document
      .getElementById("addTrustedUserBtn")
      .addEventListener("click", addUserFromInput);

    // Add keydown event to input for Enter key
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addUserFromInput();
      }
    });

    // Close modal when clicking outside
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = "none";
      }
    });

    // Initialize the list
    updateTrustedUsersList();
  };

  // Function to check the current profile
  const checkCurrentProfile = () => {
    const currentUrl = window.location.href;
    // Only trigger on profile pages
    if (
      currentUrl.match(/bsky\.app\/profile\/[^\/]+$/) ||
      currentUrl.match(/bsky\.app\/profile\/[^\/]+\/follows/) ||
      currentUrl.match(/bsky\.app\/profile\/[^\/]+\/followers/)
    ) {
      const handle = currentUrl.split("/profile/")[1].split("/")[0];
      console.log("Detected profile page for:", handle);

      // Fetch user profile data
      fetch(
        `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?repo=${handle}&collection=app.bsky.actor.profile&rkey=self`,
      )
        .then((response) => response.json())
        .then((data) => {
          console.log("User profile data:", data);

          // Extract the DID from the profile data
          const did = data.uri.split("/")[2];
          console.log("User DID:", did);

          // Check if any trusted users have verified this profile using the DID
          checkTrustedUserVerifications(did);
        })
        .catch((error) => {
          console.error("Error checking profile:", error);
        });

      console.log("Bluesky profile detected");
    } else {
      // Not on a profile page, reset state
      currentProfileDid = null;
      profileVerifiers = [];

      // Remove UI elements if present
      const existingBadge = document.getElementById(
        "user-trusted-verification-badge",
      );
      if (existingBadge) {
        existingBadge.remove();
      }
    }
  };

  // Initial check
  checkCurrentProfile();

  const checkUserLinksOnPage = async () => {
    // Look for profile links with handles
    // Find all profile links and filter to get only one link per parent
    const allProfileLinks = Array.from(
      document.querySelectorAll('a[href^="/profile/"]:not(:has(*))'),
    );

    // Use a Map to keep track of parent elements and their first child link
    const parentMap = new Map();

    // For each link, store only the first one found for each parent
    for (const link of allProfileLinks) {
      const parent = link.parentElement;
      if (parent && !parentMap.has(parent)) {
        parentMap.set(parent, link);
      }
    }

    // Get only the first link for each parent
    const profileLinks = Array.from(parentMap.values());

    if (profileLinks.length === 0) return;

    console.log(`Found ${profileLinks.length} possible user links on page`);

    // Process profile links to identify user containers
    for (const link of profileLinks) {
      try {
        // Check if we already processed this link
        if (link.getAttribute("data-verification-checked") === "true") continue;

        // Mark as checked
        link.setAttribute("data-verification-checked", "true");

        // Extract handle from href
        const handle = link.getAttribute("href").split("/profile/")[1];
        if (!handle) continue;

        // check if there is anything after the handle
        const handleTrailing = handle.split("/").length > 1;
        if (handleTrailing) continue;

        // Find parent container that might contain the handle and verification icon
        // Look for containers where this link is followed by another link with the same handle
        const parent = link.parentElement;

        // If we found a container with the verification icon
        if (parent) {
          // Check if this user already has our verification badge
          if (parent.querySelector(".trusted-user-inline-badge")) continue;

          try {
            // Fetch user profile data to get DID
            const response = await fetch(
              `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?repo=${handle}&collection=app.bsky.actor.profile&rkey=self`,
            );
            const data = await response.json();

            // Extract the DID from the profile data
            const did = data.uri.split("/")[2];

            // Check if this user is verified by our trusted users
            const trustedUsers = getTrustedUsers();
            let isVerified = false;
            const verifiers = [];

            // Check cache first for each trusted user
            for (const trustedUser of trustedUsers) {
              const cachedData = getCachedVerifications(trustedUser);

              if (cachedData && isCacheValid(cachedData)) {
                // Use cached verification data
                const records = cachedData.records;

                for (const record of records) {
                  if (record.value && record.value.subject === did) {
                    isVerified = true;
                    verifiers.push(trustedUser);
                    break;
                  }
                }
              }
            }

            // If verified, add a small badge
            if (isVerified && verifiers.length > 0) {
              // Create a badge element
              const smallBadge = document.createElement("span");
              smallBadge.className = "trusted-user-inline-badge";

              // Get user badge preferences
              const badgeType = getBadgeType();
              const badgeColor = getBadgeColor();

              smallBadge.innerHTML = getBadgeContent(badgeType);

              // Create tooltip text with all verifiers
              const verifiersText =
                verifiers.length > 1
                  ? `Verified by: ${verifiers.join(", ")}`
                  : `Verified by ${verifiers[0]}`;

              smallBadge.title = verifiersText;
              smallBadge.style.cssText = `
                background-color: ${badgeColor};
                color: white;
                border-radius: 50%;
                width: 14px;
                height: 14px;
                font-size: 10px;
                font-weight: bold;
                cursor: help;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-left: 4px;
              `;

              // Add click event to show verifiers
              smallBadge.addEventListener("click", (e) => {
                e.stopPropagation();
                showVerifiersPopup(verifiers);
              });

              // Insert badge after the SVG element
              parent.firstChild.after(smallBadge);
              parent.style.flexDirection = "row";
              parent.style.alignItems = "center";
            }
          } catch (error) {
            console.error(`Error checking verification for ${handle}:`, error);
          }
        }
      } catch (error) {
        console.error("Error processing profile link:", error);
      }
    }
  };

  const observeContentChanges = () => {
    // Use a debounced function to check for new user links
    const debouncedCheck = () => {
      clearTimeout(window.userLinksCheckTimeout);
      window.userLinksCheckTimeout = setTimeout(() => {
        checkUserLinksOnPage();
      }, 300);
    };

    // Create a mutation observer that watches for DOM changes
    const observer = new MutationObserver((mutations) => {
      let hasRelevantChanges = false;

      // Check if any mutations involve adding new nodes
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this element or its children might contain profile links
              if (
                node.querySelector('a[href^="/profile/"]') ||
                (node.tagName === "A" &&
                  node.getAttribute("href")?.startsWith("/profile/"))
              ) {
                hasRelevantChanges = true;
                break;
              }
            }
          }
        }
        if (hasRelevantChanges) break;
      }

      if (hasRelevantChanges) {
        debouncedCheck();
      }
    });

    // Observe the entire document for content changes that might include profile links
    observer.observe(document.body, { childList: true, subtree: true });

    // Also check periodically for posts that might have been loaded but not caught by the observer
    setInterval(debouncedCheck, 5000);
  };

  // Wait for DOM to be fully loaded before initializing
  document.addEventListener("DOMContentLoaded", () => {
    // Initial check for user links
    checkUserLinksOnPage();

    // Add settings button if we're on the settings page
    if (window.location.href.includes("bsky.app/settings")) {
      // Wait for the content-and-media link to appear before adding our button
      const waitForSettingsLink = setInterval(() => {
        const contentMediaLink = document.querySelector(
          'a[href="/settings/content-and-media"]',
        );
        if (contentMediaLink) {
          clearInterval(waitForSettingsLink);
          addSettingsButton();
        }
      }, 200);
    }
  });

  // Start observing for content changes to detect newly loaded posts
  observeContentChanges();

  // Set up a MutationObserver to watch for URL changes
  const observeUrlChanges = () => {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        const oldUrl = lastUrl;
        lastUrl = location.href;
        console.log("URL changed from:", oldUrl, "to:", location.href);

        // Reset current profile DID
        currentProfileDid = null;
        profileVerifiers = [];

        // Clean up UI elements
        const existingBadge = document.getElementById(
          "user-trusted-verification-badge",
        );
        if (existingBadge) {
          existingBadge.remove();
        }

        // Check if we're on a profile page now
        setTimeout(checkCurrentProfile, 500); // Small delay to ensure DOM has updated

        if (window.location.href.includes("bsky.app/settings")) {
          // Give the page a moment to fully load
          setTimeout(addSettingsButton, 200);
        }
      }
    });

    observer.observe(document, { subtree: true, childList: true });
  };

  // Start observing for URL changes
  observeUrlChanges();
})();
