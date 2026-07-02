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
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "inventory_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 168) * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets"
];

const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || "A1:I1000";
const HIDE_NON_EDITABLE_SHEETS = process.env.HIDE_NON_EDITABLE_SHEETS !== "false";
const STATUS_COLUMN_INDEX = 5;
const EDITABLE_FIELD_COLUMNS = {
  damage: 6,
  circumstances: 7,
  repairDate: 8
};

const STATUSES = [
  { key: "stock", label: "На складі", sheetValue: "На складі підрозділу" },
  { key: "repair", label: "Ремонт", sheetValue: "Ремонт" },
  { key: "damaged", label: "Пошкоджені", sheetValue: "Пошкоджені на позиції" },
  { key: "lost", label: "Втрачені", sheetValue: "Втрачено" }
];

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

function readAuthStore() {
  if (!fs.existsSync(AUTH_STORE_PATH)) return emptyAuthStore();
  return { ...emptyAuthStore(), ...readJson(AUTH_STORE_PATH) };
}

function writeAuthStore(store) {
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
  const isHttps = request.headers["x-forwarded-proto"] === "https" || request.socket.encrypted;
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    isHttps ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function setSessionCookie(response, request, sessionId) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ${cookieOptions(request)}`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
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

function currentSession(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return { sessionId: "", session: null, store: readAuthStore() };

  const store = readAuthStore();
  cleanupAuthStore(store);
  const session = store.sessions[sessionId] || null;

  if (!session || session.expiresAt <= Date.now()) {
    delete store.sessions[sessionId];
    writeAuthStore(store);
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

function authUrl() {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });
}

async function authClient() {
  const client = oauthClient();

  if (!fs.existsSync(TOKEN_PATH)) {
    const error = new Error("Потрібна авторизація Google.");
    error.code = "AUTH_REQUIRED";
    error.authUrl = authUrl();
    throw error;
  }

  const token = readJson(TOKEN_PATH);
  client.setCredentials(token);

  if (!token.expiry_date || token.expiry_date > Date.now()) return client;

  if (!token.refresh_token) {
    const error = new Error("Токен застарів. Авторизуйтесь повторно.");
    error.code = "AUTH_REQUIRED";
    error.authUrl = authUrl();
    throw error;
  }

  const refreshed = await client.refreshAccessToken();
  client.setCredentials(refreshed.credentials);
  writeJson(TOKEN_PATH, { ...token, ...refreshed.credentials });
  return client;
}

async function sheetsClient() {
  const auth = await authClient();
  return google.sheets({ version: "v4", auth });
}

function createAuthUrl(returnTo = "/") {
  const state = randomToken();
  const store = readAuthStore();
  cleanupAuthStore(store);
  store.pendingStates[state] = {
    returnTo,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  };
  writeAuthStore(store);

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
  const store = readAuthStore();
  cleanupAuthStore(store);

  const pending = store.pendingStates[state];
  if (!state || !pending) throw new Error("OAuth сесія застаріла. Спробуйте увійти ще раз.");
  delete store.pendingStates[state];

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const profile = await fetchGoogleUser(client);
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

  writeAuthStore(store);
  setSessionCookie(response, request, sessionId);

  return pending.returnTo || "/";
}

function authUrl() {
  return createAuthUrl("/");
}

async function authClient(request) {
  const { session, store } = currentSession(request);
  if (!session?.userId) throw authRequiredError();

  const user = store.users[session.userId];
  const token = user?.tokens;
  if (!token) throw authRequiredError();

  const client = oauthClient();
  client.setCredentials(token);

  if (!token.expiry_date || token.expiry_date > Date.now()) return client;

  if (!token.refresh_token) throw authRequiredError();

  const refreshed = await client.refreshAccessToken();
  client.setCredentials(refreshed.credentials);
  user.tokens = { ...token, ...refreshed.credentials, refresh_token: token.refresh_token };
  user.updatedAt = new Date().toISOString();
  writeAuthStore(store);

  return client;
}

async function sheetsClient(request) {
  const auth = await authClient(request);
  return google.sheets({ version: "v4", auth });
}

function currentUser(request) {
  const { session, store } = currentSession(request);
  if (!session?.userId) return null;
  const user = store.users[session.userId];
  if (!user) return null;

  return {
    email: user.email,
    name: user.name,
    picture: user.picture
  };
}

function readSheetAccessRules() {
  if (!fs.existsSync(SHEET_ACCESS_PATH)) return null;
  return readJson(SHEET_ACCESS_PATH);
}

function normalizeSheetAccessList(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function sheetAccessForUser(request) {
  const rules = readSheetAccessRules();
  if (!rules) return null;

  const user = currentUser(request);
  const email = String(user?.email || "").toLowerCase();
  const users = rules.users || {};
  const direct = email ? users[email] : undefined;
  const wildcard = users["*"];
  const fallback = Object.prototype.hasOwnProperty.call(rules, "default") ? rules.default : [];

  return normalizeSheetAccessList(direct ?? wildcard ?? fallback) || [];
}

function applySheetAccess(request, meta) {
  const allowed = sheetAccessForUser(request);
  const allowedSet = allowed
    ? new Set(allowed.map((item) => String(item).toLowerCase()))
    : null;

  const sheets = meta.sheets.filter((sheet) => {
    const isAllowedByApp = !allowedSet
      || allowedSet.has(String(sheet.id).toLowerCase())
      || allowedSet.has(String(sheet.title).toLowerCase());

    return isAllowedByApp && !sheetEditBlockedByGoogle(sheet);
  });

  return {
    ...meta,
    sheets
  };
}

function sheetEditBlockedByGoogle(sheet) {
  if (!HIDE_NON_EDITABLE_SHEETS) return false;

  return (sheet.protectedRanges || []).some((range) => {
    return !range.warningOnly && range.requestingUserCanEdit === false && protectedRangeCoversSheet(sheet, range);
  });
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
      warningOnly: Boolean(range.warningOnly),
      requestingUserCanEdit: range.requestingUserCanEdit !== false,
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
      ? "properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,description,range,warningOnly,requestingUserCanEdit,editors(users,groups,domainUsersCanEdit)))"
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

async function listSheets(request) {
  const sheets = await sheetsClient(request);
  const meta = applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta);
  return meta;
}

async function accessInfo(request) {
  const sheets = await sheetsClient(request);
  const fullMeta = await getSpreadsheetMeta(sheets, true);
  const visibleMeta = applySheetAccess(request, fullMeta);
  const configuredAccess = sheetAccessForUser(request);

  return {
    user: currentUser(request),
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
    hiddenSheetsCount: Math.max(0, fullMeta.sheets.length - visibleMeta.sheets.length)
  };
}

async function readInventory(request, requestedSheetId) {
  const sheets = await sheetsClient(request);
  const meta = applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
  ensureSheetAccess(meta, requestedSheetId);
  const selectedSheet = pickSheet(meta, requestedSheetId);
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const range = `${quoteSheetName(selectedSheet.title)}!${SHEET_RANGE}`;

  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [range],
    includeGridData: true,
    fields: "sheets(data(rowData(values(formattedValue))))"
  });

  const rows = response.data.sheets?.[0]?.data?.[0]?.rowData || [];

  return {
    spreadsheetTitle: meta.spreadsheetTitle,
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    sheets: meta.sheets,
    updatedAt: new Date().toISOString(),
    statuses: STATUSES,
    moveTargets: buildMoveTargets(rows.map((row) => (row.values || []).map((cell) => cell.formattedValue || ""))),
    items: parseInventory(rows)
  };
}

async function updateStatus(request, rowNumber, statusTarget, requestedSheetId) {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new Error("Некоректний номер рядка.");

  const sheets = await sheetsClient(request);
  const meta = applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
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

  if (!rowData[1] && !rowData[2]) throw new Error("Порожній рядок не можна переносити.");

  rowData[STATUS_COLUMN_INDEX] = target.sheetValue;

  const sections = findMajorSectionsFromValues(values);
  const currentSection = findMajorSectionForRow(rowNumber, sections);
  const targetSection = sections.find((section) => section.key === target.statusKey);

  if (!targetSection) throw new Error(`Блок статусу не знайдено: ${target.sheetValue}`);

  if (currentSection && currentSection.key === targetSection.key && norm(previousRawStatus) === norm(target.sheetValue)) {
    const cellAddress = `${columnLetter(STATUS_COLUMN_INDEX)}${rowNumber}`;
    const range = `${sheetName}!${cellAddress}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[target.sheetValue]]
      }
    });

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
          }
        }
      ]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${insertBeforeRow}:I${insertBeforeRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [rowData]
    }
  });

  return {
    rowNumber,
    newRowNumber: insertBeforeRow,
    moved: true,
    sheetId: selectedSheet.id,
    sheetTitle: selectedSheet.title,
    status: status.key,
    statusLabel: status.label,
    statusRaw: target.sheetValue,
    range: `${sheetName}!A${insertBeforeRow}:I${insertBeforeRow}`
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
  const meta = applySheetAccess(request, await getSpreadsheetMeta(sheets, true));
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

  if (error.code === "SHEET_ACCESS_DENIED") {
    sendJson(response, 403, { error: error.message });
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/auth/google") {
    const returnTo = normalizeReturnTo(url.searchParams.get("returnTo") || request.headers.referer || "/", request);
    response.writeHead(302, { Location: createAuthUrl(returnTo) });
    response.end();
    return;
  }

  if (url.pathname === "/oauth2callback") {
    try {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code) throw new Error("Google не повернув authorization code.");
      const returnTo = await createUserSession(request, response, code, state);
      response.writeHead(302, { Location: returnTo });
      response.end();
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/logout") {
    const { sessionId, session, store } = currentSession(request);
    if (sessionId) {
      delete store.sessions[sessionId];
      if ((url.searchParams.get("clear") === "1" || url.searchParams.get("full") === "1") && session?.userId) {
        delete store.users[session.userId];
      }
      writeAuthStore(store);
    }
    clearSessionCookie(response);
    response.writeHead(302, { Location: "/" });
    response.end();
    return;
  }

  if (url.pathname === "/reauth") {
    const { sessionId, session, store } = currentSession(request);
    if (sessionId) {
      delete store.sessions[sessionId];
      if (session?.userId) delete store.users[session.userId];
      writeAuthStore(store);
    }
    clearSessionCookie(response);
    const returnTo = normalizeReturnTo(url.searchParams.get("returnTo") || request.headers.referer || "/", request);
    response.writeHead(302, { Location: `/auth/google?returnTo=${encodeURIComponent(returnTo)}` });
    response.end();
    return;
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    sendJson(response, 200, { user: currentUser(request) });
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

  if (request.method === "GET") {
    sendStatic(response, url.pathname);
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Inventory Status App: http://${HOST}:${PORT}`);
});
