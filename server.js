const express = require("express");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const { createClient } = require("@supabase/supabase-js");

// CREATE APP
const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bgohfiryjuqetmonqrsz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "";

const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

// SERVE PUBLIC FOLDER
app.use(express.static(publicDir));
app.use(express.json());

// SUPERVISOR SECURITY CHECK
async function verifySupervisor(req) {
  if (!supabaseAdmin) {
    const error = new Error("Supervisor officer management requires SUPABASE_SERVICE_ROLE_KEY in .env.");
    error.status = 503;
    throw error;
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    const error = new Error("Missing Supabase session token.");
    error.status = 401;
    throw error;
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    const error = new Error("Invalid Supabase session token.");
    error.status = 401;
    throw error;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    const error = new Error("Supervisor profile not found.");
    error.status = 403;
    throw error;
  }

  if (profile.role !== "Supervisor") {
    const error = new Error("Only Supervisors can manage officers.");
    error.status = 403;
    throw error;
  }

  return { user: userData.user, profile };
}

async function requireSupervisor(req, res) {
  try {
    return await verifySupervisor(req);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
    return null;
  }
}

// OFFICER / SUPERVISOR SECURITY CHECK
async function verifyOfficerOrSupervisor(req) {
  if (!supabaseAdmin) {
    const error = new Error("Case sighting routes require SUPABASE_SERVICE_ROLE_KEY in .env.");
    error.status = 503;
    throw error;
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    const error = new Error("Missing Supabase session token.");
    error.status = 401;
    throw error;
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    const error = new Error("Invalid Supabase session token.");
    error.status = 401;
    throw error;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    const error = new Error("User profile not found.");
    error.status = 403;
    throw error;
  }

  if (!["Officer", "Supervisor"].includes(profile.role)) {
    const error = new Error("Only Officers and Supervisors can access case sightings.");
    error.status = 403;
    throw error;
  }

  return { user: userData.user, profile };
}

async function requireOfficerOrSupervisor(req, res) {
  try {
    return await verifyOfficerOrSupervisor(req);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
    return null;
  }
}
async function getAuthEmailsById() {
  const emailMap = new Map();
  if (!supabaseAdmin) return emailMap;

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error || !data?.users) return emailMap;

  data.users.forEach((user) => emailMap.set(user.id, user.email || ""));
  return emailMap;
}

function mergeProfileWithEmail(profile, emailMap, fallbackEmail = "") {
  return {
    ...profile,
    email: emailMap?.get(profile.id) || fallbackEmail || ""
  };
}

// SUPERVISOR OFFICER MANAGEMENT API
app.get("/api/officers", async (req, res) => {
  if (!(await requireSupervisor(req, res))) return;

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role, created_at")
    .eq("role", "Officer")
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const authEmails = await getAuthEmailsById();
  res.json((profiles || []).map((profile) => mergeProfileWithEmail(profile, authEmails)));
});

app.post("/api/officers", async (req, res) => {
  if (!(await requireSupervisor(req, res))) return;

  const { full_name, email, password } = req.body || {};
  if (!full_name || !email || !password) {
    res.status(400).json({ error: "Full name, email, and password are required." });
    return;
  }

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (createError || !createdUser.user) {
    res.status(500).json({ error: createError?.message || "Unable to create officer auth user." });
    return;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: createdUser.user.id,
      full_name,
      role: "Officer"
    })
    .select("id, full_name, role, created_at")
    .single();

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(createdUser.user.id);
    res.status(500).json({ error: profileError.message });
    return;
  }

  res.status(201).json({ ...profile, email });
});

app.put("/api/officers/:id", async (req, res) => {
  if (!(await requireSupervisor(req, res))) return;

  const { id } = req.params;
  const { full_name, email } = req.body || {};

  if (!full_name && !email) {
    res.status(400).json({ error: "Full name or email is required." });
    return;
  }

  if (email) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { email });
    if (authError) {
      res.status(500).json({ error: authError.message });
      return;
    }
  }

  const profileUpdate = { role: "Officer" };
  if (full_name) profileUpdate.full_name = full_name;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .update(profileUpdate)
    .eq("id", id)
    .eq("role", "Officer")
    .select("id, full_name, role, created_at")
    .single();

  if (profileError) {
    res.status(500).json({ error: profileError.message });
    return;
  }

  const authEmails = await getAuthEmailsById();
  res.json(mergeProfileWithEmail(profile, authEmails, email));
});

app.delete("/api/officers/:id", async (req, res) => {
  if (!(await requireSupervisor(req, res))) return;

  const { id } = req.params;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .delete()
    .eq("id", id)
    .eq("role", "Officer");

  if (profileError) {
    res.status(500).json({ error: profileError.message });
    return;
  }

  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (authError) {
    res.status(500).json({ error: authError.message });
    return;
  }

  res.json({ success: true });
});


// SKETCH HISTORY API
// Frontend Botpress events can save sketch records here after Supabase login.
function sanitizeStorageSegment(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

function extensionFromContentType(contentType) {
  const cleanType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (cleanType === "image/png") return "png";
  if (cleanType === "image/jpeg" || cleanType === "image/jpg") return "jpg";
  if (cleanType === "image/webp") return "webp";
  if (cleanType === "image/gif") return "gif";
  return "img";
}

async function verifyHistoryUser(req) {
  if (!supabaseAdmin) {
    const error = new Error("Sketch history saving requires SUPABASE_SERVICE_ROLE_KEY in .env.");
    error.status = 503;
    throw error;
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    const error = new Error("Missing Supabase session token.");
    error.status = 401;
    throw error;
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    const error = new Error("Invalid Supabase session token.");
    error.status = 401;
    throw error;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    const error = new Error("User profile not found.");
    error.status = 403;
    throw error;
  }

  return { user: userData.user, profile };
}

async function signedSketchRecord(record) {
  if (!record.image_path) return { ...record, signed_image_url: null };

  const { data, error } = await supabaseAdmin
    .storage
    .from("sketches")
    .createSignedUrl(record.image_path, 60 * 60);

  return {
    ...record,
    signed_image_url: error ? null : data?.signedUrl || null
  };
}

app.get("/api/sketch-history", async (req, res) => {
  let authContext;
  try {
    authContext = await verifyHistoryUser(req);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("sketch_history")
    .select("id, user_id, case_number, witness_description, summary, image_path, mode, generation_id, created_at")
    .eq("user_id", authContext.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const records = await Promise.all((data || []).map(signedSketchRecord));
  res.json(records);
});

app.post("/api/sketch-history", async (req, res) => {
  console.log("Sketch save request received");

  let authContext;
  try {
    authContext = await verifyHistoryUser(req);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
    return;
  }

  const { user, profile } = authContext;
  console.log("Authenticated officer ID:", user.id);

  if (profile.role !== "Officer") {
    res.status(403).json({ error: "Only Officers can save AI-assisted sketches." });
    return;
  }

  const {
    caseNumber,
    witnessDescription,
    summary,
    imageUrl,
    mode = "AI-generated",
    generationId
  } = req.body || {};

  if (!caseNumber || !imageUrl) {
    res.status(400).json({ error: "caseNumber and imageUrl are required." });
    return;
  }

  const safeGenerationId = sanitizeStorageSegment(generationId || `gen-${Date.now()}`, `gen-${Date.now()}`);

  const { data: existing, error: duplicateError } = await supabaseAdmin
    .from("sketch_history")
    .select("id, user_id, case_number, witness_description, summary, image_path, mode, generation_id, created_at")
    .eq("generation_id", safeGenerationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (duplicateError) {
    console.error("Database duplicate check failed:", duplicateError.message);
    res.status(500).json({ error: duplicateError.message });
    return;
  }

  if (existing) {
    const signedExisting = await signedSketchRecord(existing);
    res.status(200).json({ duplicate: true, record: signedExisting });
    return;
  }

  let imageResponse;
  try {
    imageResponse = await fetch(imageUrl);
  } catch (error) {
    console.error("Image download failure:", error.message);
    res.status(400).json({ error: `Image download failed: ${error.message}` });
    return;
  }

  if (!imageResponse.ok) {
    console.error("Image download failure:", imageResponse.status, imageResponse.statusText);
    res.status(400).json({ error: `Image download failed with status ${imageResponse.status}.` });
    return;
  }

  const contentType = imageResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    console.error("Image download failure: response was not an image", contentType);
    res.status(400).json({ error: `Generated URL did not return an image. Content-Type: ${contentType || "unknown"}` });
    return;
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  console.log("Image download success:", contentType, imageBuffer.length, "bytes");

  const extension = extensionFromContentType(contentType);
  const safeCaseNumber = sanitizeStorageSegment(caseNumber, "case");
  const imagePath = `${user.id}/${safeCaseNumber}/${safeGenerationId}.${extension}`;

  const { error: uploadError } = await supabaseAdmin
    .storage
    .from("sketches")
    .upload(imagePath, imageBuffer, {
      contentType,
      upsert: false
    });

  if (uploadError) {
    console.error("Storage upload failure:", uploadError.message);
    res.status(500).json({ error: uploadError.message });
    return;
  }

  console.log("Storage upload success:", imagePath);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("sketch_history")
    .insert({
      user_id: user.id,
      case_number: caseNumber,
      witness_description: witnessDescription || null,
      summary: summary || null,
      image_path: imagePath,
      mode,
      generation_id: safeGenerationId,
      created_at: new Date().toISOString()
    })
    .select("id, user_id, case_number, witness_description, summary, image_path, mode, generation_id, created_at")
    .single();

  if (insertError) {
    console.error("Database insert failure:", insertError.message);
    await supabaseAdmin.storage.from("sketches").remove([imagePath]);
    res.status(500).json({ error: insertError.message });
    return;
  }

  console.log("Database insert success:", inserted.id);
  const signedRecord = await signedSketchRecord(inserted);
  res.status(201).json({ record: signedRecord });
});
// CASE SIGHTING MAP API
function validateCaseCoordinate(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function normaliseMovementMode(value) {
  const mode = String(value || "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  return ["walking", "vehicle", "public_transport", "unknown"].includes(mode) ? mode : "unknown";
}

function caseSightingSelectColumns() {
  return "id, case_number, sketch_id, generated_image_url, location_name, latitude, longitude, seen_at, movement_mode, notes, created_at";
}

async function getCaseSightings(req, res, caseNumberSource) {
  if (!(await requireOfficerOrSupervisor(req, res))) return;

  const caseNumber = String(caseNumberSource || "").trim();
  if (!caseNumber) {
    res.status(400).json({ error: "caseNumber is required." });
    return;
  }

  console.log(`Case sighting lookup requested for case ${caseNumber}`);

  const { data, error } = await supabaseAdmin
    .from("case_sightings")
    .select(caseSightingSelectColumns())
    .ilike("case_number", caseNumber)
    .order("seen_at", { ascending: true });

  if (error) {
    console.error("Case sighting lookup failed:", error.message);
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ success: true, sightings: data || [] });
}

app.get("/api/case-sightings", async (req, res) => {
  await getCaseSightings(req, res, req.query.caseNumber);
});

app.get("/api/case-sightings/:caseNumber", async (req, res) => {
  await getCaseSightings(req, res, req.params.caseNumber);
});

app.post("/api/case-sightings", async (req, res) => {
  const authContext = await requireOfficerOrSupervisor(req, res);
  if (!authContext) return;

  const {
    caseNumber,
    sketchId,
    generatedImageUrl,
    locationName,
    latitude,
    longitude,
    seenAt,
    sightedAt,
    movementMode,
    notes
  } = req.body || {};

  const trimmedCaseNumber = String(caseNumber || "").trim();
  const trimmedLocationName = String(locationName || "").trim();
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  const parsedDate = new Date(seenAt || sightedAt);
  const normalisedMovementMode = normaliseMovementMode(movementMode);

  if (!trimmedCaseNumber) {
    res.status(400).json({ error: "caseNumber is required." });
    return;
  }

  if (!trimmedLocationName) {
    res.status(400).json({ error: "locationName is required." });
    return;
  }

  if (!validateCaseCoordinate(parsedLatitude, parsedLongitude)) {
    res.status(400).json({ error: "latitude and longitude must be valid coordinates." });
    return;
  }

  if (Number.isNaN(parsedDate.getTime())) {
    res.status(400).json({ error: "seenAt must be a valid date/time." });
    return;
  }

  if (parsedDate.getTime() > Date.now()) {
    res.status(400).json({ error: "seenAt cannot be in the future." });
    return;
  }

  const duplicateCheck = await supabaseAdmin
    .from("case_sightings")
    .select("id")
    .eq("case_number", trimmedCaseNumber)
    .eq("location_name", trimmedLocationName)
    .eq("latitude", parsedLatitude)
    .eq("longitude", parsedLongitude)
    .eq("seen_at", parsedDate.toISOString())
    .maybeSingle();

  if (duplicateCheck.error) {
    console.error("Duplicate sighting check failed:", duplicateCheck.error.message);
    res.status(500).json({ error: duplicateCheck.error.message });
    return;
  }

  if (duplicateCheck.data) {
    res.status(400).json({ error: "Duplicate sighting submission detected." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("case_sightings")
    .insert({
      case_number: trimmedCaseNumber,
      sketch_id: sketchId ? String(sketchId).trim() : null,
      generated_image_url: generatedImageUrl ? String(generatedImageUrl).trim() : null,
      location_name: trimmedLocationName,
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      seen_at: parsedDate.toISOString(),
      movement_mode: normalisedMovementMode,
      notes: notes ? String(notes).trim() : null
    })
    .select(caseSightingSelectColumns())
    .single();

  if (error) {
    console.error("Case sighting insert failed:", error.message);
    res.status(500).json({ error: error.message });
    return;
  }

  console.log(`Case sighting saved for ${trimmedCaseNumber} by ${authContext.profile.role}.`);
  res.status(201).json({ success: true, sighting: data });
});

// PROTECTED N8N FEATURE BRIDGE
// The browser calls this authenticated route; the private n8n URL stays on the server.
app.post("/api/visionfind", async (req, res) => {
  if (!(await requireOfficerOrSupervisor(req, res))) return;

  if (!N8N_WEBHOOK_URL) {
    res.status(503).json({
      error: "The VisionFind workflow connection is not configured yet.",
      action: "Set N8N_WEBHOOK_URL in the server .env file."
    });
    return;
  }

  const body = req.body || {};
  const feature = String(body.feature || "").trim().toLowerCase();
  const caseId = String(body.case_id || body.caseId || body.caseNumber || "").trim();
  // Sketch generation is handled by the embedded Botpress/Supabase flow.
  // n8n is used only to read Telegram witness tips and official map records.
  const allowedFeatures = new Set(["witness", "map"]);

  if (!allowedFeatures.has(feature)) {
    res.status(400).json({ error: "feature must be witness or map.", field: "feature" });
    return;
  }

  if (!caseId) {
    res.status(400).json({ error: "A Case ID is required.", field: "case_id" });
    return;
  }

  const workflowPayload = {
    ...body,
    feature,
    case_id: caseId
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const upstreamResponse = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(N8N_WEBHOOK_SECRET ? { "x-visionfind-secret": N8N_WEBHOOK_SECRET } : {})
      },
      body: JSON.stringify(workflowPayload),
      signal: controller.signal
    });

    const responseText = await upstreamResponse.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch (_error) {
      responseBody = { message: responseText || "Workflow returned an empty response." };
    }

    res.status(upstreamResponse.status).json(responseBody);
  } catch (error) {
    const timedOut = error.name === "AbortError";
    res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? "The VisionFind workflow took too long to respond."
        : "The VisionFind workflow could not be reached."
    });
  } finally {
    clearTimeout(timeout);
  }
});
// API FALLBACK
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});
// DEFAULT HOMEPAGE ROUTE
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// START SERVER
app.listen(PORT, () => {
  console.log(`VisionFind Sketch running on http://localhost:${PORT}`);
});








