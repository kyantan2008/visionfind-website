// ===============================
// VISIONFIND SKETCH MAIN SCRIPT
// ===============================

const CONFIG_PLACEHOLDER = "PASTE_YOUR_ANON_OR_PUBLISHABLE_KEY_HERE";

// ===============================
// BASIC HELPERS
// ===============================

function hasSupabaseConfig() {
  return (
    Boolean(window.supabaseClient) &&
    typeof SUPABASE_ANON_KEY !== "undefined" &&
    SUPABASE_ANON_KEY !== CONFIG_PLACEHOLDER
  );
}

function showMessage(id, text, isError = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[char]));
}

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// ===============================
// PROFILE / ROLE LOOKUP
// ===============================

async function getProfile(userId) {
  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Profile lookup failed:", error.message);
    return null;
  }

  return data;
}

async function getCurrentUserAndProfile() {
  const { data, error } = await window.supabaseClient.auth.getUser();
  if (error || !data.user) return null;
  const profile = await getProfile(data.user.id);
  return { user: data.user, profile };
}

function adjustNavigationForRole(role) {
  document.querySelectorAll('a[href="sketch-builder.html"]').forEach((link) => {
    if (role === "Supervisor") link.style.display = "none";
  });

  document.querySelectorAll('a[href="supervisor-dashboard.html"]').forEach((link) => {
    if (role === "Officer") link.style.display = "none";
  });
}

function showNavbarUser(user, profile) {
  document.querySelectorAll("[data-user-role]").forEach((element) => {
    const role = profile?.role || "User";
    const name = profile?.full_name || user?.email || "Signed in";
    element.textContent = `${name} | ${role}`;
  });

  adjustNavigationForRole(profile?.role);
}

// ===============================
// ROLE REDIRECT
// ===============================

function redirectByRole(profile) {
  if (profile?.role === "Officer") {
    window.location.href = "sketch-builder.html";
    return;
  }

  if (profile?.role === "Supervisor") {
    window.location.href = "supervisor-dashboard.html";
    return;
  }

  showMessage(
    "loginMessage",
    "Login worked, but no role profile was found. Check Supabase profiles table.",
    true
  );
}

// ===============================
// LOGIN SYSTEM
// ===============================

async function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  if (!hasSupabaseConfig()) {
    showMessage("loginMessage", "Supabase is not configured properly. Check supabase-config.js and supabase-client.js.", true);
    return;
  }

  try {
    await window.supabaseClient.auth.signOut({ scope: "local" });
    console.log("Previous local session cleared on login page");
  } catch (error) {
    console.error("Unable to clear previous local session:", error);
  }

  if (form.dataset.loginListenerAttached === "true") return;
  form.dataset.loginListenerAttached = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = form.querySelector("button[type='submit']");
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;

    button.disabled = true;
    button.textContent = "Checking Access...";
    showMessage("loginMessage", "Signing in with Supabase...");

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      console.error("Login failed:", error.message);
      showMessage("loginMessage", error.message, true);
      button.disabled = false;
      button.textContent = "Enter Secure Workspace";
      return;
    }

    const profile = await getProfile(data.user.id);

    if (!profile) {
      console.error("Login failed: no role profile was found.");
      showMessage("loginMessage", "Login worked, but no role profile was found. Check Supabase profiles table.", true);
      button.disabled = false;
      button.textContent = "Enter Secure Workspace";
      return;
    }

    console.log("Login successful");
    showMessage("loginMessage", "Access granted. Redirecting...");
    redirectByRole(profile);
  });
}

// ===============================
// PAGE PROTECTION
// ===============================

async function protectPage() {
  const page = document.body.dataset.page || "";
  if (!page.includes("protected")) return null;

  if (!hasSupabaseConfig()) {
    window.location.href = "login.html";
    return null;
  }

  const authContext = await getCurrentUserAndProfile();

  if (!authContext?.user) {
    window.location.href = "login.html";
    return null;
  }

  const { user, profile } = authContext;

  if (!profile) {
    alert("No role profile found for this account. Check Supabase profiles table.");
    await window.supabaseClient.auth.signOut();
    window.location.href = "login.html";
    return null;
  }

  const role = profile.role;
  const path = window.location.pathname;
  const requiredRoles = (document.body.dataset.requiredRole || "")
    .split(",")
    .map((requiredRole) => requiredRole.trim())
    .filter(Boolean);

  if (requiredRoles.length && !requiredRoles.includes(role)) {
    redirectByRole(profile);
    return null;
  }

  if (path.includes("sketch-builder.html") && role !== "Officer") {
    window.location.href = "supervisor-dashboard.html";
    return null;
  }

  if (path.includes("supervisor-dashboard.html") && role !== "Supervisor") {
    window.location.href = "sketch-builder.html";
    return null;
  }

  showNavbarUser(user, profile);
  return authContext;
}

// ===============================
// LOGOUT
// ===============================

function initLogoutButtons() {
  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (hasSupabaseConfig()) await window.supabaseClient.auth.signOut();
      window.location.href = "login.html";
    });
  });
}

async function getSessionAccessToken() {
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  return session?.access_token || "";
}

async function callSupervisorApi(path, options = {}) {
  const token = await getSessionAccessToken();

  const response = await fetch(path, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

// ===============================
// HISTORY PAGE
// ===============================

function historyCard(record) {
  const image = record.signed_image_url
    ? `<img class="history-sketch-image" src="${escapeHtml(record.signed_image_url)}" alt="Saved AI-assisted sketch">`
    : `<div class="history-sketch-placeholder">Sketch image unavailable</div>`;
  const download = record.signed_image_url
    ? `<a class="secondary-action" href="${escapeHtml(record.signed_image_url)}" download>Download Sketch</a>`
    : "";

  return `<article class="history-card sketch-history-card">
    ${image}
    <h2>${escapeHtml(record.case_number || "Sketch Record")}</h2>
    <p><strong>Created:</strong> ${escapeHtml(formatDate(record.created_at))}</p>
    <p><strong>Mode:</strong> ${escapeHtml(record.mode || "AI-generated")}</p>
    <p><strong>Witness description:</strong> ${escapeHtml(record.witness_description || "No witness description saved.")}</p>
    <p><strong>Summary:</strong> ${escapeHtml(record.summary || "No summary saved.")}</p>
    ${download}
  </article>`;
}

async function initHistoryPage(authContext) {
  const list = document.getElementById("historyList");
  if (!list || !authContext) return;

  list.innerHTML = `<article class="history-card"><h2>Loading history...</h2><p>Retrieving saved sketches from Supabase.</p></article>`;

  try {
    const records = await callSupervisorApi("/api/sketch-history");

    if (!records || records.length === 0) {
      list.innerHTML = `<article class="history-card"><h2>No saved records yet</h2><p>Saved AI-assisted sketches will appear here after Botpress sends a save event.</p></article>`;
      return;
    }

    list.innerHTML = records.map(historyCard).join("");
  } catch (error) {
    console.error("History load error:", error);
    list.innerHTML = `<article class="history-card"><h2>Unable to load history</h2><p>${escapeHtml(error.message)}</p></article>`;
  }
}
// ===============================
// SUPERVISOR DASHBOARD
// ===============================

function officerRow(officer) {
  return `<tr>
    <td>${escapeHtml(officer.full_name || "Unnamed Officer")}</td>
    <td>${escapeHtml(officer.email || "No email")}</td>
    <td>${escapeHtml(officer.role || "Officer")}</td>
    <td>${escapeHtml(formatDate(officer.created_at))}</td>
    <td class="table-actions">
      <button type="button" class="secondary-action" data-update-officer="${escapeHtml(officer.id)}" data-name="${escapeHtml(officer.full_name || "")}" data-email="${escapeHtml(officer.email || "")}">Update</button>
      <button type="button" class="logout-button danger" data-remove-officer="${escapeHtml(officer.id)}">Remove</button>
    </td>
  </tr>`;
}

async function loadOfficerList() {
  const list = document.getElementById("officerList");
  if (!list) return;

  list.innerHTML = `<tr><td colspan="5">Loading officers...</td></tr>`;

  try {
    const officers = await callSupervisorApi("/api/officers");
    list.innerHTML = officers.length ? officers.map(officerRow).join("") : `<tr><td colspan="5">No officer accounts found.</td></tr>`;
  } catch (error) {
    console.error("Load officers error:", error);
    list.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    showMessage("supervisorMessage", error.message, true);
  }
}

function initSupervisorDashboard(authContext) {
  const form = document.getElementById("addOfficerForm");
  const list = document.getElementById("officerList");
  if (!form || !list || !authContext) return;

  loadOfficerList();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const full_name = document.getElementById("officerFullName").value.trim();
    const email = document.getElementById("officerEmail").value.trim().toLowerCase();
    const password = document.getElementById("officerPassword").value;

    try {
      await callSupervisorApi("/api/officers", {
        method: "POST",
        body: JSON.stringify({ full_name, email, password })
      });

      showMessage("supervisorMessage", "Officer added successfully.");
      form.reset();
      await loadOfficerList();
    } catch (error) {
      console.error("Add officer error:", error);
      showMessage("supervisorMessage", error.message, true);
    }
  });

  list.addEventListener("click", async (event) => {
    const removeButton = event.target.closest("[data-remove-officer]");
    const updateButton = event.target.closest("[data-update-officer]");

    if (removeButton) {
      if (!confirm("Remove this officer account?")) return;

      try {
        await callSupervisorApi(`/api/officers/${removeButton.dataset.removeOfficer}`, { method: "DELETE" });
        showMessage("supervisorMessage", "Officer removed successfully.");
        await loadOfficerList();
      } catch (error) {
        console.error("Remove officer error:", error);
        showMessage("supervisorMessage", error.message, true);
      }
    }

    if (updateButton) {
      const id = updateButton.dataset.updateOfficer;
      const full_name = prompt("Update officer full name:", updateButton.dataset.name || "");
      if (full_name === null) return;
      const email = prompt("Update officer email:", updateButton.dataset.email || "");
      if (email === null) return;

      try {
        await callSupervisorApi(`/api/officers/${id}`, {
          method: "PUT",
          body: JSON.stringify({ full_name: full_name.trim(), email: email.trim().toLowerCase() })
        });

        showMessage("supervisorMessage", "Officer updated successfully.");
        await loadOfficerList();
      } catch (error) {
        console.error("Update officer error:", error);
        showMessage("supervisorMessage", error.message, true);
      }
    }
  });
}

// ===============================
// BOTPRESS SETTINGS
// ===============================

async function loadBotpressSetting() {
  const container = document.getElementById("bp-embedded-webchat");
  if (!container || !hasSupabaseConfig()) return;

  const { data, error } = await window.supabaseClient.from("app_settings").select("*");
  if (error || !data) return;

  const setting = data.find((item) =>
    item.setting_key === "botpress_script_url" ||
    item.key === "botpress_script_url" ||
    item.name === "botpress_script_url"
  );

  const scriptUrl = setting?.botpress_script_url || setting?.setting_value || setting?.value || setting?.script_url;
  if (!scriptUrl || document.querySelector(`script[src="${scriptUrl}"]`)) return;

  const script = document.createElement("script");
  script.src = scriptUrl;
  script.defer = true;
  document.body.appendChild(script);
}


// ===============================
// BOTPRESS SKETCH AND CCTV SIGHTING SAVING
// ===============================

let botpressSketchSavingInitialised = false;
const savedSketchGenerationIds = new Set();
const savedCaseSightingKeys = new Set();

function showSketchSaveStatus(message, isError = false) {
  let status = document.getElementById("sketchSaveStatus");
  if (!status) {
    const shell = document.querySelector(".bot-shell");
    if (!shell) return;
    status = document.createElement("p");
    status.id = "sketchSaveStatus";
    status.className = "form-message";
    shell.appendChild(status);
  }

  status.textContent = message;
  status.classList.toggle("error", isError);
}

function normaliseBotpressEvent(event) {
  const candidates = [
    event?.payload?.payload,
    event?.data?.payload,
    event?.detail?.payload,
    event?.payload,
    event?.data,
    event?.detail,
    event
  ];

  return (
    candidates.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        ["saveSketch", "saveCaseSighting"].includes(candidate.action)
    ) || {}
  );
}

async function postWithSupabaseToken(url, body) {
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error("No logged-in Supabase session.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Request failed.");
  }

  return result;
}

async function saveSketchFromBotpress(payload) {
  const generationId = payload.generationId || `${payload.caseNumber || "case"}-${Date.now()}`;
  if (savedSketchGenerationIds.has(generationId)) {
    console.log("Sketch save skipped because generationId was already processed:", generationId);
    return;
  }

  savedSketchGenerationIds.add(generationId);
  showSketchSaveStatus("Saving AI-assisted sketch to History...");
  console.log("POST request started: /api/sketch-history");

  try {
    const result = await postWithSupabaseToken("/api/sketch-history", {
      caseNumber: payload.caseNumber,
      witnessDescription: payload.witnessDescription,
      summary: payload.summary,
      imageUrl: payload.imageUrl,
      mode: payload.mode || "AI-generated",
      generationId
    });

    console.log("sketch saved successfully", result);
    showSketchSaveStatus("Sketch saved to History.");
  } catch (error) {
    savedSketchGenerationIds.delete(generationId);
    console.error("Sketch saving failed:", error);
    showSketchSaveStatus(error.message, true);
  }
}

async function saveCaseSightingFromBotpress(payload) {
  const sightingKey = [
    payload.caseNumber,
    payload.locationName,
    payload.latitude,
    payload.longitude,
    payload.seenAt || payload.sightedAt
  ].join("|");

  if (savedCaseSightingKeys.has(sightingKey)) {
    console.log("CCTV sighting save skipped because it was already processed:", sightingKey);
    return;
  }

  savedCaseSightingKeys.add(sightingKey);
  showSketchSaveStatus("Saving CCTV sighting to case map...");
  console.log("POST request started: /api/case-sightings");

  try {
    const result = await postWithSupabaseToken("/api/case-sightings", {
      caseNumber: payload.caseNumber,
      sketchId: payload.sketchId || payload.generationId,
      generatedImageUrl: payload.generatedImageUrl || payload.imageUrl,
      locationName: payload.locationName,
      latitude: payload.latitude,
      longitude: payload.longitude,
      seenAt: payload.seenAt || payload.sightedAt,
      movementMode: payload.movementMode || "unknown",
      notes: payload.notes
    });

    console.log("CCTV sighting saved successfully", result);
    showSketchSaveStatus("CCTV sighting saved to the case map.");

    if (payload.openMapAfterSave && payload.caseNumber) {
      window.location.href = `case-map.html?caseNumber=${encodeURIComponent(payload.caseNumber)}`;
    }
  } catch (error) {
    savedCaseSightingKeys.delete(sightingKey);
    console.error("CCTV sighting saving failed:", error);
    showSketchSaveStatus(error.message, true);
  }
}

function initialiseBotpressSketchSaving() {
  if (botpressSketchSavingInitialised) return;
  if (!window.botpress?.on) return;

  botpressSketchSavingInitialised = true;

  window.botpress.on("customEvent", async (event) => {
    console.log("Botpress custom event received:", event);
    const payload = normaliseBotpressEvent(event);

    if (payload.action === "saveSketch") {
      await saveSketchFromBotpress(payload);
      return;
    }

    if (payload.action === "saveCaseSighting") {
      await saveCaseSightingFromBotpress(payload);
    }
  });
}

function waitForBotpressSketchSaving() {
  if (window.__visionFindBotpressCheckStarted) return;
  window.__visionFindBotpressCheckStarted = true;

  const botpressCheck = setInterval(() => {
    if (window.botpress?.on) {
      clearInterval(botpressCheck);
      initialiseBotpressSketchSaving();
      console.log("Botpress listener activated");
      console.log("Sketch and CCTV sighting saving listener activated");
    }
  }, 500);
}

document.addEventListener("DOMContentLoaded", waitForBotpressSketchSaving);
// ===============================
// PAGE STARTUP
// ===============================

(async () => {
  await initLoginPage();
  const authContext = await protectPage();
  await initHistoryPage(authContext);
  initSupervisorDashboard(authContext);
  await loadBotpressSetting();
  initLogoutButtons();
})();





