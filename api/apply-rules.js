const MAX_ROWS = 200;
const BODY_LIMIT_BYTES = 1_000_000;

const REQUIRED_HEADERS = [
  "팀명",
  "제출자",
  "부서명",
  "업무유형",
  "제목",
  "처리상태",
  "처리기한",
  "우선순위",
  "내용"
];

// Request: { "rows": [{ "팀명": "...", "제출자": "...", ... }], "source": "sample" }
// Success: { "mode": "rules", "rows": [], "summary": { "total": 0, "needsCheck": 0, "duplicates": 0 }, "warnings": [] }
// Errors: 400 invalid_json, 400 missing_rows, 400 missing_headers, 413 too_many_rows, 405 method_not_allowed

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(payload, null, 2));
}

function errorPayload(code, message, extra) {
  return Object.assign({ code, message }, extra || {});
}

function payloadTooLargeError() {
  const error = new Error("request_body_too_large");
  error.code = "too_many_rows";
  return error;
}

function assertBodyWithinLimit(value) {
  let byteLength;

  if (Buffer.isBuffer(value)) {
    byteLength = value.byteLength;
  } else if (typeof value === "string") {
    byteLength = Buffer.byteLength(value, "utf8");
  } else {
    byteLength = Buffer.byteLength(JSON.stringify(value), "utf8");
  }

  if (byteLength > BODY_LIMIT_BYTES) {
    throw payloadTooLargeError();
  }
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let done = false;

    req.on("data", (chunk) => {
      if (done) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT_BYTES) {
        done = true;
        reject(payloadTooLargeError());
      }
    });

    req.on("end", () => {
      if (done) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        error.code = "invalid_json";
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    assertBodyWithinLimit(req.body);
    return req.body;
  }

  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    assertBodyWithinLimit(req.body);
    try {
      return JSON.parse(String(req.body));
    } catch (error) {
      error.code = "invalid_json";
      throw error;
    }
  }

  if (typeof req.rawBody === "string" || Buffer.isBuffer(req.rawBody)) {
    assertBodyWithinLimit(req.rawBody);
    try {
      return JSON.parse(String(req.rawBody));
    } catch (error) {
      error.code = "invalid_json";
      throw error;
    }
  }

  if (typeof req.on === "function") {
    return parseRawBody(req);
  }

  return {};
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function compact(value) {
  return text(value).toLowerCase().replace(/\s+/g, "");
}

function normalizeStatus(value) {
  const key = compact(value);
  const map = new Map([
    ["진행", "진행"],
    ["진행중", "진행"],
    ["inprogress", "진행"],
    ["doing", "진행"],
    ["완료", "완료"],
    ["처리완료", "완료"],
    ["done", "완료"],
    ["finished", "완료"],
    ["대기", "미확인"],
    ["미처리", "미확인"],
    ["todo", "미확인"],
    ["보류", "확인필요"],
    ["hold", "확인필요"]
  ]);

  return map.get(key) || "확인필요";
}

function normalizePriority(value) {
  const key = compact(value);
  const map = new Map([
    ["긴급", "높음"],
    ["상", "높음"],
    ["높음", "높음"],
    ["high", "높음"],
    ["중", "보통"],
    ["보통", "보통"],
    ["normal", "보통"],
    ["medium", "보통"],
    ["하", "낮음"],
    ["낮음", "낮음"],
    ["low", "낮음"]
  ]);

  return map.get(key) || "확인필요";
}

function isValidIsoDate(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;

  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;

  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` === raw;
}

function isPlainRow(row) {
  return row !== null && typeof row === "object" && !Array.isArray(row);
}

function missingHeadersForRow(row) {
  if (!isPlainRow(row)) {
    return REQUIRED_HEADERS.slice();
  }

  return REQUIRED_HEADERS.filter((header) => !Object.prototype.hasOwnProperty.call(row, header));
}

function missingHeaders(rows) {
  const rowErrors = [];
  const missingSet = new Set();

  rows.forEach((row, index) => {
    const missing = missingHeadersForRow(row);
    if (missing.length === 0) return;

    for (const header of missing) missingSet.add(header);
    rowErrors.push({
      row: index + 1,
      missingHeaders: missing
    });
  });

  return {
    missingHeaders: Array.from(missingSet),
    rowErrors
  };
}

function duplicateKey(row) {
  return [
    row["부서명"],
    row["업무유형"],
    row["제목"],
    row["처리기한"],
    row["내용"]
  ].map(compact).join("|");
}

function summarizeIssues(row, normalizedStatus, normalizedPriority, duplicate) {
  const issues = [];
  const dueDate = text(row["처리기한"]);

  if (!dueDate) {
    issues.push("처리기한 누락");
  } else if (!isValidIsoDate(dueDate)) {
    issues.push("처리기한 형식 확인");
  }

  if (normalizedStatus === "확인필요") {
    issues.push("처리상태 확인");
  }

  if (normalizedPriority === "확인필요") {
    issues.push("우선순위 확인");
  }

  if (duplicate) {
    issues.push("중복 의심");
  }

  return issues;
}

function applyRules(rows, source) {
  const duplicateCounts = new Map();
  for (const row of rows) {
    const key = duplicateKey(row);
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }

  let needsCheck = 0;
  let duplicates = 0;

  const cleanedRows = rows.map((row, index) => {
    const normalizedStatus = normalizeStatus(row["처리상태"]);
    const normalizedPriority = normalizePriority(row["우선순위"]);
    const duplicate = duplicateCounts.get(duplicateKey(row)) > 1;
    const issues = summarizeIssues(row, normalizedStatus, normalizedPriority, duplicate);

    if (issues.length > 0) needsCheck += 1;
    if (duplicate) duplicates += 1;

    return Object.assign({}, row, {
      "처리상태": normalizedStatus,
      "우선순위": normalizedPriority,
      "중복여부": duplicate ? "예" : "아니오",
      "확인필요": issues.length > 0 ? "예" : "아니오",
      "정리메모": issues.length > 0 ? issues.join(", ") : "자동 정리 완료",
      "_row": index + 1
    });
  });

  const warnings = [];
  if (source && source !== "sample") {
    warnings.push(`source=${source} 입력은 같은 규칙으로 처리했습니다.`);
  }

  return {
    mode: "rules",
    rows: cleanedRows,
    summary: {
      total: cleanedRows.length,
      needsCheck,
      duplicates
    },
    warnings
  };
}

function validateRequest(body) {
  if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
    return {
      statusCode: 400,
      payload: errorPayload("missing_rows", "rows 배열에 1개 이상의 행을 넣어 주세요.")
    };
  }

  if (body.rows.length > MAX_ROWS) {
    return {
      statusCode: 413,
      payload: errorPayload("too_many_rows", `한 번에 ${MAX_ROWS}행까지만 처리할 수 있습니다.`, { maxRows: MAX_ROWS })
    };
  }

  const missing = missingHeaders(body.rows);
  if (missing.missingHeaders.length > 0) {
    return {
      statusCode: 400,
      payload: errorPayload("missing_headers", "필수 열이 누락되었습니다.", missing)
    };
  }

  return null;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, errorPayload("method_not_allowed", "POST 요청만 지원합니다."));
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error.code === "too_many_rows") {
      return sendJson(res, 413, errorPayload("too_many_rows", `요청 본문은 ${BODY_LIMIT_BYTES}바이트 이하로 보내 주세요.`));
    }
    return sendJson(res, 400, errorPayload("invalid_json", "JSON 형식의 요청 본문을 보내 주세요."));
  }

  const invalid = validateRequest(body);
  if (invalid) {
    return sendJson(res, invalid.statusCode, invalid.payload);
  }

  return sendJson(res, 200, applyRules(body.rows, text(body.source || "sample")));
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.body = String(chunk || "");
    }
  };
}

async function invokeForTest(req) {
  const res = createMockResponse();
  await handler(req, res);
  return {
    statusCode: res.statusCode,
    payload: JSON.parse(res.body)
  };
}

function sampleRow(overrides) {
  return Object.assign({
    "팀명": "A팀",
    "제출자": "샘플-A01",
    "부서명": "기획샘플팀",
    "업무유형": "업무보고",
    "제목": "주간 공유자료 취합",
    "처리상태": "진행중",
    "처리기한": "2026-07-24",
    "우선순위": "중",
    "내용": "부서별 공유 항목을 수업용 가상 데이터로 정리합니다."
  }, overrides || {});
}

function assertScenario(name, result, expectation) {
  const failures = [];
  if (result.statusCode !== expectation.statusCode) {
    failures.push(`statusCode expected ${expectation.statusCode} got ${result.statusCode}`);
  }
  if (expectation.code && result.payload.code !== expectation.code) {
    failures.push(`code expected ${expectation.code} got ${result.payload.code}`);
  }
  if (expectation.mode && result.payload.mode !== expectation.mode) {
    failures.push(`mode expected ${expectation.mode} got ${result.payload.mode}`);
  }
  if (typeof expectation.total === "number" && result.payload.summary.total !== expectation.total) {
    failures.push(`summary.total expected ${expectation.total} got ${result.payload.summary.total}`);
  }
  if (typeof expectation.needsCheck === "number" && result.payload.summary.needsCheck !== expectation.needsCheck) {
    failures.push(`summary.needsCheck expected ${expectation.needsCheck} got ${result.payload.summary.needsCheck}`);
  }
  if (typeof expectation.duplicates === "number" && result.payload.summary.duplicates !== expectation.duplicates) {
    failures.push(`summary.duplicates expected ${expectation.duplicates} got ${result.payload.summary.duplicates}`);
  }
  if (typeof expectation.maxRows === "number" && result.payload.maxRows !== expectation.maxRows) {
    failures.push(`maxRows expected ${expectation.maxRows} got ${result.payload.maxRows}`);
  }
  if (expectation.memoIncludes) {
    const memo = result.payload.rows && result.payload.rows[0] && result.payload.rows[0]["정리메모"];
    if (!String(memo || "").includes(expectation.memoIncludes)) {
      failures.push(`정리메모 expected to include ${expectation.memoIncludes} got ${memo}`);
    }
  }

  return {
    name,
    ok: failures.length === 0,
    failures,
    result
  };
}

async function runSelfTest() {
  const tooManyRows = Array.from({ length: MAX_ROWS + 1 }, (_, index) => sampleRow({ "제출자": `초과-${index}` }));
  const duplicateRows = [
    sampleRow({ "제출자": "중복-1" }),
    sampleRow({ "제출자": "중복-2" })
  ];
  const oversizedBody = {
    rows: [sampleRow({ "내용": "x".repeat(BODY_LIMIT_BYTES + 1) })],
    source: "sample"
  };
  const oversizedJson = JSON.stringify(oversizedBody);

  const scenarios = [
    {
      name: "valid_rows",
      req: { method: "POST", body: { rows: [sampleRow()], source: "sample" } },
      expectation: { statusCode: 200, mode: "rules", total: 1, needsCheck: 0, duplicates: 0 }
    },
    {
      name: "empty_rows",
      req: { method: "POST", body: { rows: [], source: "sample" } },
      expectation: { statusCode: 400, code: "missing_rows" }
    },
    {
      name: "missing_body",
      req: { method: "POST", body: {} },
      expectation: { statusCode: 400, code: "missing_rows" }
    },
    {
      name: "non_array_rows",
      req: { method: "POST", body: { rows: "not an array", source: "sample" } },
      expectation: { statusCode: 400, code: "missing_rows" }
    },
    {
      name: "missing_headers",
      req: { method: "POST", body: { rows: [{ "팀명": "A팀", "제출자": "샘플-A01" }], source: "sample" } },
      expectation: { statusCode: 400, code: "missing_headers" }
    },
    {
      name: "mixed_valid_null",
      req: { method: "POST", body: { rows: [sampleRow(), null], source: "sample" } },
      expectation: { statusCode: 400, code: "missing_headers" }
    },
    {
      name: "mixed_valid_array",
      req: { method: "POST", body: { rows: [sampleRow(), []], source: "sample" } },
      expectation: { statusCode: 400, code: "missing_headers" }
    },
    {
      name: "mixed_valid_string",
      req: { method: "POST", body: { rows: [sampleRow(), "not a row"], source: "sample" } },
      expectation: { statusCode: 400, code: "missing_headers" }
    },
    {
      name: "mixed_valid_number",
      req: { method: "POST", body: { rows: [sampleRow(), 123], source: "sample" } },
      expectation: { statusCode: 400, code: "missing_headers" }
    },
    {
      name: "invalid_date",
      req: { method: "POST", body: { rows: [sampleRow({ "처리기한": "2026/07/24" })], source: "sample" } },
      expectation: { statusCode: 200, mode: "rules", total: 1, needsCheck: 1, duplicates: 0, memoIncludes: "처리기한 형식 확인" }
    },
    {
      name: "duplicate_rows",
      req: { method: "POST", body: { rows: duplicateRows, source: "sample" } },
      expectation: { statusCode: 200, mode: "rules", total: 2, needsCheck: 2, duplicates: 2 }
    },
    {
      name: "too_many_rows_201",
      req: { method: "POST", body: { rows: tooManyRows, source: "sample" } },
      expectation: { statusCode: 413, code: "too_many_rows", maxRows: 200 }
    },
    {
      name: "payload_too_large_parsed_object",
      req: { method: "POST", body: oversizedBody },
      expectation: { statusCode: 413, code: "too_many_rows" }
    },
    {
      name: "payload_too_large_string",
      req: { method: "POST", body: oversizedJson },
      expectation: { statusCode: 413, code: "too_many_rows" }
    },
    {
      name: "payload_too_large_buffer",
      req: { method: "POST", body: Buffer.from(oversizedJson) },
      expectation: { statusCode: 413, code: "too_many_rows" }
    },
    {
      name: "method_not_allowed",
      req: { method: "GET", body: { rows: [sampleRow()], source: "sample" } },
      expectation: { statusCode: 405, code: "method_not_allowed" }
    },
    {
      name: "invalid_json",
      req: { method: "POST", body: "{ not json" },
      expectation: { statusCode: 400, code: "invalid_json" }
    }
  ];

  const results = [];
  for (const scenario of scenarios) {
    const result = await invokeForTest(scenario.req);
    results.push(assertScenario(scenario.name, result, scenario.expectation));
  }

  const output = {
    ok: results.every((result) => result.ok),
    generatedAt: new Date().toISOString(),
    maxRows: MAX_ROWS,
    scenarios: results
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  if (process.argv.includes("--self-test")) {
    runSelfTest().catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  } else {
    process.stdout.write("Run with --self-test to validate /api/apply-rules locally.\n");
  }
}

module.exports = handler;
module.exports.applyRules = applyRules;
module.exports.validateRequest = validateRequest;
module.exports.runSelfTest = runSelfTest;
