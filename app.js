"use strict";

// Find an HTML element by its ID.
const $ = (id) => document.getElementById(id);

const WIDTH = 960;
const HEIGHT = 540;

const video = $("video");
const scene = $("scene");
const overlay = $("overlay");

const sceneContext = scene.getContext("2d");
const overlayContext = overlay.getContext("2d");

// Saved data.
let events = [];

let preferences = {
  confidence: 65,
  armed: true,
  sound: false,
  cooldown: 10,
  maxEvents: 50
};

let zone = {
  x: 0,
  y: 0,
  w: WIDTH,
  h: HEIGHT
};

// Current monitoring session.
let mode = null;
let active = false;
let starting = false;
let stream = null;
let model = null;
let session = 0;

let lastEventTime = 0;
let personWasInside = false;
let demoPersonStart = null;

let drawing = false;
let drawingStart = null;
let drawingEnd = null;

let selectedEvent = null;
let audioContext = null;

// Load saved data.
try {
  const savedEvents = JSON.parse(
    localStorage.getItem("wt-events") || "[]"
  );

  const savedPreferences = JSON.parse(
    localStorage.getItem("wt-prefs") || "{}"
  );

  const savedZone = JSON.parse(
    localStorage.getItem("wt-zone") || "null"
  );

  if (Array.isArray(savedEvents)) {
    events = savedEvents;
  }

  preferences = {
    ...preferences,
    ...savedPreferences
  };

  if (savedZone) {
    zone = savedZone;
  }
} catch (error) {
  console.log("Saved data could not be loaded.");
}

$("today").textContent = new Date().toLocaleDateString(
  undefined,
  {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }
);

// Display a message below the camera.
function showNotice(message) {
  $("notice").textContent = message;
}

function saveEvents() {
  try {
    localStorage.setItem(
      "wt-events",
      JSON.stringify(events)
    );
  } catch (error) {
    showNotice(
      "Browser storage is full or unavailable. " +
      "Export or clear history to save more snapshots."
    );
  }
}

function savePreferences() {
  preferences.armed = $("armed").checked;
  preferences.sound = $("sound").checked;
  preferences.confidence = Number($("confidence").value);

  preferences.cooldown = Math.min(
    300,
    Math.max(3, Number($("cooldown").value) || 10)
  );

  preferences.maxEvents = Math.min(
    100,
    Math.max(10, Number($("maxEvents").value) || 50)
  );

  $("cooldown").value = preferences.cooldown;
  $("maxEvents").value = preferences.maxEvents;

  try {
    localStorage.setItem(
      "wt-prefs",
      JSON.stringify(preferences)
    );
  } catch (error) {
    showNotice("Preferences could not be saved.");
  }

  updateDashboard();
}

function saveZone() {
  try {
    localStorage.setItem(
      "wt-zone",
      JSON.stringify(zone)
    );
  } catch (error) {
    showNotice("The monitoring zone could not be saved.");
  }
}

// Create a unique event ID.
function createEventId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

// Switch between the three dashboard pages.
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = page.id !== pageId;
  });

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.dataset.page === pageId
    );
  });

  const pages = {
    overview: {
      title: "Security overview",
      description:
        "A clear view of what's happening, and what needs your attention.",
      breadcrumb: "Overview"
    },

    events: {
      title: "Event history",
      description:
        "Review captured activity and keep track of what matters.",
      breadcrumb: "Event history"
    },

    settings: {
      title: "Alert settings",
      description:
        "Make your monitoring workflow work for you.",
      breadcrumb: "Alert settings"
    }
  };

  $("pageTitle").textContent = pages[pageId].title;
  $("pageDesc").textContent = pages[pageId].description;
  $("breadcrumb").textContent = pages[pageId].breadcrumb;
}

// Build an event list using DOM elements.
function displayEvents(containerId, eventList) {
  const container = $(containerId);

  container.replaceChildren();

  if (eventList.length === 0) {
    const emptyMessage = document.createElement("div");

    emptyMessage.className = "activity-empty";
    emptyMessage.textContent =
      "No events here yet. Start a feed to capture activity.";

    container.append(emptyMessage);
    return;
  }

  eventList.forEach((event) => {
    const row = document.createElement("div");
    row.className = "event-row";

    const image = document.createElement("img");
    image.src = event.image;
    image.alt = "Event snapshot";

    const information = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = event.demo
      ? "Simulated zone entry"
      : "Person detected in zone";

    const description = document.createElement("p");

    description.textContent =
      new Date(event.time).toLocaleString() +
      " · " +
      event.confidence +
      "% confidence" +
      (event.demo ? " · DEMO" : "");

    information.append(title, description);

    const badge = document.createElement("span");

    badge.className = event.reviewed
      ? "badge reviewed"
      : "badge";

    badge.textContent = event.reviewed
      ? "Reviewed"
      : "Needs review";

    const reviewButton = document.createElement("button");
    reviewButton.textContent = "Review ↗";

    reviewButton.addEventListener("click", () => {
      openEvent(event.id);
    });

    row.append(
      image,
      information,
      badge,
      reviewButton
    );

    container.append(row);
  });
}

// Update dashboard totals and lists.
function updateDashboard() {
  const today = new Date().toDateString();

  const todaysEvents = events.filter((event) => {
    return new Date(event.time).toDateString() === today;
  });

  const unreviewedEvents = events.filter((event) => {
    return !event.reviewed;
  });

  $("todayCount").textContent = todaysEvents.length;
  $("reviewCount").textContent = unreviewedEvents.length;
  $("navCount").textContent = events.length;

  let statusText = "Standby";

  if (active) {
    statusText = preferences.armed ? "Armed" : "Paused";
  }

  const statusDot = document.createElement("em");
  statusDot.className = "statusDot";

  statusDot.style.background =
    active && preferences.armed
      ? "#38af87"
      : "#c4cbd5";

  $("status").replaceChildren(
    document.createTextNode(statusText + " "),
    statusDot
  );

  if (!active) {
    $("statusSub").textContent = "Ready when you are";
  } else if (preferences.armed) {
    $("statusSub").textContent =
      "Watching your detection zone";
  } else {
    $("statusSub").textContent =
      "Feed active · event logging paused";
  }

  if (mode === "demo") {
    $("source").textContent = "Simulation";
    $("sourceSub").textContent =
      "Simulated activity · no live detection";
  } else if (mode === "camera") {
    $("source").textContent = "Webcam";
    $("sourceSub").textContent =
      "On-device person detection";
  } else {
    $("source").textContent = "Not connected";
    $("sourceSub").textContent =
      "Webcam or interactive demo";
  }

  $("confidenceLabel").textContent =
    preferences.confidence + "%";

  const fullFrame =
    zone.x === 0 &&
    zone.y === 0 &&
    zone.w === WIDTH &&
    zone.h === HEIGHT;

  $("zoneText").textContent = fullFrame
    ? "Full camera frame"
    : "Custom monitoring area";

  displayEvents("recentList", events.slice(0, 4));

  const filter = $("filter").value;

  const filteredEvents = events.filter((event) => {
    if (filter === "reviewed") {
      return event.reviewed;
    }

    if (filter === "new") {
      return !event.reviewed;
    }

    return true;
  });

  displayEvents("allList", filteredEvents);
}

// Sound alert.
function prepareAudio() {
  try {
    const AudioClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioClass) {
      return;
    }

    if (!audioContext) {
      audioContext = new AudioClass();
    }

    audioContext.resume().catch(() => {});
  } catch (error) {
    console.log("Sound is unavailable.");
  }
}

function playAlert() {
  if (!preferences.sound) {
    return;
  }

  prepareAudio();

  if (!audioContext) {
    return;
  }

  try {
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();

    oscillator.connect(volume);
    volume.connect(audioContext.destination);

    oscillator.frequency.value = 700;
    volume.gain.value = 0.07;

    oscillator.start();

    volume.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.3
    );

    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (error) {
    console.log("The alert sound could not play.");
  }
}

// Check whether a bounding box overlaps the zone.
function overlapsZone(box) {
  const [x, y, width, height] = box;

  return (
    x + width > zone.x &&
    x < zone.x + zone.w &&
    y + height > zone.y &&
    y < zone.y + zone.h
  );
}

// Draw the zone and person bounding boxes.
function drawOverlay(people = []) {
  overlayContext.clearRect(
    0,
    0,
    WIDTH,
    HEIGHT
  );

  overlayContext.fillStyle = "#4477ff0e";

  overlayContext.fillRect(
    zone.x,
    zone.y,
    zone.w,
    zone.h
  );

  overlayContext.strokeStyle = "#87a8ff";
  overlayContext.lineWidth = 2;
  overlayContext.setLineDash([8, 6]);

  overlayContext.strokeRect(
    zone.x + 1,
    zone.y + 1,
    zone.w - 2,
    zone.h - 2
  );

  overlayContext.setLineDash([]);
  overlayContext.font = "13px monospace";
  overlayContext.fillStyle = "#9cb9ff";

  overlayContext.fillText(
    "MONITORING ZONE",
    zone.x + 12,
    zone.y + 45
  );

  people.forEach((person) => {
    const [x, y, width, height] = person.bbox;

    overlayContext.strokeStyle = overlapsZone(person.bbox)
      ? "#43d7a7"
      : "#95a8be";

    overlayContext.strokeRect(
      x,
      y,
      width,
      height
    );

    const labelY = Math.max(0, y - 23);

    overlayContext.fillStyle = "#122c2c";
    overlayContext.fillRect(x, labelY, 164, 23);

    overlayContext.fillStyle = "#76e6c3";

    overlayContext.fillText(
      "PERSON " + Math.round(person.score * 100) + "%",
      x + 8,
      labelY + 16
    );
  });

  // Show the rectangle currently being drawn.
  if (drawingStart && drawingEnd) {
    overlayContext.strokeStyle = "#ffffff";

    overlayContext.strokeRect(
      drawingStart.x,
      drawingStart.y,
      drawingEnd.x - drawingStart.x,
      drawingEnd.y - drawingStart.y
    );
  }
}

// Capture an event snapshot.
function recordEvent(confidence) {
  if (!preferences.armed || drawing) {
    return;
  }

  const now = Date.now();

  if (
    now - lastEventTime <
    preferences.cooldown * 1000
  ) {
    return;
  }

  const snapshot = document.createElement("canvas");
  snapshot.width = 480;
  snapshot.height = 270;

  const context = snapshot.getContext("2d");

  const source = mode === "demo" ? scene : video;

  try {
    context.drawImage(
      source,
      0,
      0,
      snapshot.width,
      snapshot.height
    );

    context.drawImage(
      overlay,
      0,
      0,
      snapshot.width,
      snapshot.height
    );

    const event = {
      id: createEventId(),
      time: new Date().toISOString(),
      confidence: Math.round(confidence * 100),
      image: snapshot.toDataURL("image/jpeg", 0.65),
      reviewed: false,
      demo: mode === "demo"
    };

    events.unshift(event);
    events = events.slice(0, preferences.maxEvents);

    lastEventTime = now;

    saveEvents();
    playAlert();
    updateDashboard();
  } catch (error) {
    showNotice("The event snapshot could not be captured.");
  }
}

// Detect a transition from outside to inside the zone.
function checkZoneActivity(people) {
  const peopleInZone = people.filter((person) => {
    return (
      person.score >= preferences.confidence / 100 &&
      overlapsZone(person.bbox)
    );
  });

  const someoneIsInside = peopleInZone.length > 0;

  if (someoneIsInside && !personWasInside) {
    const confidence = Math.max(
      ...peopleInZone.map((person) => person.score)
    );

    recordEvent(confidence);
  }

  personWasInside = someoneIsInside;
}

// Update the interface when a feed starts.
function activateFeed(type) {
  mode = type;
  active = true;
  personWasInside = false;
  lastEventTime = 0;

  $("empty").hidden = true;
  $("feedLabel").hidden = false;

  scene.style.display =
    type === "demo" ? "block" : "none";

  video.style.display =
    type === "camera" ? "block" : "none";

  $("feedName").textContent =
    type === "demo"
      ? "DEMO • SIMULATED ACTIVITY"
      : "LIVE • LOCAL CAMERA";

  $("liveLabel").textContent =
    type === "demo" ? "DEMO" : "LIVE";

  $("monitorDesc").textContent =
    type === "demo"
      ? "Interactive simulation · no real camera connected"
      : "Local camera · person detection enabled";

  $("feedStatus").textContent =
    type === "demo"
      ? "Simulation running"
      : "Camera connected";

  $("drawZone").disabled = false;
  $("stop").disabled = false;
  $("simulate").disabled = type !== "demo";

  updateDashboard();
}

// Stop the camera or simulation.
function stopFeed() {
  session++;
  active = false;
  starting = false;

  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }

  stream = null;
  video.srcObject = null;

  mode = null;
  demoPersonStart = null;
  personWasInside = false;

  drawing = false;
  drawingStart = null;
  drawingEnd = null;

  $("empty").hidden = false;
  $("feedLabel").hidden = true;

  scene.style.display = "none";
  video.style.display = "none";

  overlayContext.clearRect(
    0,
    0,
    WIDTH,
    HEIGHT
  );

  overlay.style.cursor = "default";

  $("startCamera").disabled = false;
  $("startDemo").disabled = false;

  $("drawZone").disabled = true;
  $("stop").disabled = true;
  $("simulate").disabled = true;

  $("drawZone").textContent = "▧ Draw zone";
  $("liveLabel").textContent = "OFFLINE";
  $("feedStatus").textContent = "No active feed";

  $("monitorDesc").textContent =
    "Connect a camera to begin monitoring";

  $("timecode").textContent = "";

  updateDashboard();
}

// Draw the simulated entrance.
function drawDemoScene(timestamp) {
  const background = sceneContext.createLinearGradient(
    0,
    0,
    0,
    HEIGHT
  );

  background.addColorStop(0, "#344450");
  background.addColorStop(0.7, "#26343f");
  background.addColorStop(1, "#172631");

  sceneContext.fillStyle = background;
  sceneContext.fillRect(0, 0, WIDTH, HEIGHT);

  // Wall.
  sceneContext.fillStyle = "#42535b";
  sceneContext.fillRect(0, 65, WIDTH, 290);

  sceneContext.fillStyle = "#31424a";

  for (let x = 0; x < WIDTH; x += 100) {
    sceneContext.fillRect(x, 65, 2, 290);
  }

  // Door.
  sceneContext.fillStyle = "#1c2c36";
  sceneContext.fillRect(365, 75, 220, 280);

  sceneContext.fillStyle = "#263b46";
  sceneContext.fillRect(377, 87, 196, 268);

  sceneContext.fillStyle = "#59717a";
  sceneContext.fillRect(554, 210, 4, 30);

  // Windows.
  sceneContext.fillStyle = "#607783";
  sceneContext.fillRect(60, 102, 200, 131);
  sceneContext.fillRect(690, 102, 200, 131);

  sceneContext.fillStyle = "#314e5c";
  sceneContext.fillRect(69, 111, 182, 113);
  sceneContext.fillRect(699, 111, 182, 113);

  sceneContext.strokeStyle = "#58707b";
  sceneContext.lineWidth = 4;
  sceneContext.beginPath();

  sceneContext.moveTo(160, 111);
  sceneContext.lineTo(160, 224);

  sceneContext.moveTo(790, 111);
  sceneContext.lineTo(790, 224);

  sceneContext.stroke();

  // Entrance sign.
  sceneContext.fillStyle = "#77908c";
  sceneContext.fillRect(402, 38, 147, 23);

  sceneContext.fillStyle = "#d5e6db";
  sceneContext.font = "12px monospace";
  sceneContext.fillText("NORTH ENTRANCE", 420, 54);

  // Floor.
  sceneContext.strokeStyle = "#30434c";
  sceneContext.lineWidth = 2;

  for (let y = 390; y < HEIGHT; y += 48) {
    sceneContext.beginPath();
    sceneContext.moveTo(0, y);
    sceneContext.lineTo(WIDTH, y);
    sceneContext.stroke();
  }

  for (let x = -WIDTH; x < WIDTH * 2; x += 180) {
    sceneContext.beginPath();
    sceneContext.moveTo(WIDTH / 2, 355);
    sceneContext.lineTo(x, HEIGHT);
    sceneContext.stroke();
  }

  // Plant pots.
  sceneContext.fillStyle = "#62746c";
  sceneContext.fillRect(78, 323, 43, 52);
  sceneContext.fillRect(831, 323, 43, 52);

  for (const x of [99, 852]) {
    sceneContext.strokeStyle = "#63847d";
    sceneContext.lineWidth = 7;
    sceneContext.beginPath();

    sceneContext.moveTo(x, 329);
    sceneContext.lineTo(x, 271);

    sceneContext.moveTo(x, 306);
    sceneContext.lineTo(x - 21, 282);

    sceneContext.moveTo(x, 301);
    sceneContext.lineTo(x + 23, 273);

    sceneContext.stroke();
  }

  const people = [];

  // Animate a simulated person across the scene.
  if (demoPersonStart !== null) {
    const progress = (timestamp - demoPersonStart) / 3500;

    if (progress > 1) {
      demoPersonStart = null;
    } else {
      const x = 190 + progress * 600;
      const y = 244;

      // Head.
      sceneContext.fillStyle = "#101e29";
      sceneContext.beginPath();

      sceneContext.ellipse(
        x + 37.5,
        y + 20,
        17,
        19,
        0,
        0,
        Math.PI * 2
      );

      sceneContext.fill();

      // Body.
      sceneContext.fillStyle = "#92a4a9";
      sceneContext.fillRect(x + 12, y + 43, 51, 74);

      // Legs.
      sceneContext.fillStyle = "#172735";
      sceneContext.fillRect(x + 16, y + 117, 17, 57);
      sceneContext.fillRect(x + 43, y + 117, 17, 57);

      // Arms.
      sceneContext.fillStyle = "#81979c";
      sceneContext.fillRect(x + 2, y + 49, 10, 73);
      sceneContext.fillRect(x + 63, y + 49, 10, 73);

      people.push({
        bbox: [x, y, 75, 174],
        score: 0.92
      });
    }
  }

  drawOverlay(people);
  checkZoneActivity(people);
}

function runDemo(timestamp) {
  if (!active || mode !== "demo") {
    return;
  }

  drawDemoScene(timestamp);

  $("timecode").textContent =
    new Date().toLocaleTimeString() + " • DEMO";

  requestAnimationFrame(runDemo);
}

// Load a third-party script only when needed.
function loadScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = source;

    script.onload = () => resolve();

    script.onerror = () => {
      script.remove();

      reject(
        new Error(
          "The detection library could not load. " +
          "Check your internet connection or try the demo."
        )
      );
    };

    document.head.append(script);
  });
}

// Connect the camera and load the detection model.
async function startCamera() {
  if (starting || active) {
    return;
  }

  starting = true;

  $("startCamera").disabled = true;
  $("startDemo").disabled = true;

  const currentSession = ++session;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access is unavailable. " +
        "Open the app at localhost or an HTTPS address."
      );
    }

    showNotice("Requesting camera access…");

    const cameraStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: WIDTH },
          height: { ideal: HEIGHT },
          facingMode: "environment"
        },

        audio: false
      });

    if (currentSession !== session) {
      cameraStream.getTracks().forEach((track) => {
        track.stop();
      });

      return;
    }

    stream = cameraStream;
    video.srcObject = stream;
    video.style.display = "block";

    await video.play();

    showNotice(
      "Loading the person detection model. " +
      "The first load may take a moment…"
    );

    if (!window.tf) {
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
      );
    }

    if (!window.cocoSsd) {
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"
      );
    }

    if (!model) {
      model = await window.cocoSsd.load({
        base: "lite_mobilenet_v2"
      });
    }

    if (currentSession !== session) {
      return;
    }

    activateFeed("camera");

    showNotice(
      "Person detection is running locally. " +
      "Draw a zone to focus your monitoring."
    );

    detectPeople(currentSession);
  } catch (error) {
    if (currentSession !== session) {
      return;
    }

    stopFeed();

    if (error.name === "NotAllowedError") {
      showNotice(
        "Camera access was denied. " +
        "Allow camera access in your browser or try the demo."
      );
    } else if (error.name === "NotFoundError") {
      showNotice(
        "No camera was found. Connect a webcam or try the demo."
      );
    } else {
      showNotice(error.message);
    }
  } finally {
    if (currentSession === session || !starting) {
      starting = false;
      $("startCamera").disabled = false;
      $("startDemo").disabled = false;
    }
  }
}

// Repeatedly detect people in the webcam image.
async function detectPeople(currentSession) {
  if (
    !active ||
    mode !== "camera" ||
    currentSession !== session
  ) {
    return;
  }

  try {
    const predictions = await model.detect(video);

    if (currentSession !== session) {
      return;
    }

    const people = predictions
      .filter((prediction) => {
        return (
          prediction.class === "person" &&
          prediction.score >= preferences.confidence / 100
        );
      })
      .map((prediction) => {
        const [x, y, width, height] = prediction.bbox;

        return {
          score: prediction.score,

          bbox: [
            x * WIDTH / video.videoWidth,
            y * HEIGHT / video.videoHeight,
            width * WIDTH / video.videoWidth,
            height * HEIGHT / video.videoHeight
          ]
        };
      });

    drawOverlay(people);
    checkZoneActivity(people);

    $("timecode").textContent =
      new Date().toLocaleTimeString();

    setTimeout(() => {
      detectPeople(currentSession);
    }, 180);
  } catch (error) {
    if (currentSession !== session) {
      return;
    }

    stopFeed();

    showNotice(
      "Detection stopped: " + error.message
    );
  }
}

// Convert mouse/touch coordinates into canvas coordinates.
function getCanvasPoint(event) {
  const bounds = overlay.getBoundingClientRect();

  return {
    x: Math.max(
      0,
      Math.min(
        WIDTH,
        (event.clientX - bounds.left) *
          WIDTH / bounds.width
      )
    ),

    y: Math.max(
      0,
      Math.min(
        HEIGHT,
        (event.clientY - bounds.top) *
          HEIGHT / bounds.height
      )
    )
  };
}

function finishDrawing() {
  drawing = false;
  drawingStart = null;
  drawingEnd = null;

  overlay.style.cursor = "default";
  $("drawZone").textContent = "▧ Draw zone";
}

// Event details popup.
function openEvent(eventId) {
  selectedEvent = events.find((event) => {
    return event.id === eventId;
  });

  if (!selectedEvent) {
    return;
  }

  $("detailImage").src = selectedEvent.image;

  $("detailText").textContent =
    (selectedEvent.demo
      ? "Simulated activity"
      : "Person detected") +
    " · " +
    new Date(selectedEvent.time).toLocaleString() +
    " · " +
    selectedEvent.confidence +
    "% confidence";

  $("markReviewed").disabled = selectedEvent.reviewed;

  $("markReviewed").textContent =
    selectedEvent.reviewed
      ? "Already reviewed"
      : "Mark as reviewed";

  $("detail").showModal();
}

// Export event metadata as CSV.
function exportEvents() {
  const rows = [
    "Timestamp,Source,Confidence,Status"
  ];

  events.forEach((event) => {
    rows.push(
      [
        event.time,
        event.demo ? "Simulation" : "Webcam",
        event.confidence,
        event.reviewed ? "Reviewed" : "Needs review"
      ].join(",")
    );
  });

  const file = new Blob(
    [rows.join("\r\n")],
    { type: "text/csv;charset=utf-8" }
  );

  const fileUrl = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = fileUrl;
  link.download = "watchtower-events.csv";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(fileUrl);
  }, 1000);
}

// Navigation buttons.
document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

document.querySelector(".brand").addEventListener(
  "click",
  (event) => {
    event.preventDefault();
    showPage("overview");
  }
);

$("viewEvents").addEventListener("click", () => {
  showPage("events");
});

$("back").addEventListener("click", () => {
  showPage("overview");
});

// Camera and simulation controls.
$("startCamera").addEventListener("click", startCamera);

$("startDemo").addEventListener("click", () => {
  if (starting || active) {
    return;
  }

  activateFeed("demo");

  showNotice(
    'Demo mode: use "Simulate a zone entry" ' +
    "to create labeled test events."
  );

  requestAnimationFrame(runDemo);
});

$("simulate").addEventListener("click", () => {
  if (!active || mode !== "demo") {
    return;
  }

  demoPersonStart = performance.now();
  personWasInside = false;

  if (preferences.armed) {
    showNotice(
      "A simulated person is crossing the scene. " +
      "Events respect your zone, confidence, and cooldown."
    );
  } else {
    showNotice(
      "Monitoring is paused. Arm monitoring to log events."
    );
  }
});

$("stop").addEventListener("click", () => {
  stopFeed();

  showNotice(
    "Feed stopped. Your saved events are still available."
  );
});

// Zone drawing controls.
$("drawZone").addEventListener("click", () => {
  if (drawing) {
    finishDrawing();
    showNotice("Zone drawing canceled.");
    return;
  }

  drawing = true;
  overlay.style.cursor = "crosshair";

  $("drawZone").textContent = "Cancel drawing";

  showNotice(
    "Drag a rectangle over the feed to set your detection zone."
  );
});

overlay.addEventListener("pointerdown", (event) => {
  if (!drawing) {
    return;
  }

  event.preventDefault();

  drawingStart = getCanvasPoint(event);
  drawingEnd = drawingStart;

  overlay.setPointerCapture(event.pointerId);
});

overlay.addEventListener("pointermove", (event) => {
  if (!drawing || !drawingStart) {
    return;
  }

  drawingEnd = getCanvasPoint(event);
});

overlay.addEventListener("pointerup", (event) => {
  if (!drawing || !drawingStart) {
    return;
  }

  const end = getCanvasPoint(event);

  const width = Math.abs(end.x - drawingStart.x);
  const height = Math.abs(end.y - drawingStart.y);

  if (width > 30 && height > 30) {
    zone = {
      x: Math.min(drawingStart.x, end.x),
      y: Math.min(drawingStart.y, end.y),
      w: width,
      h: height
    };

    saveZone();

    personWasInside = false;

    updateDashboard();

    showNotice(
      "Custom zone saved. " +
      "Only activity overlapping this area creates events."
    );
  } else {
    showNotice(
      "That zone was too small. Try drawing a larger rectangle."
    );
  }

  finishDrawing();
  drawOverlay();
});

overlay.addEventListener("pointercancel", () => {
  finishDrawing();
});

$("resetZone").addEventListener("click", () => {
  zone = {
    x: 0,
    y: 0,
    w: WIDTH,
    h: HEIGHT
  };

  saveZone();
  finishDrawing();

  personWasInside = false;

  updateDashboard();

  if (active) {
    drawOverlay();
  }

  showNotice("Detection zone reset to the full camera frame.");
});

// Apply saved settings to the controls.
$("armed").checked = preferences.armed;
$("sound").checked = preferences.sound;

$("confidence").value = preferences.confidence;
$("cooldown").value = preferences.cooldown;
$("maxEvents").value = preferences.maxEvents;

$("armed").addEventListener("change", () => {
  personWasInside = false;
  savePreferences();
});

$("sound").addEventListener("change", () => {
  if ($("sound").checked) {
    prepareAudio();
  }

  savePreferences();
});

$("confidence").addEventListener("input", () => {
  savePreferences();
});

$("cooldown").addEventListener("change", () => {
  savePreferences();
});

$("maxEvents").addEventListener("change", () => {
  savePreferences();
});

$("filter").addEventListener(
  "change",
  updateDashboard
);

// Review controls.
$("closeDetail").addEventListener("click", () => {
  $("detail").close();
});

$("markReviewed").addEventListener("click", () => {
  if (selectedEvent) {
    selectedEvent.reviewed = true;
  }

  saveEvents();
  updateDashboard();

  $("detail").close();
});

// History controls.
$("export").addEventListener("click", exportEvents);

$("clear").addEventListener("click", () => {
  if (events.length === 0) {
    return;
  }

  const confirmed = confirm(
    "Delete all saved events and snapshots from this browser?"
  );

  if (!confirmed) {
    return;
  }

  events = [];

  saveEvents();
  updateDashboard();
});

// Release the webcam when leaving the page.
window.addEventListener("pagehide", () => {
  session++;
  active = false;

  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
});

updateDashboard();