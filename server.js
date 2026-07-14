const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { google } = require("googleapis");
require("dotenv").config();

if (process.env.DISABLE_OUTBOUND_PROXY !== "false") {
  [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy"
  ].forEach((name) => {
    delete process.env[name];
  });
}

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3100);
const PUBLIC_DIR = path.join(__dirname, "public");
const CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE || "credentials.json");
const DATA_DIR = path.join(__dirname, process.env.DATA_DIR || ".data");
const AUTH_STORE_PATH = path.join(DATA_DIR, process.env.AUTH_STORE_FILE || "auth-store.json");
const SHEET_ACCESS_PATH = path.join(DATA_DIR, process.env.SHEET_ACCESS_FILE || "sheet-access.json");
const AUTH_STORE_BACKEND = process.env.AUTH_STORE_BACKEND || (process.env.K_SERVICE ? "firestore" : "file");
const FIRESTORE_AUTH_DOC = process.env.FIRESTORE_AUTH_DOC || "runtime/authStore";
const SESSION_COOKIE = process.env.K_SERVICE ? "__session" : (process.env.SESSION_COOKIE_NAME || "inventory_session");
const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || "";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 168) * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets"
];

const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || "A1:I1000";
const SUMMARY_SHEET_RANGE = process.env.GOOGLE_SUMMARY_SHEET_RANGE || "A1:Z120";
const HIDE_NON_EDITABLE_SHEETS = process.env.HIDE_NON_EDITABLE_SHEETS !== "false";
const REPORT_SUMMARY_SHEET = process.env.REPORT_SUMMARY_SHEET || "\u0417\u0432\u0435\u0434\u0435\u043d\u0430 \u0456\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0456\u044f";
const REPORT_SUMMARY_FIRST_ROW = Number(process.env.REPORT_SUMMARY_FIRST_ROW || 3);
const REPORT_PERIOD_CELL = process.env.REPORT_PERIOD_CELL || "F1";
const REPORT_UNIT_SUMMARY_COLUMNS = process.env.REPORT_UNIT_SUMMARY_COLUMNS
  ? JSON.parse(process.env.REPORT_UNIT_SUMMARY_COLUMNS)
  : {
      "1 \u0420\u0411\u043f\u0410\u041a": 1,
      "1 \u0420\u0423\u0411\u043f\u0410\u041a": 5,
      "2 \u0420\u0411\u043f\u0410\u041a": 9,
      "\u041d\u0420\u041a": 13,
      "2 \u0420\u0423\u0411\u043f\u0410\u041a": 17,
      "\u0413\u0440\u0435\u043a": 21
    };
const STATUS_COLUMN_INDEX = 5;
const EDITABLE_FIELD_COLUMNS = {
  damage: 6,
  circumstances: 7,
  repairDate: 8
};

function logAuth(event, details = {}) {
  console.info(JSON.stringify({
    area: "auth",
    event,
    store: AUTH_STORE_BACKEND,
    service: process.env.K_SERVICE || "local",
    ...details
  }));
}

function logServerError(event, error, details = {}) {
  const googleError = error?.response?.data?.error || error?.response?.data || null;
  console.error(JSON.stringify({
    area: "server",
    event,
    name: error?.name,
    code: error?.code || error?.response?.status || "",
    message: error?.message || String(error),
    googleMessage: googleError?.message || "",
    googleStatus: googleError?.status || "",
    ...details
  }));
}

const STATUSES = [
  { key: "stock", label: "На складі", sheetValue: "На складі підрозділу" },
  { key: "repair", label: "Ремонт", sheetValue: "Ремонт" },
  { key: "damaged", label: "Пошкоджені", sheetValue: "Пошкоджені на позиції" },
  { key: "lost", label: "Втрачені", sheetValue: "Втрачено" }
];
const BATTLE_POSITION_LABEL = "На позиції БГ";
const BATTLE_POSITION_PREFIXES = ["лх", "тз", "пурк"];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Заповніть ${name} у .env`);
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function emptyAuthStore() {
  return {
    users: {},
    sessions: {},
    pendingStates: {}
  };
}

function firestoreDb() {
  if (!firestoreDb.instance) {
    const admin = require("firebase-admin");
    if (!admin.apps.length) admin.initializeApp();
    firestoreDb.instance = admin.firestore();
  }
  return firestoreDb.instance;
}

async function readAuthStore() {
  if (AUTH_STORE_BACKEND === "firestore") {
    const snapshot = await firestoreDb().doc(FIRESTORE_AUTH_DOC).get();
    return { ...emptyAuthStore(), ...(snapshot.exists ? snapshot.data() : {}) };
  }

  if (!fs.existsSync(AUTH_STORE_PATH)) return emptyAuthStore();
  return { ...emptyAuthStore(), ...readJson(AUTH_STORE_PATH) };
}

async function writeAuthStore(store) {
  if (AUTH_STORE_BACKEND === "firestore") {
    await firestoreDb().doc(FIRESTORE_AUTH_DOC).set(store);
    return;
  }

  writeJson(AUTH_STORE_PATH, store);
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function parseCookies(request) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) return cookies;
      cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

function cookieOptions(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "");
  const host = String(request.headers.host || "");
  const isHttps = forwardedProto.split(",").map((value) => value.trim()).includes("https")
    || Boolean(request.socket.encrypted)
    || host.endsWith(".web.app")
    || host.endsWith(".firebaseapp.com")
    || Boolean(process.env.K_SERVICE);
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    SESSION_COOKIE_DOMAIN ? `Domain=${SESSION_COOKIE_DOMAIN}` : "",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    isHttps ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function setSessionCookie(response, request, sessionId) {
  const options = cookieOptions(request);
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ${options}`);
  logAuth("set-cookie", {
    host: request.headers.host || "",
    proto: request.headers["x-forwarded-proto"] || "",
    domain: SESSION_COOKIE_DOMAIN || "host-only",
    secure: options.includes("Secure")
  });
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function publicAppOrigin() {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!redirectUri) return "";

  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function publicRedirectLocation(returnTo) {
  const origin = publicAppOrigin();
  if (!origin || !String(returnTo || "").startsWith("/")) return returnTo || "/";
  return `${origin}${returnTo}`;
}

function cleanupAuthStore(store) {
  const now = Date.now();

  Object.entries(store.sessions || {}).forEach(([sessionId, session]) => {
    if (!session?.expiresAt || session.expiresAt <= now) delete store.sessions[sessionId];
  });

  Object.entries(store.pendingStates || {}).forEach(([state, pending]) => {
    if (!pending?.expiresAt || pending.expiresAt <= now) delete store.pendingStates[state];
  });
}

async function currentSession(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return { sessionId: "", session: null, store: await readAuthStore() };

  const store = await readAuthStore();
  cleanupAuthStore(store);
  const session = store.sessions[sessionId] || null;

  if (!session || session.expiresAt <= Date.now()) {
    delete store.sessions[sessionId];
    await writeAuthStore(store);
    return { sessionId: "", session: null, store };
  }

  return { sessionId, session, store };
}

function normalizeReturnTo(value, request) {
  if (!value) return "/";

  try {
    const base = `http://${request.headers.host}`;
    const nextUrl = new URL(value, base);
    if (nextUrl.host !== request.headers.host) return "/";
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return "/";
  }
}

function oauthClient() {
  const envClientId = process.env.GOOGLE_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const envRedirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (envClientId && envClientSecret) {
    return new google.auth.OAuth2(
      envClientId,
      envClientSecret,
      envRedirectUri || `http://${HOST}:${PORT}/oauth2callback`
    );
  }

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Не знайдено ${path.basename(CREDENTIALS_PATH)}. Покладіть OAuth credentials у папку проєкту.`);
  }

  const credentials = readJson(CREDENTIALS_PATH);
  const config = credentials.installed || credentials.web;
  if (!config) throw new Error("credentials.json має містити installed або web OAuth client.");

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    config.redirect_uris?.[0] ||
    `http://${HOST}:${PORT}/oauth2callback`;
  return new google.auth.OAuth2(config.client_id, config.client_secret, redirectUri);
}

async function createAuthUrl(returnTo = "/") {
  const state = randomToken();
  const store = await readAuthStore();
  cleanupAuthStore(store);
  store.pendingStates[state] = {
    returnTo,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  };
  await writeAuthStore(store);
  logAuth("state-created", {
    returnTo,
    pendingStates: Object.keys(store.pendingStates || {}).length
  });

  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state
  });
}

function authRequiredError() {
  const error = new Error("Потрібна авторизація Google.");
  error.code = "AUTH_REQUIRED";
  error.authUrl = "/auth/google";
  return error;
}

async function fetchGoogleUser(client) {
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const response = await oauth2.userinfo.get();
  const user = response.data || {};
  if (!user.id && !user.email) throw new Error("Google не повернув профіль користувача.");

  return {
    id: String(user.id || user.email),
    email: user.email || "",
    name: user.name || user.email || "Google user",
    picture: user.picture || ""
  };
}

async function createUserSession(request, response, code, state) {
  const store = await readAuthStore();
  cleanupAuthStore(store);
  logAuth("callback-start", {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    pendingStates: Object.keys(store.pendingStates || {}).length
  });

  const pending = store.pendingStates[state];
  if (!state || !pending) {
    const error = new Error("OAuth сесія застаріла. Перезапускаємо вхід через Google.");
    error.code = "OAUTH_STATE_EXPIRED";
    throw error;
  }
  delete store.pendingStates[state];

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const profile = await fetchGoogleUser(client);
  logAuth("profile-loaded", {
    email: profile.email || "",
    hasRefreshToken: Boolean(tokens.refresh_token)
  });
  const previousUser = store.users[profile.id] || {};
  const previousTokens = previousUser.tokens || {};

  store.users[profile.id] = {
    ...profile,
    tokens: {
      ...previousTokens,
      ...tokens,
      refresh_token: tokens.refresh_token || previousTokens.refresh_token
    },
    updatedAt: new Date().toISOString()
  };

  const sessionId = randomToken();
  store.sessions[sessionId] = {
    userId: profile.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };

  await writeAuthStore(store);
  setSessionCookie(response, request, sessionId);
  logAuth("session-created", {
    email: profile.email || "",
    returnTo: pending.returnTo || "/",
    sessions: Object.keys(store.sessions || {}).length
  });

  return pending.returnTo || "/";
}

async function authClient(request) {
  const { sessionId, session, store } = await currentSession(request);
  if (!session?.userId) {
    logAuth("auth-client-miss", {
      path: request.url || "",
      hasCookie: Boolean(sessionId),
      hasSession: Boolean(session?.userId),
      cookieHeader: Boolean(request.headers.cookie)
    });
    throw authRequiredError();
  }

  const user = store.users[session.userId];
  const token = user?.tokens;
  if (!token) {
    logAuth("auth-client-miss", {
      path: request.url || "",
      hasCookie: Boolean(sessionId),
      hasSession: true,
      missingToken: true,
      cookieHeader: Boolean(request.headers.cookie)
    });
    throw authRequiredError();
  }

  const client = oauthClient();
  client.setCredentials(token);

  if (!token.expiry_date || token.expiry_date > Date.now()) return client;

  if (!token.refresh_token) throw authRequiredError();

  const refreshed = await client.refreshAccessToken();
  client.setCredentials(refreshed.credentials);
  user.tokens = { ...token, ...refreshed.credentials, refresh_token: token.refresh_token };
  user.updatedAt = new Date().toISOString();
  await writeAuthStore(store);

  return client;
}

async function sheetsClient(request) {
  const auth = await authClient(request);
  return google.sheets({ version: "v4", auth });
}

async function currentUser(request) {
  const { sessionId, session, store } = await currentSession(request);
  if (!session?.userId) {
    logAuth("current-user-miss", {
      hasCookie: Boolean(sessionId),
      hasSession: Boolean(session?.userId)
    });
    return null;
  }
  const user = store.users[session.userId];
  if (!user) {
    logAuth("current-user-miss", {
      hasCookie: Boolean(sessionId),
      hasSession: true,
      missingUser: true
    });
    return null;
  }
  logAuth("current-user-hit", {
    email: user.email || "",
    hasCookie: Boolean(sessionId)
  });

  return {
    email: user.email,
    name: user.name,
    picture: user.picture
  };
}

function readSheetAccessRules() {
  if (process.env.SHEET_ACCESS_JSON) return JSON.parse(process.env.SHEET_ACCESS_JSON);
  if (!fs.existsSync(SHEET_ACCESS_PATH)) return null;
  return readJson(SHEET_ACCESS_PATH);
}

function normalizeSheetAccessList(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

async function sheetAccessForUser(request) {
  const rules = readSheetAccessRules();
  if (!rules) return null;

  const user = await currentUser(request);
  const email = String(user?.email || "").toLowerCase();
  const users = rules.users || {};
  const direct = email ? users[email] : undefined;
  const wildcard = users["*"];
  const fallback = Object.prototype.hasOwnProperty.call(rules, "default") ? rules.default : [];

  return normalizeSheetAccessList(direct ?? wildcard ?? fallback) || [];
}

async function applySheetAccess(request, meta) {
  const allowed = await sheetAccessForUser(request);
  const user = await currentUser(request);
  const userEmail = String(user?.email || "").toLowerCase();
  const allowedSet = allowed
    ? new Set(allowed.map((item) => String(item).toLowerCase()))
    : null;

  const sheets = meta.sheets.filter((sheet) => {
    const isAllowedByApp = !allowedSet
      || allowedSet.has(String(sheet.id).toLowerCase())
      || allowedSet.has(String(sheet.title).toLowerCase());

    return isAllowedByApp && !sheetEditBlockedByGoogle(sheet, userEmail);
  });

  return {
    ...meta,
    sheets
  };
}

async function sheetHiddenReason(request, sheet) {
  const allowed = await sheetAccessForUser(request);
  const user = await currentUser(request);
  const userEmail = String(user?.email || "").toLowerCase();
  const allowedSet = allowed
    ? new Set(allowed.map((item) => String(item).toLowerCase()))
    : null;
  const allowedByApp = !allowedSet
    || allowedSet.has(String(sheet.id).toLowerCase())
    || allowedSet.has(String(sheet.title).toLowerCase());

  if (!allowedByApp) return "app";
  if (sheetEditBlockedByGoogle(sheet, userEmail)) return "google_protected";
  return "";
}

function sheetEditBlockedByGoogle(sheet, userEmail = "") {
  if (!HIDE_NON_EDITABLE_SHEETS) return false;

  return (sheet.protectedRanges || []).some((range) => {
    return !range.warningOnly
      && !protectedRangeEditableByUser(range, userEmail)
      && protectedRangeCoversSheet(sheet, range)
      && !protectedRangeHasEditableExceptions(range);
  });
}

function protectedRangeEditableByUser(protectedRange, userEmail = "") {
  if (protectedRange.requestingUserCanEdit === true) return true;

  const email = String(userEmail || "").toLowerCase();
  if (!email) return protectedRange.requestingUserCanEdit !== false;

  if ((protectedRange.users || []).some((user) => String(user).toLowerCase() === email)
    || (protectedRange.editors?.users || []).some((user) => String(user).toLowerCase() === email)
    || protectedRange.domainUsersCanEdit === true
    || protectedRange.editors?.domainUsersCanEdit === true) {
    return true;
  }

  // The Sheets API sometimes omits requestingUserCanEdit/editors even when
  // the Sheets UI shows the current user as an allowed editor. Only hide when
  // Google explicitly returns false; treat omitted values as unknown/visible.
  return protectedRange.requestingUserCanEdit !== false;
}

function protectedRangeHasEditableExceptions(protectedRange) {
  return (protectedRange.unprotectedRanges || []).some(Boolean);
}

function protectedRangeCoversSheet(sheet, protectedRange) {
  const range = protectedRange.range;
  if (!range) return true;

  const rowCount = sheet.rowCount || 0;
  const columnCount = sheet.columnCount || 0;
  const startsAtFirstRow = !range.startRowIndex || range.startRowIndex <= 0;
  const startsAtFirstColumn = !range.startColumnIndex || range.startColumnIndex <= 0;
  const endsAtLastRow = !range.endRowIndex || !rowCount || range.endRowIndex >= rowCount;
  const endsAtLastColumn = !range.endColumnIndex || !columnCount || range.endColumnIndex >= columnCount;

  return startsAtFirstRow && startsAtFirstColumn && endsAtLastRow && endsAtLastColumn;
}

function ensureSheetAccess(meta, requestedSheetId) {
  if (meta.sheets.length) return;

  const suffix = requestedSheetId ? `: ${requestedSheetId}` : "";
  const error = new Error(`Немає доступу до дозволених аркушів${suffix}.`);
  error.code = "SHEET_ACCESS_DENIED";
  throw error;
}

function quoteSheetName(name) {
  return `'${String(name).replaceAll("'", "''")}'`;
}

function columnLetter(index) {
  let letters = "";
  let number = index + 1;

  while (number > 0) {
    const modulo = (number - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    number = Math.floor((number - modulo) / 26);
  }

  return letters;
}

function normalizeSheet(sheet) {
  return {
    id: sheet.properties.sheetId,
    title: sheet.properties.title,
    index: sheet.properties.index,
    rowCount: sheet.properties.gridProperties?.rowCount || 0,
    columnCount: sheet.properties.gridProperties?.columnCount || 0,
    protectedRanges: (sheet.protectedRanges || []).map((range) => ({
      id: range.protectedRangeId,
      description: range.description || "",
      range: range.range || null,
      unprotectedRanges: range.unprotectedRanges || [],
      warningOnly: Boolean(range.warningOnly),
      requestingUserCanEdit: typeof range.requestingUserCanEdit === "boolean"
        ? range.requestingUserCanEdit
        : null,
      users: range.editors?.users || [],
      groups: range.editors?.groups || [],
      domainUsersCanEdit: Boolean(range.editors?.domainUsersCanEdit)
    }))
  };
}

async function getSpreadsheetMeta(sheets, includeProtectedRanges = false) {
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: includeProtectedRanges
      ? "properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,description,range,unprotectedRanges,warningOnly,requestingUserCanEdit,editors(users,groups,domainUsersCanEdit)))"
      : "properties(title),sheets(properties(sheetId,title,index))"
  });

  const sheetList = (response.data.sheets || []).map(normalizeSheet).sort((a, b) => a.index - b.index);

  return {
    spreadsheetTitle: response.data.properties?.title || "Google таблиця",
    sheets: sheetList
  };
}

function pickSheet(meta, requestedSheetId) {
  const byRequest = requestedSheetId
    ? meta.sheets.find((sheet) => String(sheet.id) === String(requestedSheetId))
    : null;
  if (requestedSheetId && !byRequest) {
    const error = new Error(`Немає доступу до аркуша: ${requestedSheetId}.`);
    error.code = "SHEET_ACCESS_DENIED";
    throw error;
  }

  const byEnvGid = process.env.GOOGLE_SHEET_GID
    ? meta.sheets.find((sheet) => String(sheet.id) === String(process.env.GOOGLE_SHEET_GID))
    : null;
  const byEnvName = process.env.GOOGLE_SHEET_NAME
    ? meta.sheets.find((sheet) => sheet.title === process.env.GOOGLE_SHEET_NAME)
    : null;
  const selected = byRequest || byEnvGid || byEnvName || meta.sheets[0];

  if (!selected) throw new Error("У Google таблиці не знайдено жодного аркуша.");
  return selected;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function cell(row, index) {
  return clean(row[index]?.formattedValue);
}

function classifyStatus(value, fallback = "stock") {
  const text = norm(value);
  if (/втрачен|втрачено/.test(text)) return "lost";
  if (/ремонт/.test(text)) return "repair";
  if (/пошкоджен|позиці/.test(text)) return "damaged";
  if (/склад|наявн|підрозділ|пурк|лх/.test(text)) return "stock";
  return fallback;
}

function statusByKey(key) {
  return STATUSES.find((status) => status.key === key) || STATUSES[0];
}

function statusByKeyStrict(key) {
  return STATUSES.find((status) => status.key === key) || null;
}

function reportSummaryStartColumn(sheetTitle) {
  const configured = REPORT_UNIT_SUMMARY_COLUMNS[sheetTitle];
  if (!configured) throw new Error(`Не налаштовано колонку зведення для аркуша: ${sheetTitle}`);
  const startColumn = Number(configured);
  if (!Number.isInteger(startColumn) || startColumn < 1) {
    throw new Error(`Некоректна колонка зведення для аркуша: ${sheetTitle}`);
  }
  return startColumn - 1;
}

function reportDate(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("uk-UA", {
    timeZone: process.env.REPORT_TIME_ZONE || "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  return formatter.format(value).replace(/\//g, ".");
}

function buildWhatsappReportText(sheetTitle, period, summaryRows, extraSections = []) {
  const labels = {
    "\u0421\u043f\u0440\u0430\u0432\u043d\u0456 \u0437\u0430\u0441\u043e\u0431\u0438": "✅ НА СКЛАДІ / СПРАВНІ",
    "\u0420\u0435\u043c\u043e\u043d\u0442": "🛠 РЕМОНТ",
    "\u041f\u043e\u0448\u043a\u043e\u0434\u0436\u0435\u043d\u0456 \u043d\u0430 \u043f\u043e\u0437\u0438\u0446\u0456\u0457": "⚠️ ПОШКОДЖЕНІ НА ПОЗИЦІЇ",
    "\u0412\u0442\u0440\u0430\u0447\u0435\u043d\u043e": "❌ ВТРАЧЕНО",
    [BATTLE_POSITION_LABEL]: "🎯 НА ПОЗИЦІЇ БГ"
  };

  const sections = [];
  let currentSection = null;

  summaryRows.forEach((row) => {
    const sectionName = clean(row[0]);
    const itemName = clean(row[1]);
    if (sectionName && !itemName) {
      currentSection = { name: sectionName, items: [], total: 0 };
      sections.push(currentSection);
      return;
    }

    if (!currentSection || !itemName) return;
    const qty = Number(String(row[2] || "").replace(",", ".")) || 0;
    currentSection.items.push({ name: itemName, qty });
    currentSection.total += qty;
  });

  extraSections.forEach((section) => {
    sections.push({
      name: section.label || BATTLE_POSITION_LABEL,
      items: (section.items || []).map((item) => ({
        name: item.name,
        qty: item.quantityValue
      })),
      total: parseSummaryNumber(section.total)
    });
  });

  if (!sections.length) throw new Error(`Зведена порожня для ${sheetTitle}`);

  const dateLine = period ? `${reportDate()}, ${period}` : reportDate();
  const lines = [
    `📋 ЗВІТ: ${sheetTitle}`,
    `🕒 Період: ${dateLine}`,
    "",
    "━━━━━━━━━━━━━━━━"
  ];

  sections.forEach((section) => {
    lines.push("", labels[section.name] || section.name.toUpperCase());
    if (!section.items.length) {
      lines.push("• немає");
      return;
    }

    section.items.forEach((item) => {
      lines.push(`• ${item.name} — ${item.qty} шт`);
    });
    lines.push(`Разом: ${section.total} шт`);
  });

  lines.push(
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "© 2025 Корпорація Інтелект. Всі права захищені."
  );

  return lines.join("\n");
}

function majorStatusForLabel(label) {
  const normalized = norm(label);
  const match = STATUSES.find((status) => norm(status.sheetValue) === normalized || norm(status.label) === normalized);
  return match ? match.key : "";
}

function fullWidthLabel(row) {
  const values = row.map((item) => clean(item?.formattedValue)).filter(Boolean);
  return values.length === 1 ? values[0] : "";
}

function findHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const text = (row.values || []).map((item) => norm(item.formattedValue)).join(" ");
    return text.includes("назва майна") && text.includes("статус");
  });
}

function padRow(row, size) {
  return Array.from({ length: size }, (_, index) => row[index] || "");
}

function findMajorSectionsFromValues(values) {
  const sections = [];

  values.forEach((row, index) => {
    const nonEmpty = row.map(clean).filter(Boolean);
    if (nonEmpty.length !== 1) return;

    const statusKey = majorStatusForLabel(nonEmpty[0]);
    if (!statusKey) return;

    sections.push({
      key: statusKey,
      title: nonEmpty[0],
      headerRow: index + 1,
      startRow: index + 2,
      endRow: values.length + 1
    });
  });

  return sections.map((section, index) => ({
    ...section,
    endRow: sections[index + 1] ? sections[index + 1].headerRow : values.length + 1
  }));
}

function findMajorSectionForRow(rowNumber, sections) {
  return sections.find((section) => rowNumber > section.headerRow && rowNumber < section.endRow) || null;
}

function buildMoveTargets(values) {
  const targets = [];
  const seen = new Set();
  let currentMajorKey = "";

  values.forEach((row) => {
    const nonEmpty = row.map(clean).filter(Boolean);
    if (nonEmpty.length !== 1) return;

    const title = nonEmpty[0];
    const majorKey = majorStatusForLabel(title);

    if (majorKey) {
      currentMajorKey = majorKey;
      const status = statusByKey(majorKey);
      const key = `major:${majorKey}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          key,
          label: status.label,
          sheetValue: status.sheetValue,
          statusKey: majorKey,
          isMajor: true
        });
      }
      return;
    }

    if (!currentMajorKey) return;

    const key = `section:${title}`;
    if (seen.has(key)) return;

    seen.add(key);
    targets.push({
      key,
      label: title,
      sheetValue: title,
      statusKey: currentMajorKey,
      isMajor: false
    });
  });

  return targets;
}

function resolveMoveTarget(values, requestedTarget) {
  const requested = clean(requestedTarget);
  const targetByMajorKey = statusByKeyStrict(requested);
  if (targetByMajorKey) {
    return {
      key: `major:${targetByMajorKey.key}`,
      label: targetByMajorKey.label,
      sheetValue: targetByMajorKey.sheetValue,
      statusKey: targetByMajorKey.key,
      isMajor: true
    };
  }

  const targets = buildMoveTargets(values);
  const normalized = norm(requested);
  const target = targets.find((item) => {
    return norm(item.key) === normalized || norm(item.sheetValue) === normalized || norm(item.label) === normalized;
  });

  if (!target) throw new Error(`Розділ не знайдено: ${requested}`);
  return target;
}

function findSectionHeaderRow(values, targetLabel, targetSection) {
  const normalizedTarget = norm(targetLabel);

  for (let rowIndex = targetSection.headerRow - 1; rowIndex < targetSection.endRow - 1; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const nonEmpty = row.map(clean).filter(Boolean);
    if (nonEmpty.length !== 1) continue;
    if (norm(nonEmpty[0]) === normalizedTarget) return rowIndex + 1;
  }

  return 0;
}

function findNextSectionHeaderRow(values, startRow, targetSection) {
  for (let rowIndex = startRow; rowIndex < targetSection.endRow - 1; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const nonEmpty = row.map(clean).filter(Boolean);
    if (nonEmpty.length === 1) return rowIndex + 1;
  }

  return targetSection.endRow;
}

function findInsertBeforeRowForTarget(values, targetSection, target) {
  if (!target.isMajor) {
    const headerRow = findSectionHeaderRow(values, target.sheetValue, targetSection);
    if (!headerRow) return targetSection.endRow;
    return findNextSectionHeaderRow(values, headerRow, targetSection);
  }

  if (target.statusKey !== "stock") return targetSection.endRow;

  for (let rowIndex = targetSection.startRow - 1; rowIndex < targetSection.endRow - 1; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const nonEmpty = row.map(clean).filter(Boolean);
    if (nonEmpty.length !== 1) continue;

    const label = nonEmpty[0];
    if (majorStatusForLabel(label)) continue;

    return rowIndex + 1;
  }

  return targetSection.endRow;
}

async function readStatusDataValidation(sheets, spreadsheetId, sheetName, rowNumber) {
  const statusColumn = columnLetter(STATUS_COLUMN_INDEX);
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [
      `${sheetName}!${statusColumn}${rowNumber}:${statusColumn}${rowNumber}`,
      `${sheetName}!${statusColumn}1:${statusColumn}1000`
    ],
    includeGridData: true,
    fields: "sheets(data(rowData(values(dataValidation))))"
  });

  const grids = response.data.sheets?.[0]?.data || [];
  for (const grid of grids) {
    for (const row of grid.rowData || []) {
      const validation = row.values?.[0]?.dataValidation;
      if (validation) return validation;
    }
  }

  return null;
}

async function applyStatusDataValidation(sheets, spreadsheetId, sheetId, rowNumber, dataValidation) {
  if (!dataValidation) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: STATUS_COLUMN_INDEX,
              endColumnIndex: STATUS_COLUMN_INDEX + 1
            },
            cell: {
              dataValidation
            },
            fields: "dataValidation"
          }
        }
      ]
    }
  });
}

function parseInventory(rows) {
  const headerIndex = findHeaderIndex(rows);
  const startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
  const items = [];
  let currentGroup = "";
  let currentStatus = "stock";

  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex].values || [];
    const label = fullWidthLabel(row);

    if (label) {
      currentGroup = label;
      currentStatus = classifyStatus(label, currentStatus);
      continue;
    }

    const name = cell(row, 1);
    const serial = cell(row, 2);
    const statusRaw = cell(row, STATUS_COLUMN_INDEX);

    if (!name && !serial && !statusRaw) continue;
    if (norm(name).includes("назва майна")) continue;

    const status = classifyStatus(statusRaw || currentGroup, currentStatus);

    items.push({
      rowNumber: rowIndex + 1,
      displayNumber: cell(row, 0),
      name,
      serial,
      quantity: cell(row, 3),
      unit: cell(row, 4),
      status,
      statusLabel: statusByKey(status).label,
      statusRaw: statusRaw || statusByKey(status).sheetValue,
      group: currentGroup || statusByKey(status).label,
      damage: cell(row, 6),
      circumstances: cell(row, 7),
      repairDate: cell(row, 8)
    });
  }

  return items;
}

function formattedRows(rows) {
  return rows.map((row) => (row.values || []).map((item) => clean(item?.formattedValue)));
}

function isSummarySheetTitle(title) {
  return norm(title).includes(norm(REPORT_SUMMARY_SHEET));
}

function summaryCategory(label) {
  const value = norm(label);
  if (!value) return null;
  if (value.includes("справн")) return { key: "stock", label: "Справні засоби" };
  if (value.includes("пошкоджен")) return { key: "damaged", label: "Пошкоджені на позиції" };
  if (value.includes("ремонт")) return { key: "repair", label: "Ремонт" };
  if (value.includes("втрачен")) return { key: "lost", label: "Втрачено" };
  return null;
}

function parseSummaryNumber(value) {
  const normalized = String(value || "").replace(/\s+/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function isBattlePositionGroup(value) {
  const group = norm(value);
  return BATTLE_POSITION_PREFIXES.some((prefix) => group.startsWith(prefix));
}

function aggregateBattlePositionItems(items) {
  const totals = new Map();

  items
    .filter((item) => item.status === "stock" && isBattlePositionGroup(item.group))
    .forEach((item) => {
      const name = clean(item.name);
      if (!name) return;

      const current = totals.get(name) || 0;
      totals.set(name, current + parseSummaryNumber(item.quantity || 1));
    });

  return Array.from(totals.entries())
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName, "uk"))
    .map(([name, quantity], index) => ({
      number: String(index + 1),
      name,
      quantity: formatQuantity(quantity),
      quantityValue: quantity
    }));
}

function buildBattlePositionSummarySection(items) {
  const aggregatedItems = aggregateBattlePositionItems(items);
  const total = aggregatedItems.reduce((sum, item) => sum + item.quantityValue, 0);

  return {
    key: "battle-position",
    label: BATTLE_POSITION_LABEL,
    total: formatQuantity(total),
    items: aggregatedItems
  };
}

function formatQuantity(value) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function isSummaryHeader(values, rowIndex, startColumn) {
  const row = values[rowIndex] || [];
  const numberHeader = norm(row[startColumn]);
  return (numberHeader.includes("№") || numberHeader === "no" || numberHeader === "#")
    && norm(row[startColumn + 1]).includes("назва")
    && norm(row[startColumn + 2]).includes("кіль");
}

function findSummaryHeader(values, titleRow, titleColumn) {
  for (let startColumn = Math.max(0, titleColumn - 2); startColumn <= titleColumn + 1; startColumn += 1) {
    for (let rowIndex = titleRow + 1; rowIndex <= titleRow + 4 && rowIndex < values.length; rowIndex += 1) {
      if (isSummaryHeader(values, rowIndex, startColumn)) {
        return { rowIndex, startColumn };
      }
    }
  }

  return null;
}

function summaryTitleFromHeader(title) {
  return clean(title).replace(/^Зведена інформація\s*/i, "") || clean(title);
}

function summaryTitleFromColumn(startColumn) {
  const match = Object.entries(REPORT_UNIT_SUMMARY_COLUMNS)
    .find(([, column]) => Number(column) - 1 === startColumn);
  return match?.[0] || `Блок ${startColumn + 1}`;
}

function findSummaryTitleNearHeader(values, headerRow, startColumn) {
  for (let rowIndex = Math.max(0, headerRow - 4); rowIndex < headerRow; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = startColumn; columnIndex <= startColumn + 2; columnIndex += 1) {
      const value = clean(row[columnIndex]);
      if (!value || value === "\\") continue;
      if (isSummarySheetTitle(value)) return summaryTitleFromHeader(value);
    }
  }

  return summaryTitleFromColumn(startColumn);
}

function findSummaryHeaderInColumn(values, startColumn) {
  for (let rowIndex = 0; rowIndex < Math.min(values.length, 12); rowIndex += 1) {
    if (isSummaryHeader(values, rowIndex, startColumn)) {
      return { rowIndex, startColumn };
    }
  }

  return null;
}

function findSummaryBlocks(values) {
  const blocks = [];
  const seen = new Set();

  Object.entries(REPORT_UNIT_SUMMARY_COLUMNS).forEach(([title, column]) => {
    const startColumn = Number(column) - 1;
    if (!Number.isInteger(startColumn) || startColumn < 0 || seen.has(startColumn)) return;

    const header = findSummaryHeaderInColumn(values, startColumn);
    if (!header) return;

    seen.add(startColumn);
    blocks.push({
      title,
      startColumn,
      headerRow: header.rowIndex
    });
  });

  values.forEach((row, rowIndex) => {
    row.forEach((_, columnIndex) => {
      if (!isSummaryHeader(values, rowIndex, columnIndex) || seen.has(columnIndex)) return;
      seen.add(columnIndex);
      blocks.push({
        title: findSummaryTitleNearHeader(values, rowIndex, columnIndex),
        startColumn: columnIndex,
        headerRow: rowIndex
      });
    });
  });

  return blocks.sort((left, right) => left.startColumn - right.startColumn);
}

function parseSummarySheet(rows, extraSectionsByTitle = new Map()) {
  const values = formattedRows(rows);
  const blocks = findSummaryBlocks(values);

  return {
    units: blocks.map((block) => {
      const sections = [];
      let currentSection = null;

      for (let rowIndex = block.headerRow + 1; rowIndex < values.length; rowIndex += 1) {
        const row = values[rowIndex] || [];
        const number = clean(row[block.startColumn]);
        const name = clean(row[block.startColumn + 1]);
        const quantityRaw = clean(row[block.startColumn + 2]);

        if (!number && !name && !quantityRaw) continue;

        const category = summaryCategory(name || number);
        if (category) {
          currentSection = {
            key: category.key,
            label: category.label,
            total: parseSummaryNumber(quantityRaw),
            items: []
          };
          sections.push(currentSection);
          continue;
        }

        if (!currentSection || !name || norm(name).includes("назва майна")) continue;
        currentSection.items.push({
          number,
          name,
          quantity: quantityRaw,
          quantityValue: parseSummaryNumber(quantityRaw)
        });
      }

      return {
        title: block.title,
        sections: [
          ...sections,
          ...(extraSectionsByTitle.get(block.title) || [])
        ]
      };
    })
  };
}

async function readBattlePositionSectionsByTitle(sheets, spreadsheetId, meta) {
  const inventorySheets = meta.sheets.filter((sheet) => {
    return !isSummarySheetTitle(sheet.title) && REPORT_UNIT_SUMMARY_COLUMNS[sheet.title];
  });

  if (!inventorySheets.length) return new Map();

  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: inventorySheets.map((sheet) => `${quoteSheetName(sheet.title)}!${SHEET_RANGE}`),
    includeGridData: true,
    fields: "sheets(properties(title),data(rowData(values(formattedValue))))"
  });

  const sectionsByTitle = new Map();
  (response.data.sheets || []).forEach((sheet) => {
    const title = sheet.properties?.title;
    if (!title) return;

    const rows = sheet.data?.[0]?.rowData || [];
    const items = parseInventory(rows);
    sectionsByTitle.set(title, [buildBattlePositionSummarySection(items)]);
  });

  return sectionsByTitle;
}

async function listSheets(request) {
  const sheets = await sheetsClient(request);
  const meta = await applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta);
  return meta;
}

async function accessInfo(request) {
  const sheets = await sheetsClient(request);
  const fullMeta = await getSpreadsheetMeta(sheets, true);
  const visibleMeta = await applySheetAccess(request, fullMeta);
  const configuredAccess = await sheetAccessForUser(request);
  const user = await currentUser(request);
  const hiddenSheets = await Promise.all(fullMeta.sheets
    .filter((sheet) => !visibleMeta.sheets.some((visible) => String(visible.id) === String(sheet.id)))
    .map(async (sheet) => ({
      id: sheet.id,
      title: sheet.title,
      reason: await sheetHiddenReason(request, sheet)
    })));

  return {
    user,
    spreadsheetTitle: fullMeta.spreadsheetTitle,
    appAccess: {
      configured: Boolean(configuredAccess),
      allowed: configuredAccess
    },
    visibleSheets: visibleMeta.sheets.map((sheet) => ({
      id: sheet.id,
      title: sheet.title,
      protectedRanges: sheet.protectedRanges
    })),
    hiddenSheets,
    hiddenSheetsCount: Math.max(0, fullMeta.sheets.length - visibleMeta.sheets.length)
  };
}

async function readInventory(request, requestedSheetId) {
  const sheets = await sheetsClient(request);
  const meta = await applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta, requestedSheetId);
  const selectedSheet = pickSheet(meta, requestedSheetId);
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const isSummarySheet = isSummarySheetTitle(selectedSheet.title);
  const range = `${quoteSheetName(selectedSheet.title)}!${isSummarySheet ? SUMMARY_SHEET_RANGE : SHEET_RANGE}`;

  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [range],
    includeGridData: true,
    fields: "sheets(data(rowData(values(formattedValue))))"
  });

  const rows = response.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const extraSummarySections = isSummarySheet
    ? await readBattlePositionSectionsByTitle(sheets, spreadsheetId, meta)
    : new Map();
  const summary = isSummarySheet ? parseSummarySheet(rows, extraSummarySections) : null;

  return {
    spreadsheetTitle: meta.spreadsheetTitle,
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    sheets: meta.sheets,
    viewType: isSummarySheet ? "summary" : "inventory",
    summary,
    updatedAt: new Date().toISOString(),
    statuses: STATUSES,
    moveTargets: isSummarySheet ? [] : buildMoveTargets(formattedRows(rows)),
    items: isSummarySheet ? [] : parseInventory(rows)
  };
}

async function updateStatus(request, rowNumber, statusTarget, requestedSheetId) {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new Error("Некоректний номер рядка.");

  const sheets = await sheetsClient(request);
  const meta = await applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta, requestedSheetId);
  const selectedSheet = pickSheet(meta, requestedSheetId);
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const sheetName = quoteSheetName(selectedSheet.title);
  const valuesResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${SHEET_RANGE}`
  });
  const values = valuesResponse.data.values || [];
  const rowData = padRow(values[rowNumber - 1] || [], 9);
  const target = resolveMoveTarget(values, statusTarget);
  const status = statusByKey(target.statusKey);
  const previousRawStatus = clean(rowData[STATUS_COLUMN_INDEX]);
  const statusDataValidation = await readStatusDataValidation(sheets, spreadsheetId, sheetName, rowNumber);

  if (!rowData[1] && !rowData[2]) throw new Error("Порожній рядок не можна переносити.");

  rowData[STATUS_COLUMN_INDEX] = target.sheetValue;

  const sections = findMajorSectionsFromValues(values);
  const currentSection = findMajorSectionForRow(rowNumber, sections);
  const targetSection = sections.find((section) => section.key === target.statusKey);

  if (!targetSection) throw new Error(`Блок статусу не знайдено: ${target.sheetValue}`);

  if (currentSection && currentSection.key === targetSection.key && norm(previousRawStatus) === norm(target.sheetValue)) {
    const cellAddress = `${columnLetter(STATUS_COLUMN_INDEX)}${rowNumber}`;
    const range = `${sheetName}!${cellAddress}`;

    console.info(JSON.stringify({
      area: "sheets",
      event: "status-same-section-start",
      sheetId: selectedSheet.id,
      sheetTitle: selectedSheet.title,
      rowNumber,
      target: target.statusKey,
      targetValue: target.sheetValue,
      range
    }));

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[target.sheetValue]]
      }
    });

    console.info(JSON.stringify({
      area: "sheets",
      event: "status-same-section-finished",
      sheetId: selectedSheet.id,
      rowNumber,
      target: target.statusKey,
      range
    }));

    return {
      rowNumber,
      newRowNumber: rowNumber,
      moved: false,
      sheetId: selectedSheet.id,
      sheetTitle: selectedSheet.title,
      status: status.key,
      statusLabel: status.label,
      statusRaw: target.sheetValue,
      range
    };
  }

  let insertBeforeRow = findInsertBeforeRowForTarget(values, targetSection, target);
  if (rowNumber < insertBeforeRow) insertBeforeRow -= 1;

  console.info(JSON.stringify({
    area: "sheets",
    event: "status-move-start",
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    rowNumber,
    insertBeforeRow,
    target: target.statusKey,
    targetValue: target.sheetValue
  }));

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: selectedSheet.id,
                dimension: "ROWS",
                startIndex: rowNumber - 1,
                endIndex: rowNumber
              }
            }
          },
          {
            insertDimension: {
              range: {
                sheetId: selectedSheet.id,
                dimension: "ROWS",
                startIndex: insertBeforeRow - 1,
                endIndex: insertBeforeRow
              },
              inheritFromBefore: true
            },
          }
        ]
      }
    });
  } catch (error) {
    logServerError("status-move-batch-failed", error, {
      sheetId: selectedSheet.id,
      rowNumber,
      insertBeforeRow,
      target: target.statusKey
    });
    throw error;
  }

  const writeRange = `${sheetName}!A${insertBeforeRow}:I${insertBeforeRow}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [rowData]
      }
    });
    await applyStatusDataValidation(sheets, spreadsheetId, selectedSheet.id, insertBeforeRow, statusDataValidation);
  } catch (error) {
    logServerError("status-move-write-failed", error, {
      sheetId: selectedSheet.id,
      rowNumber,
      insertBeforeRow,
      target: target.statusKey,
      range: writeRange
    });
    throw error;
  }

  console.info(JSON.stringify({
    area: "sheets",
    event: "status-move-finished",
    sheetId: selectedSheet.id,
    rowNumber,
    newRowNumber: insertBeforeRow,
    target: target.statusKey,
    range: writeRange
  }));

  return {
    rowNumber,
    newRowNumber: insertBeforeRow,
    moved: true,
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    status: status.key,
    statusLabel: status.label,
    statusRaw: target.sheetValue,
    range: writeRange
  };
}

async function updateEditableFields(request, rowNumber, fields, requestedSheetId) {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new Error("Некоректний номер рядка.");
  if (!fields || typeof fields !== "object") throw new Error("Немає полів для оновлення.");

  const allowedKeys = Object.keys(EDITABLE_FIELD_COLUMNS);
  const updates = allowedKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
    .map((key) => ({
      key,
      columnIndex: EDITABLE_FIELD_COLUMNS[key],
      value: fields[key] == null ? "" : String(fields[key])
    }));

  if (!updates.length) throw new Error("Немає дозволених полів для оновлення.");

  const sheets = await sheetsClient(request);
  const meta = await applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta, requestedSheetId);
  const selectedSheet = pickSheet(meta, requestedSheetId);
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((update) => ({
        range: `${quoteSheetName(selectedSheet.title)}!${columnLetter(update.columnIndex)}${rowNumber}`,
        values: [[update.value]]
      }))
    }
  });

  return {
    rowNumber,
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    fields: Object.fromEntries(updates.map((update) => [update.key, update.value]))
  };
}

async function sendReport(request, requestedSheetId, requestedPeriod = "") {
  const sheets = await sheetsClient(request);
  const meta = await applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta, requestedSheetId);
  const selectedSheet = pickSheet(meta, requestedSheetId);
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const summaryStartColumn = reportSummaryStartColumn(selectedSheet.title);
  const summaryEndColumn = summaryStartColumn + 2;
  const summaryRange = `${quoteSheetName(REPORT_SUMMARY_SHEET)}!${columnLetter(summaryStartColumn)}${REPORT_SUMMARY_FIRST_ROW}:${columnLetter(summaryEndColumn)}1000`;
  const periodRange = `${quoteSheetName(selectedSheet.title)}!${REPORT_PERIOD_CELL}`;

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [summaryRange, periodRange],
    valueRenderOption: "FORMATTED_VALUE"
  });
  const inventoryResponse = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${quoteSheetName(selectedSheet.title)}!${SHEET_RANGE}`],
    includeGridData: true,
    fields: "sheets(data(rowData(values(formattedValue))))"
  });

  const [summaryValueRange, periodValueRange] = response.data.valueRanges || [];
  const summaryRows = summaryValueRange?.values || [];
  const period = clean(requestedPeriod) || clean(periodValueRange?.values?.[0]?.[0]);
  const inventoryRows = inventoryResponse.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const battlePositionSection = buildBattlePositionSummarySection(parseInventory(inventoryRows));
  const text = buildWhatsappReportText(selectedSheet.title, period, summaryRows, [battlePositionSection]);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  return {
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    period,
    whatsappUrl,
    text
  };
}

function sendJson(response, code, payload) {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendStatic(response, urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
}

function readBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return Promise.resolve(request.body);
  }

  const bufferedBody = request.rawBody || (Buffer.isBuffer(request.body) ? request.body : null);
  if (bufferedBody) {
    try {
      const text = Buffer.from(bufferedBody).toString("utf8");
      return Promise.resolve(text ? JSON.parse(text) : {});
    } catch {
      return Promise.reject(new Error("Некоректний JSON."));
    }
  }

  if (request.readableEnded || request.complete) {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Занадто великий запит."));
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Некоректний JSON."));
      }
    });

    request.on("error", reject);
  });
}

function sendError(response, error, fallbackCode = 500) {
  if (error.code === "AUTH_REQUIRED") {
    sendJson(response, 401, { error: error.message, authUrl: error.authUrl });
    return;
  }

  logServerError("request-error", error, { fallbackCode });

  if (error.code === "SHEET_ACCESS_DENIED") {
    sendJson(response, 403, { error: error.message, code: error.code });
    return;
  }

  const googleStatus = error.code || error.response?.status;
  const message = String(error.message || "");
  if ((googleStatus === 401 || googleStatus === 403) && /insufficient permission/i.test(message)) {
    sendJson(response, 401, {
      error: "Потрібна повторна авторизація Google з новими дозволами.",
      authUrl: "/reauth"
    });
    return;
  }

  sendJson(response, fallbackCode, { error: error.message || "Помилка сервера." });
}

async function requestHandler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/auth/google") {
    try {
      const returnTo = normalizeReturnTo(url.searchParams.get("returnTo") || request.headers.referer || "/", request);
      response.writeHead(302, { Location: await createAuthUrl(returnTo) });
      response.end();
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/oauth2callback") {
    try {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code) throw new Error("Google не повернув authorization code.");
      const returnTo = await createUserSession(request, response, code, state);
      response.writeHead(302, { Location: publicRedirectLocation(returnTo) });
      response.end();
    } catch (error) {
      if (error.code === "OAUTH_STATE_EXPIRED") {
        response.writeHead(302, { Location: "/auth/google" });
        response.end();
        return;
      }
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/logout") {
    const { sessionId, session, store } = await currentSession(request);
    if (sessionId) {
      delete store.sessions[sessionId];
      if ((url.searchParams.get("clear") === "1" || url.searchParams.get("full") === "1") && session?.userId) {
        delete store.users[session.userId];
      }
      await writeAuthStore(store);
    }
    clearSessionCookie(response);
    response.writeHead(302, { Location: "/" });
    response.end();
    return;
  }

  if (url.pathname === "/reauth") {
    const { sessionId, session, store } = await currentSession(request);
    if (sessionId) {
      delete store.sessions[sessionId];
      if (session?.userId) delete store.users[session.userId];
      await writeAuthStore(store);
    }
    clearSessionCookie(response);
    const returnTo = normalizeReturnTo(url.searchParams.get("returnTo") || request.headers.referer || "/", request);
    response.writeHead(302, { Location: `/auth/google?returnTo=${encodeURIComponent(returnTo)}` });
    response.end();
    return;
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    sendJson(response, 200, { user: await currentUser(request) });
    return;
  }

  if (url.pathname === "/api/access-info" && request.method === "GET") {
    try {
      sendJson(response, 200, await accessInfo(request));
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/api/sheets" && request.method === "GET") {
    try {
      sendJson(response, 200, await listSheets(request));
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/api/items" && request.method === "GET") {
    try {
      sendJson(response, 200, await readInventory(request, url.searchParams.get("sheetId")));
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/api/status" && request.method === "PATCH") {
    try {
      const body = await readBody(request);
      const user = await currentUser(request);
      console.info(JSON.stringify({
        area: "sheets",
        event: "status-request",
        email: user?.email || "",
        sheetId: body.sheetId || "",
        rowNumber: Number(body.rowNumber),
        status: body.status || ""
      }));
      sendJson(response, 200, await updateStatus(request, Number(body.rowNumber), body.status, body.sheetId));
    } catch (error) {
      sendError(response, error, 400);
    }
    return;
  }

  if (url.pathname === "/api/fields" && request.method === "PATCH") {
    try {
      const body = await readBody(request);
      sendJson(response, 200, await updateEditableFields(request, Number(body.rowNumber), body.fields, body.sheetId));
    } catch (error) {
      sendError(response, error, 400);
    }
    return;
  }

  if (url.pathname === "/api/report" && request.method === "POST") {
    try {
      const body = await readBody(request);
      sendJson(response, 200, await sendReport(request, body.sheetId, body.period));
    } catch (error) {
      sendError(response, error, 400);
    }
    return;
  }

  if (request.method === "GET") {
    sendStatic(response, url.pathname);
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
}

function startServer() {
  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      sendError(response, error);
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`Inventory Status App: http://${HOST}:${PORT}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { requestHandler, startServer };
