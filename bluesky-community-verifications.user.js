(() => {
  // Script has already been initialized check
  if (window.bskyTrustedUsersInitialized) {
    console.log("Trusted Users script already initialized");
    return;
  }

  // Mark script as initialized
  window.bskyTrustedUsersInitialized = true;

  // Define a storage key for trusted users
  const TRUSTED_USERS_STORAGE_KEY = "bsky_trusted_users";

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

  // Store all verifiers for a profile
  let profileVerifiers = [];

  // Function to check if a trusted user has verified the current profile
  const checkTrustedUserVerifications = async (currentProfileDid) => {
    const trustedUsers = getTrustedUsers();
    profileVerifiers = []; // Reset the verifiers list

    if (trustedUsers.length === 0) {
      console.log("No trusted users to check for verifications");
      return false;
    }

    console.log(
      `Checking if any trusted users have verified ${currentProfileDid}`,
    );

    // Use Promise.all to fetch all verification data in parallel
    const verificationPromises = trustedUsers.map(async (trustedUser) => {
      try {
        const response = await fetch(
          `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${trustedUser}&collection=app.bsky.graph.verification`,
        );
        const data = await response.json();

        // Check if this trusted user has verified the current profile
        if (data.records && data.records.length > 0) {
          for (const record of data.records) {
            if (record.value && record.value.subject === currentProfileDid) {
              console.log(
                `${currentProfileDid} is verified by trusted user ${trustedUser}`,
              );

              // Add to verifiers list
              profileVerifiers.push(trustedUser);
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

    console.log(`${currentProfileDid} is not verified by any trusted users`);
    return false;
  };

  // Function to display verification badge on the profile
  const displayVerificationBadge = (verifierHandles) => {
    // Find the profile header or name element to add the badge to
    const nameElement = document.querySelector(
      '[data-testid="profileHeaderDisplayName"]',
    );

    if (nameElement) {
      // Check if badge already exists
      if (!document.getElementById("user-trusted-verification-badge")) {
        const badge = document.createElement("span");
        badge.id = "user-trusted-verification-badge";
        badge.innerHTML = "✓";

        // Create tooltip text with all verifiers
        const verifiersText =
          verifierHandles.length > 1
            ? `Verified by: ${verifierHandles.join(", ")}`
            : `Verified by ${verifierHandles[0]}`;

        badge.title = verifiersText;
        badge.style.cssText = `
          background-color: #0070ff;
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

  // Create settings UI - only once
  let settingsButton = null;
  let settingsModal = null;

  // Function to create the settings UI if it doesn't exist yet
  const createSettingsUI = () => {
    // Check if UI already exists
    if (document.getElementById("bsky-trusted-settings-button")) {
      return;
    }

    // Create settings button
    settingsButton = document.createElement("button");
    settingsButton.id = "bsky-trusted-settings-button";
    settingsButton.textContent = "Trusted Users Settings";
    settingsButton.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      padding: 10px 15px;
      background-color: #2D578D;
      color: white;
      border: none;
      border-radius: 20px;
      cursor: pointer;
      font-weight: bold;
    `;

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

    // Create input form
    const form = document.createElement("div");
    form.innerHTML = `
      <p>Add Bluesky handles you trust:</p>
      <div style="display: flex; margin-bottom: 15px;">
        <input id="trustedUserInput" type="text" placeholder="username.bsky.social" style="flex: 1; padding: 8px; margin-right: 10px; border: 1px solid #ccc; border-radius: 4px;">
        <button id="addTrustedUserBtn" style="background-color: #2D578D; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer;">Add</button>
      </div>
    `;

    // Create trusted users list
    const trustedUsersList = document.createElement("div");
    trustedUsersList.id = "trustedUsersList";
    trustedUsersList.style.cssText = `
      margin-top: 15px;
      border-top: 1px solid #eee;
      padding-top: 15px;
    `;

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
    modalContent.appendChild(trustedUsersList);
    modalContent.appendChild(closeButton);
    settingsModal.appendChild(modalContent);

    // Add elements to the document
    document.body.appendChild(settingsButton);
    document.body.appendChild(settingsModal);

    // Function to update the list of trusted users in the UI
    const updateTrustedUsersList = () => {
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
          updateTrustedUsersList();
        });
      }
    };

    // Event listeners
    settingsButton.addEventListener("click", () => {
      settingsModal.style.display = "flex";
      updateTrustedUsersList();
    });

    closeButton.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });

    document
      .getElementById("addTrustedUserBtn")
      .addEventListener("click", () => {
        const input = document.getElementById("trustedUserInput");
        const handle = input.value.trim();
        if (handle) {
          addTrustedUser(handle);
          input.value = "";
          updateTrustedUsersList();
        }
      });

    // Close modal when clicking outside
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = "none";
      }
    });
  };

  // Function to check the current profile
  const checkCurrentProfile = () => {
    const currentUrl = window.location.href;
    if (currentUrl.includes("bsky.app/profile/")) {
      const handle = currentUrl.split("/profile/")[1].split("/")[0];
      console.log("Extracted handle:", handle);

      // Create and add the settings UI (only once)
      createSettingsUI();

      // Fetch user profile data
      fetch(
        `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${handle}&collection=app.bsky.actor.profile&rkey=self`,
      )
        .then((response) => response.json())
        .then((data) => {
          console.log("User profile data:", data);

          // Extract the DID from the profile data
          const did = data.uri.split("/")[2];
          console.log("User DID:", did);

          // Now fetch the app.bsky.graph.verification data specifically
          fetch(
            `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${handle}&collection=app.bsky.graph.verification`,
          )
            .then((response) => response.json())
            .then((verificationData) => {
              console.log("Verification data:", verificationData);
              if (
                verificationData.records &&
                verificationData.records.length > 0
              ) {
                console.log(
                  "User has app.bsky.graph.verification:",
                  verificationData.records,
                );
              } else {
                console.log("User does not have app.bsky.graph.verification");
              }

              // Check if any trusted users have verified this profile using the DID
              checkTrustedUserVerifications(did);
            })
            .catch((verificationError) => {
              console.error(
                "Error fetching verification data:",
                verificationError,
              );
            });
        })
        .catch((error) => {
          console.error("Error checking profile:", error);
        });

      console.log("Bluesky profile detected");
    }
  };

  // Initial check
  checkCurrentProfile();

  // Set up a MutationObserver to watch for URL changes
  const observeUrlChanges = () => {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log("URL changed to:", location.href);

        // Remove any existing badges when URL changes
        const existingBadge = document.getElementById(
          "user-trusted-verification-badge",
        );
        if (existingBadge) {
          existingBadge.remove();
        }

        // Check if we're on a profile page now
        checkCurrentProfile();
      }
    });

    observer.observe(document, { subtree: true, childList: true });
  };

  // Start observing for URL changes
  observeUrlChanges();
})();
