const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { google } = require("googleapis");
require("dotenv").config();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3100);
const PUBLIC_DIR = path.join(__dirname, "public");
const CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE || "credentials.json");
const TOKEN_PATH = path.join(__dirname, process.env.GOOGLE_TOKEN_FILE || "token.json");
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || "A1:I1000";
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
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
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
    index: sheet.properties.index
  };
}

async function getSpreadsheetMeta(sheets) {
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties(title),sheets(properties(sheetId,title,index))"
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

async function listSheets() {
  const sheets = await sheetsClient();
  return getSpreadsheetMeta(sheets);
}

async function readInventory(requestedSheetId) {
  const sheets = await sheetsClient();
  const meta = await getSpreadsheetMeta(sheets);
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

async function updateStatus(rowNumber, statusTarget, requestedSheetId) {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new Error("Некоректний номер рядка.");

  const sheets = await sheetsClient();
  const meta = await getSpreadsheetMeta(sheets);
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

async function updateEditableFields(rowNumber, fields, requestedSheetId) {
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

  const sheets = await sheetsClient();
  const meta = await getSpreadsheetMeta(sheets);
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

  sendJson(response, fallbackCode, { error: error.message || "Помилка сервера." });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/auth/google") {
    response.writeHead(302, { Location: authUrl() });
    response.end();
    return;
  }

  if (url.pathname === "/oauth2callback") {
    try {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Google не повернув authorization code.");
      const client = oauthClient();
      const { tokens } = await client.getToken(code);
      writeJson(TOKEN_PATH, tokens);
      response.writeHead(302, { Location: "/" });
      response.end();
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/api/sheets" && request.method === "GET") {
    try {
      sendJson(response, 200, await listSheets());
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/api/items" && request.method === "GET") {
    try {
      sendJson(response, 200, await readInventory(url.searchParams.get("sheetId")));
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (url.pathname === "/api/status" && request.method === "PATCH") {
    try {
      const body = await readBody(request);
      sendJson(response, 200, await updateStatus(Number(body.rowNumber), body.status, body.sheetId));
    } catch (error) {
      sendError(response, error, 400);
    }
    return;
  }

  if (url.pathname === "/api/fields" && request.method === "PATCH") {
    try {
      const body = await readBody(request);
      sendJson(response, 200, await updateEditableFields(Number(body.rowNumber), body.fields, body.sheetId));
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
