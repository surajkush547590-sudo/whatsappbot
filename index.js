// index.js
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');

// --------- CONFIG ---------
const SESSION_NAME = 'my-whatsapp-bot';
const ADMIN_NUMBER = '91XXXXXXXXXX@c.us'; // <-- CHANGE THIS
const SESSIONS_FILE = './sessions.json';
const LEADS_CSV = './leads.csv';

// Ensure session file exists
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}), 'utf8');

// ===== CSV Helpers (No dependency) =====
function ensureCsvHeader() {
  if (!fs.existsSync(LEADS_CSV)) {
    fs.writeFileSync(LEADS_CSV, `"timestamp","chatId","name","flow","data"\n`);
  }
}
function appendCsvRow(arr) {
  const safe = arr.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',') + "\n";
  fs.appendFileSync(LEADS_CSV, safe);
}
ensureCsvHeader();

// Load/Save sessions
function loadSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveSessions(s) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2));
}

// Get user display name
function getSenderName(msg) {
  return (msg.sender?.pushname || msg.sender?.formattedName || msg.notifyName || "User");
}

// ------- MAIN MENU -------
const MAIN_MENU = `Welcome to Immigration Help 👋
Please choose an option by typing the number:

1️⃣ Canada PR  
2️⃣ Student Visa  
3️⃣ Work Permit  
4️⃣ Tourist Visa  
5️⃣ Business / Startup Visa  
6️⃣ Eligibility Check  
7️⃣ Talk to an Expert (Human Support)

Type *menu* anytime to see this menu again.
Type *restart* to restart the conversation.`;

// -------- GREETING IMAGE SUPPORT --------
const WELCOME_IMAGE = path.join(__dirname, "assets", "welcome.jpg");

async function sendGreetingWithImage(client, chatId, name) {
  try {
    if (fs.existsSync(WELCOME_IMAGE)) {
      await client.sendFile(
        chatId,
        WELCOME_IMAGE,
        "welcome.jpg",
        `Hello ${name}! 👋\n\n${MAIN_MENU}`
      );
      return;
    }
  } catch (e) {
    console.error("Greeting image send failed:", e);
  }
  await client.sendText(chatId, `Hello ${name}! 👋\n\n${MAIN_MENU}`);
}

// ------- Eligibility logic -------
function evaluateEligibility(data) {
  let score = 0;
  if (data.age >= 18 && data.age <= 45) score += 2;
  if (data.education) {
    const e = data.education.toLowerCase();
    if (e.includes("master") || e.includes("bachelor") || e.includes("phd")) score += 2;
  }
  if (data.experience >= 2) score += 2;
  if (data.ielts >= 6) score += 2;
  if (data.country && data.country.toLowerCase() !== "india") score += 1;

  return score >= 7 ? { result: "High chance", score }
       : score >= 4 ? { result: "Possible", score }
       : { result: "Low chance", score };
}

// -------- PERSONAL DETAILS FLOW ------
const PERSONAL_FIELDS = ["name","phone","email","age","city","country","education","experience"];
const PERSONAL_QUESTIONS = {
  name: "Please share your *full name*:",
  phone: "Send your *phone number* with country code:",
  email: "Enter your *email address* (or type N/A):",
  age: "What is your *age*?",
  city: "Which *city* are you in?",
  country: "Which *country* are you living in?",
  education: "Your *highest education*?",
  experience: "Your *work experience* (in years)?"
};

function initPersonal(session) {
  if (!session.personal) session.personal = {};
  if (session.personalIndex === undefined) session.personalIndex = 0;
}

function validatePersonal(field, value) {
  value = value.trim();

  if (field === "phone") {
    const d = value.replace(/\D/g, "");
    if (d.length < 8) return { ok: false, msg: "Invalid phone. Send again with country code." };
    return { ok: true, val: d };
  }

  if (field === "email") {
    if (value.toLowerCase() === "n/a") return { ok: true, val: "" };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { ok: true, val: value };
    return { ok: false, msg: "Invalid email. Send again or type N/A." };
  }

  if (["age","experience"].includes(field)) {
    const n = Number(value);
    if (isNaN(n) || n < 0) return { ok: false, msg: `Please send a valid number for ${field}.` };
    return { ok: true, val: n };
  }

  if (!value) return { ok: false, msg: `Please enter your ${field}.` };
  return { ok: true, val: value };
}

async function runPersonalFlow(client, msg, session, sessions, text) {
  const chatId = msg.from;
  initPersonal(session);

  const i = session.personalIndex;
  if (i >= PERSONAL_FIELDS.length) return true;

  const field = PERSONAL_FIELDS[i];
  const validation = validatePersonal(field, text);

  if (!validation.ok) {
    await client.sendText(chatId, validation.msg);
    return false;
  }

  session.personal[field] = validation.val;
  session.personalIndex++;

  saveSessions(sessions);

  if (session.personalIndex >= PERSONAL_FIELDS.length) return true;

  const nextField = PERSONAL_FIELDS[session.personalIndex];
  await client.sendText(chatId, PERSONAL_QUESTIONS[nextField]);
  return false;
}

// PERSONAL SUMMARY
function personalSummary(p) {
  return `Name: ${p.name}
Phone: ${p.phone}
Email: ${p.email}
Age: ${p.age}
City: ${p.city}
Country: ${p.country}
Education: ${p.education}
Experience: ${p.experience} years`;
}

// ---------- Start WPPConnect ----------
wppconnect.create({
  session: SESSION_NAME,
  headless: false
})
.then(client => start(client))
.catch(err => console.error("Create client error", err));

function start(client) {
  console.log("🚀 WhatsApp Immigration Bot is running...");

  client.onMessage(async (msg) => {
    try {
      if (msg.isGroupMsg) return;

      const sessions = loadSessions();
      const chatId = msg.from;

      if (!sessions[chatId]) {
        sessions[chatId] = {
          flow: null,
          step: null,
          data: {},
          personal: {},
          personalIndex: 0,
          greeted: false
        };
      }
      const session = sessions[chatId];
      const text = String(msg.body || "").trim();

      // ===== AUTO GREETING WITH IMAGE =====
      if (!session.greeted) {
        session.greeted = true;
        saveSessions(sessions);
        await sendGreetingWithImage(client, chatId, getSenderName(msg));
        return;
      }

      // hi/hello greeting
      if (/^(hi|hello|hey)$/i.test(text)) {
        await sendGreetingWithImage(client, chatId, getSenderName(msg));
        return;
      }

      // Commands
      if (text.toLowerCase() === "menu") {
        session.flow = null; session.step = null;
        session.personal = {}; session.personalIndex = 0;
        saveSessions(sessions);
        return client.sendText(chatId, MAIN_MENU);
      }

      if (text.toLowerCase() === "restart") {
        sessions[chatId] = {
          flow: null, step: null,
          data: {}, personal: {}, personalIndex: 0, greeted: true
        };
        saveSessions(sessions);
        return client.sendText(chatId, "Conversation restarted.\n\n" + MAIN_MENU);
      }

      // ----- If no flow selected -----
      if (!session.flow) {
        if (["1","2","3","4","5","6","7"].includes(text)) {
          session.flow = {
            "1":"CANADA_PR",
            "2":"STUDENT_VISA",
            "3":"WORK_PERMIT",
            "4":"TOURIST_VISA",
            "5":"BUSINESS_VISA",
            "6":"ELIGIBILITY",
            "7":"HANDOFF"
          }[text];

          session.step = "collect_personal";
          session.personal = {};
          session.personalIndex = 0;
          saveSessions(sessions);

          await client.sendText(chatId, PERSONAL_QUESTIONS["name"]);
          return;
        }

        return client.sendText(chatId, "I didn't understand.\n\n" + MAIN_MENU);
      }

      // ----- PERSONAL DETAILS FLOW FIRST -----
      if (session.step === "collect_personal") {
        const done = await runPersonalFlow(client, msg, session, sessions, text);
        if (!done) return;

        session.step = "service";
        saveSessions(sessions);

        await client.sendText(chatId, "👍 Personal details collected!\n\n" + personalSummary(session.personal));
        await client.sendText(chatId, "Continuing your selected service...");
      }

      // ROUTE TO SERVICE FLOWS
      if (session.step === "service") {
        if (session.flow === "CANADA_PR") return handleCanadaPR(client, msg, session, sessions, text);
        if (session.flow === "STUDENT_VISA") return handleStudentVisa(client, msg, session, sessions, text);
        if (session.flow === "WORK_PERMIT") return handleWorkPermit(client, msg, session, sessions, text);
        if (session.flow === "TOURIST_VISA") return handleTouristVisa(client, msg, session, sessions, text);
        if (session.flow === "BUSINESS_VISA") return handleBusinessVisa(client, msg, session, sessions, text);
        if (session.flow === "ELIGIBILITY") return handleEligibility(client, msg, session, sessions, text);
        if (session.flow === "HANDOFF") return handleHandoff(client, msg, session, sessions, text);
      }

    } catch (e) {
      console.error("onMessage error:", e);
    }
  });
}

// ---------------- SERVICE FLOWS ----------------
async function handleCanadaPR(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "ask_eligibility";
    return client.sendText(chatId, "Do you want an eligibility check? (yes/no)");
  }

  if (session.data.stage === "ask_eligibility") {
    if (/yes/i.test(text)) {
      session.data.stage = "ielts";
      return client.sendText(chatId, "Send your IELTS score (or type No)");
    } else {
      session.data.stage = "message";
      return client.sendText(chatId, "Any message for our Canada expert?");
    }
  }

  if (session.data.stage === "ielts") {
    session.data.ielts = /no/i.test(text) ? null : text;
    await saveLeadAndNotify(client, chatId, session, "Canada PR");
    clearSession(session, sessions);
    return client.sendText(chatId, "Thanks! Our team will evaluate your profile.");
  }

  if (session.data.stage === "message") {
    session.data.message = text;
    await saveLeadAndNotify(client, chatId, session, "Canada PR");
    clearSession(session, sessions);
    return client.sendText(chatId, "Thanks! Our expert will contact you.");
  }
}

// STUDENT VISA
async function handleStudentVisa(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "country";
    return client.sendText(chatId, "Which country do you want to study in?");
  }
  if (session.data.stage === "country") {
    session.data.country = text;
    session.data.stage = "course";
    return client.sendText(chatId, "Which course (Bachelor/Master/Diploma)?");
  }
  if (session.data.stage === "course") {
    session.data.course = text;
    session.data.stage = "score";
    return client.sendText(chatId, "Your IELTS/TOEFL score? (or type No)");
  }
  if (session.data.stage === "score") {
    session.data.ielts = /no/i.test(text) ? null : text;
    await saveLeadAndNotify(client, chatId, session, "Student Visa");
    clearSession(session, sessions);
    return client.sendText(chatId, "Thanks! Our counselor will contact you.");
  }
}

// WORK PERMIT
async function handleWorkPermit(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "country";
    return client.sendText(chatId, "Which country?");
  }
  if (session.data.stage === "country") {
    session.data.country = text;
    session.data.stage = "profession";
    return client.sendText(chatId, "Your profession?");
  }
  if (session.data.stage === "profession") {
    session.data.profession = text;
    await saveLeadAndNotify(client, chatId, session, "Work Permit");
    clearSession(session, sessions);
    return client.sendText(chatId, "Thanks! We will check opportunities.");
  }
}

// TOURIST VISA
async function handleTouristVisa(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "country";
    return client.sendText(chatId, "Which country do you want to visit?");
  }
  if (session.data.stage === "country") {
    session.data.country = text;
    session.data.stage = "days";
    return client.sendText(chatId, "How many days?");
  }
  if (session.data.stage === "days") {
    session.data.days = text;
    await saveLeadAndNotify(client, chatId, session, "Tourist Visa");
    clearSession(session, sessions);
    return client.sendText(chatId, "Thanks! We will share the process.");
  }
}

// BUSINESS VISA
async function handleBusinessVisa(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "idea";
    return client.sendText(chatId, "Describe your business/startup idea:");
  }
  if (session.data.stage === "idea") {
    session.data.idea = text;
    session.data.stage = "investment";
    return client.sendText(chatId, "Estimated investment/team size?");
  }
  if (session.data.stage === "investment") {
    session.data.investment = text;
    await saveLeadAndNotify(client, chatId, session, "Business Visa");
    clearSession(session, sessions);
    return client.sendText(chatId, "Thanks! Our business visa team will contact you.");
  }
}

// ELIGIBILITY CHECK
async function handleEligibility(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "age";
    return client.sendText(chatId, "What is your age?");
  }
  if (session.data.stage === "age") {
    session.data.age = Number(text);
    session.data.stage = "edu";
    return client.sendText(chatId, "Your highest education?");
  }
  if (session.data.stage === "edu") {
    session.data.education = text;
    session.data.stage = "exp";
    return client.sendText(chatId, "Work experience (yrs)?");
  }
  if (session.data.stage === "exp") {
    session.data.experience = Number(text);
    session.data.stage = "ielts";
    return client.sendText(chatId, "IELTS score? (or No)");
  }
  if (session.data.stage === "ielts") {
    session.data.ielts = /no/i.test(text) ? null : Number(text);
    session.data.stage = "country";
    return client.sendText(chatId, "Which country?");
  }
  if (session.data.stage === "country") {
    session.data.country = text;

    const res = evaluateEligibility({ ...session.personal, ...session.data });

    await saveLeadAndNotify(client, chatId, session, "Eligibility Check");
    clearSession(session, sessions);

    return client.sendText(chatId, `Eligibility Result: *${res.result}* (Score: ${res.score})`);
  }
}

// HANDOFF
async function handleHandoff(client, msg, session, sessions, text) {
  const chatId = msg.from;

  if (!session.data.stage) {
    session.data.stage = "message";
    return client.sendText(chatId, "Any message for our expert?");
  }

  if (session.data.stage === "message") {
    session.data.message = text;
    await saveLeadAndNotify(client, chatId, session, "Human Handoff");
    clearSession(session, sessions);
    return client.sendText(chatId, "Our expert has been notified and will contact you shortly.");
  }
}

// ---- SAVE LEAD + ADMIN NOTIFY ----
async function saveLeadAndNotify(client, chatId, session, flowName) {
  const timestamp = new Date().toISOString();
  const lead = { ...session.personal, ...session.data };
  const name = lead.name || "Unknown";
  const dataString = JSON.stringify(lead);

  appendCsvRow([timestamp, chatId, name, flowName, dataString]);

  const adminMsg = `🔔 New Lead (${flowName})
Name: ${name}
Chat: ${chatId}
Data: ${dataString}
Time: ${timestamp}`;

  try { await client.sendText(ADMIN_NUMBER, adminMsg); }
  catch (e) { console.error("Admin notify failed:", e); }
}

// ---- CLEAR SESSION ----
function clearSession(session, sessions) {
  session.flow = null;
  session.step = null;
  session.data = {};
  saveSessions(sessions);
}
