function witnessField(record, ...names) {
  const entries = Object.entries(record || {});
  for (const name of names) {
    const match = entries.find(([key]) => key.trim().toLowerCase() === name.toLowerCase());
    if (match && match[1] !== "") return String(match[1]);
  }
  return "Not provided";
}

function setWitnessStatus(message, isError = false) {
  const status = document.getElementById("witnessTipsStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", Boolean(isError));
}

function tipDetail(label, value) {
  const row = document.createElement("p");
  const heading = document.createElement("strong");
  heading.textContent = `${label}: `;
  row.append(heading, document.createTextNode(value || "Not provided"));
  return row;
}

function witnessTipCard(tip, index) {
  const card = document.createElement("article");
  card.className = "witness-tip-card";

  const badge = document.createElement("span");
  badge.className = "tip-badge";
  badge.textContent = witnessField(tip, "Status");

  const title = document.createElement("h2");
  title.textContent = witnessField(tip, "TIP id", "Tip ID", "TIP ID") || `Witness Tip ${index + 1}`;

  card.append(
    badge,
    title,
    tipDetail("Missing person", witnessField(tip, "Missing Person")),
    tipDetail("Witness", witnessField(tip, "Witness Name/Contact", "Witness Name", "Witness Contact")),
    tipDetail("Location", witnessField(tip, "Location", "Sighting Location")),
    tipDetail("Date and time", [witnessField(tip, "Date", "Sighting Date"), witnessField(tip, "Time", "Sighting Time")].filter((value) => value !== "Not provided").join(" ") || "Not provided"),
    tipDetail("Appearance / clothing", witnessField(tip, "Appearance/Clothing", "Appearance", "Clothing")),
    tipDetail("Direction", witnessField(tip, "Direction")),
    tipDetail("Confidence", witnessField(tip, "Confidence", "Confidence Level")),
    tipDetail("Priority", witnessField(tip, "Priority")),
    tipDetail("AI summary", witnessField(tip, "AI Summary", "AI report"))
  );

  return card;
}

function renderWitnessTips(tips) {
  const list = document.getElementById("witnessTipsList");
  if (!list) return;
  list.replaceChildren();

  if (!tips.length) {
    const card = document.createElement("article");
    card.className = "witness-tip-card";
    const badge = document.createElement("span");
    badge.className = "tip-badge neutral";
    badge.textContent = "No reports";
    const title = document.createElement("h2");
    title.textContent = "No witness tips found";
    const body = document.createElement("p");
    body.textContent = "This case currently has no witness reports in the TIPS sheet.";
    card.append(badge, title, body);
    list.appendChild(card);
    return;
  }

  tips.forEach((tip, index) => list.appendChild(witnessTipCard(tip, index)));
}

async function loadWitnessTips(caseIdValue) {
  const caseId = String(caseIdValue || "").trim();
  if (!caseId) {
    setWitnessStatus("Enter a Case ID before searching.", true);
    return;
  }

  setWitnessStatus(`Loading witness tips for ${caseId}...`);

  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error("No active session. Please log in again.");

    const response = await fetch("/api/visionfind", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ feature: "witness", case_id: caseId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load witness tips.");

    const tips = Array.isArray(payload.tips) ? payload.tips : [];
    renderWitnessTips(tips);
    setWitnessStatus(tips.length ? `Loaded ${tips.length} witness tip${tips.length === 1 ? "" : "s"}.` : "No witness tips are currently recorded for this case.");
  } catch (error) {
    console.error("Witness tip search failed:", error);
    setWitnessStatus(error.message, true);
    renderWitnessTips([]);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("witnessTipsSearchForm");
  const input = document.getElementById("witnessTipsCaseId");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    loadWitnessTips(input?.value);
  });

  const caseNumber = new URLSearchParams(window.location.search).get("caseNumber");
  if (caseNumber && input) {
    input.value = caseNumber;
    loadWitnessTips(caseNumber);
  }
});
