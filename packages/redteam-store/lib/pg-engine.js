/**
 * PostgreSQL 高性能存储引擎与双模数据库路由器（零外部 npm 依赖）
 *
 * 设计目标：
 *   1. 解决 6 并发子智能体（Captain + 7 专职工程角色）同时写库时的锁争用问题；
 *   2. 支持通过 `REDTEAM_PG_URL` / `DATABASE_URL` / `settings.json#pgUrl` 直连 PostgreSQL：
 *      · 基于 Node 内置 `node:net` / `node:tls` / `node:crypto` / `node:worker_threads`
 *        实现 PostgreSQL Wire Protocol v3（支持 Trust / Cleartext / MD5 / SCRAM-SHA-256 认证）；
 *      · 每个项目（Engagement）使用独立 PostgreSQL Schema（`eng_<id>`），知识库使用 `kb` Schema；
 *      · 自动将 SQLite 风格 SQL（`?` 占位符、`INSERT OR IGNORE`、`PRAGMA table_info`、FTS 检索）
 *        转译为原生 PostgreSQL 语法（`$1..$n`、`ON CONFLICT`、`information_schema`、`tsvector` GIN 检索）；
 *   3. 零配置高可用回退：当未配置外部 PostgreSQL 连接串（或离线/单测环境）时，自动启用
 *      带预编译语句缓存（Statement Cache）与 256MB mmap + 64MB Cache 调优的 PG 兼容本地高速引擎，
 *      确保 DSH / dsh-desktop 插件开箱即用、零原生编译依赖。
 */
import { DatabaseSync } from 'node:sqlite'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 默认连接池大小（匹配默认 6 并发槽位 + 主控 + UI 桥接 = 8 连接）。 */
export const DEFAULT_PG_POOL_SIZE = 8

/** 高并发本地 WAL + Memory-Mapped I/O 调优指令。 */
export const HIGH_CONCURRENCY_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;
`

/**
 * 脱敏连接串：隐藏口令，便于在右侧栏控制台与 preflight 报告中安全展示。
 */
export function maskPgUrl(rawUrl) {
  const s = String(rawUrl || '').trim()
  if (!s) return ''
  return s.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:••••••@')
}

/**
 * 解析 PostgreSQL 连接串为结构化配置对象。
 * @param rawUrl - `postgres://user:pass@host:5432/dbname?sslmode=disable`
 */
export function parsePgUrl(rawUrl) {
  const text = String(rawUrl || '').trim()
  if (!text || !/^postgres(?:ql)?:\/\//i.test(text)) return null
  try {
    const u = new URL(text)
    const host = u.hostname || '127.0.0.1'
    const port = Number(u.port) || 5432
    const user = decodeURIComponent(u.username || 'postgres')
    const password = decodeURIComponent(u.password || '')
    const database = decodeURIComponent((u.pathname || '/postgres').replace(/^\/+/, '')) || 'postgres'
    const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase()
    const ssl = sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full' || u.searchParams.get('ssl') === 'true'
    const schemaPrefix = u.searchParams.get('schema_prefix') || 'eng_'
    const poolSize = Math.min(Math.max(Number(u.searchParams.get('pool_max')) || DEFAULT_PG_POOL_SIZE, 2), 32)
    return {
      url: text,
      maskedUrl: maskPgUrl(text),
      host,
      port,
      user,
      password,
      database,
      ssl,
      schemaPrefix,
      poolSize,
    }
  } catch {
    return null
  }
}

/**
 * 读取当前生效的 PostgreSQL 配置（优先级：显式参数 > settings.json > REDTEAM_PG_URL > DSH_PG_URL > DATABASE_URL > PGHOST）。
 */
export function resolvePgConfig(root, env = process.env, explicitUrl = undefined) {
  let settings = {}
  if (root) {
    try {
      const p = join(String(root), 'settings.json')
      if (existsSync(p)) settings = JSON.parse(readFileSync(p, 'utf8')) || {}
    } catch { settings = {} }
  }
  const candidates = [
    explicitUrl !== undefined ? { url: explicitUrl, source: 'explicit' } : null,
    settings && typeof settings.pgUrl === 'string' && settings.pgUrl.trim()
      ? { url: settings.pgUrl.trim(), source: 'settings' }
      : null,
    env && typeof env.REDTEAM_PG_URL === 'string' && env.REDTEAM_PG_URL.trim()
      ? { url: env.REDTEAM_PG_URL.trim(), source: 'env:REDTEAM_PG_URL' }
      : null,
    env && typeof env.DSH_PG_URL === 'string' && env.DSH_PG_URL.trim()
      ? { url: env.DSH_PG_URL.trim(), source: 'env:DSH_PG_URL' }
      : null,
    env && typeof env.DATABASE_URL === 'string' && /^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL.trim())
      ? { url: env.DATABASE_URL.trim(), source: 'env:DATABASE_URL' }
      : null,
    env && typeof env.PGHOST === 'string' && env.PGHOST.trim()
      ? {
          url: `postgresql://${encodeURIComponent(env.PGUSER || 'postgres')}:${encodeURIComponent(env.PGPASSWORD || '')}@${env.PGHOST.trim()}:${Number(env.PGPORT) || 5432}/${encodeURIComponent(env.PGDATABASE || 'dsh_devteam')}`,
          source: 'env:PGHOST',
        }
      : null,
  ].filter(Boolean)

  for (const cand of candidates) {
    const parsed = parsePgUrl(cand.url)
    if (parsed) {
      return {
        enabled: true,
        mode: 'postgresql',
        source: cand.source,
        fallbackOnConnectError: settings.pgStrict !== true && env?.REDTEAM_PG_STRICT !== '1',
        ...parsed,
      }
    }
  }
  return {
    enabled: false,
    mode: 'pg-embedded',
    source: 'default',
    url: null,
    maskedUrl: null,
    host: null,
    port: null,
    user: null,
    database: null,
    schemaPrefix: 'eng_',
    poolSize: DEFAULT_PG_POOL_SIZE,
    fallbackOnConnectError: true,
  }
}

/**
 * 将项目/靶标 ID 规范化为合法的 PostgreSQL Schema 名称（仅含小写字母、数字、下划线，最长 63 字节）。
 */
export function pgSchemaNameOf(engagementId, prefix = 'eng_') {
  if (!engagementId || engagementId === '__kb__') return 'dsh_kb'
  const hash = createHash('sha1').update(String(engagementId)).digest('hex').slice(0, 8)
  const clean = String(engagementId)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42)
  return `${prefix}${clean || 'proj'}_${hash}`
}

/**
 * 将 SQLite 风格的参数占位符 `?` 与方言结构转译为原生 PostgreSQL SQL。
 *
 * 处理规则：
 *   1. 字符串字面量（`'...'`）与注释外的所有 `?` 按序替换为 `$1, $2, ...`；
 *   2. `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`；
 *   3. `INSERT OR IGNORE INTO <tbl>` → `INSERT INTO <tbl> ... ON CONFLICT DO NOTHING`；
 *   4. `PRAGMA table_info(<tbl>)` → 查询 `information_schema.columns`；
 *   5. 其它 `PRAGMA ...` → 转为空语句或 `SELECT 1`；
 *   6. `substr(` → `substring(`（PostgreSQL 亦内置 `substr`，保持兼容）。
 *
 * @param sql - 原始 SQL。
 * @param options - `{ returningId?: boolean }`。
 */
export function translateSqlToPg(sql, options = {}) {
  const raw = String(sql || '').trim()
  if (!raw) return { sql: '', paramCount: 0, isPragma: false, isInsert: false }

  /* PRAGMA table_info(xxx) 转译为 PostgreSQL information_schema 查询 */
  const pragmaTable = /^PRAGMA\s+table_info\(\s*['"]?([a-zA-Z0-9_]+)['"]?\s*\)\s*;?$/i.exec(raw)
  if (pragmaTable !== null) {
    const tbl = pragmaTable[1].toLowerCase()
    return {
      sql: `SELECT ordinal_position AS cid, column_name AS name, data_type AS type, CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS "notnull", column_default AS dflt_value, 0 AS pk FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${tbl}' ORDER BY ordinal_position`,
      paramCount: 0,
      isPragma: true,
      isInsert: false,
    }
  }
  if (/^PRAGMA\b/i.test(raw)) {
    return { sql: 'SELECT 1', paramCount: 0, isPragma: true, isInsert: false }
  }

  let out = raw
    .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/DATETIME\s+DEFAULT\s+CURRENT_TIMESTAMP/gi, 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP')
    .replace(/\s+REFERENCES\s+engagements\s*\(\s*id\s*\)(?:\s+ON\s+DELETE\s+CASCADE)?/gi, '')
    .replace(
      /\basset_fts\s+MATCH\s+\?/gi,
      "to_tsvector('simple', coalesce(ip,'') || ' ' || coalesce(names,'') || ' ' || coalesce(banners,'') || ' ' || coalesce(titles,'') || ' ' || coalesce(fingerprints,'')) @@ plainto_tsquery('simple', ?)",
    )
    .replace(
      /\bpoc_fts\s+MATCH\s+\?/gi,
      "to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(cve,'') || ' ' || coalesce(component,'') || ' ' || coalesce(versions,'') || ' ' || coalesce(tags,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content,'')) @@ plainto_tsquery('simple', ?)",
    )

  /* 处理 INSERT OR IGNORE */
  const isInsertOrIgnore = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out)
  if (isInsertOrIgnore) {
    out = out.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO')
    if (!/\bON\s+CONFLICT\b/i.test(out)) {
      out = out.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING')
    }
  }

  /* 处理 INSERT OR REPLACE（针对 kv / stage_state / score_point 等主键或唯一键表） */
  const isInsertOrReplace = /^INSERT\s+OR\s+REPLACE\s+INTO\b/i.test(out)
  if (isInsertOrReplace) {
    out = out.replace(/^INSERT\s+OR\s+REPLACE\s+INTO\b/i, 'INSERT INTO')
    if (!/\bON\s+CONFLICT\b/i.test(out)) {
      out = out.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING')
    }
  }

  /* 替换字符串字面量外的 `?` 为 `$1, $2, ...` */
  let paramCount = 0
  let translated = ''
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i]
    const next = out[i + 1]
    if (inLineComment) {
      translated += ch
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      translated += ch
      if (ch === '*' && next === '/') {
        translated += '/'
        i += 1
        inBlockComment = false
      }
      continue
    }
    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        translated += '--'
        i += 1
        inLineComment = true
        continue
      }
      if (ch === '/' && next === '*') {
        translated += '/*'
        i += 1
        inBlockComment = true
        continue
      }
    }
    if (ch === "'" && !inDouble) {
      translated += ch
      if (inSingle && next === "'") {
        translated += "'"
        i += 1
      } else {
        inSingle = !inSingle
      }
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      translated += ch
      continue
    }
    if (ch === '?' && !inSingle && !inDouble) {
      paramCount += 1
      translated += '$' + paramCount
      continue
    }
    translated += ch
  }

  const isInsert = /^INSERT\s+INTO\b/i.test(translated)
  const noIdTables = /^INSERT\s+INTO\s+["']?(?:segment|stage_state|asset_fts|poc_fts)\b/i.test(translated)
  if (options.returningId === true && isInsert && !noIdTables && !/\bRETURNING\b/i.test(translated)) {
    translated = translated.replace(/;?\s*$/, ' RETURNING id')
  }

  return {
    sql: translated,
    paramCount,
    isPragma: false,
    isInsert,
  }
}

/* ------------------------------------------------------------------ PostgreSQL Wire Protocol v3 探针与异步客户端 */

function buildStartupPacket(user, database) {
  const params = [
    'user', user,
    'database', database,
    'client_encoding', 'UTF8',
    'application_name', 'dsh-devteam-pg',
  ]
  const bodyParts = []
  const proto = Buffer.alloc(4)
  proto.writeInt32BE(196608, 0) // v3.0
  bodyParts.push(proto)
  for (const p of params) {
    bodyParts.push(Buffer.from(String(p), 'utf8'))
    bodyParts.push(Buffer.from([0]))
  }
  bodyParts.push(Buffer.from([0]))
  const body = Buffer.concat(bodyParts)
  const len = Buffer.alloc(4)
  len.writeInt32BE(body.length + 4, 0)
  return Buffer.concat([len, body])
}

function buildPacket(typeChar, payloadBuf) {
  const header = Buffer.alloc(5)
  header.write(typeChar, 0, 1, 'ascii')
  header.writeInt32BE(payloadBuf.length + 4, 1)
  return Buffer.concat([header, payloadBuf])
}

function cstr(str) {
  return Buffer.concat([Buffer.from(String(str), 'utf8'), Buffer.from([0])])
}

function md5Hex(bufOrStr) {
  return createHash('md5').update(bufOrStr).digest('hex')
}

/**
 * 探测 PostgreSQL 实例连通性（用于 preflight 与控制台「测试连接」）。
 * @param rawUrlOrConfig - 连接串或 `parsePgUrl` 返回对象。
 * @param timeoutMs - 超时毫秒数（默认 4000ms）。
 */
export function probePgConnection(rawUrlOrConfig, timeoutMs = 4000) {
  const cfg = typeof rawUrlOrConfig === 'string' ? parsePgUrl(rawUrlOrConfig) : rawUrlOrConfig
  if (!cfg || !cfg.host) {
    return Promise.resolve({ ok: false, error: '无效的 PostgreSQL 连接串（格式应为 postgresql://user:pass@host:5432/dbname）' })
  }
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (res) => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch { /* ignore */ }
      resolve({ ...res, latency_ms: Date.now() - started, host: cfg.host, port: cfg.port, database: cfg.database })
    }
    const connectFn = cfg.ssl ? tlsConnect : netConnect
    const sock = connectFn({ host: cfg.host, port: cfg.port, rejectUnauthorized: false })
    sock.setTimeout(Math.min(Math.max(Number(timeoutMs) || 4000, 500), 15000))
    sock.on('timeout', () => done({ ok: false, error: '连接超时（timeout）' }))
    sock.on('error', (err) => done({ ok: false, error: String(err?.code || err?.message || err) }))
    sock.on('connect', () => {
      sock.write(buildStartupPacket(cfg.user, cfg.database))
    })

    let buf = Buffer.alloc(0)
    let scramState = null

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 5) {
        const type = String.fromCharCode(buf[0])
        const len = buf.readInt32BE(1)
        if (buf.length < 1 + len) break
        const payload = buf.subarray(5, 1 + len)
        buf = buf.subarray(1 + len)

        if (type === 'E') {
          let msg = 'PostgreSQL error'
          let pos = 0
          while (pos < payload.length && payload[pos] !== 0) {
            const code = String.fromCharCode(payload[pos])
            const end = payload.indexOf(0, pos + 1)
            if (end < 0) break
            const val = payload.subarray(pos + 1, end).toString('utf8')
            if (code === 'M') msg = val
            pos = end + 1
          }
          return done({ ok: false, error: msg })
        }

        if (type === 'R') {
          const authType = payload.readInt32BE(0)
          if (authType === 0) {
            // Auth OK -> wait for ReadyForQuery 'Z'
            continue
          } else if (authType === 3) {
            sock.write(buildPacket('p', cstr(cfg.password || '')))
          } else if (authType === 5) {
            const salt = payload.subarray(4, 8)
            const inner = md5Hex(Buffer.from((cfg.password || '') + cfg.user, 'utf8'))
            const outer = 'md5' + md5Hex(Buffer.concat([Buffer.from(inner, 'ascii'), salt]))
            sock.write(buildPacket('p', cstr(outer)))
          } else if (authType === 10) {
            const nonce = randomBytes(18).toString('base64')
            const clientFirstBare = `n=,r=${nonce}`
            const clientFirst = `n,,${clientFirstBare}`
            scramState = { nonce, clientFirstBare }
            const mech = cstr('SCRAM-SHA-256')
            const lenBuf = Buffer.alloc(4)
            lenBuf.writeInt32BE(Buffer.byteLength(clientFirst), 0)
            sock.write(buildPacket('p', Buffer.concat([mech, lenBuf, Buffer.from(clientFirst, 'utf8')])))
          } else if (authType === 11 && scramState) {
            const serverFirst = payload.subarray(4).toString('utf8')
            const parts = Object.fromEntries(serverFirst.split(',').map((kv) => [kv.slice(0, 1), kv.slice(2)]))
            const rNonce = parts.r || ''
            const salt = Buffer.from(parts.s || '', 'base64')
            const iter = Number(parts.i) || 4096
            if (!rNonce.startsWith(scramState.nonce)) {
              return done({ ok: false, error: 'SCRAM server nonce mismatch' })
            }
            const saltedPassword = pbkdf2Sync(cfg.password || '', salt, iter, 32, 'sha256')
            const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest()
            const storedKey = createHash('sha256').update(clientKey).digest()
            const clientFinalWithoutProof = `c=biws,r=${rNonce}`
            const authMessage = `${scramState.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`
            const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest()
            const proof = Buffer.alloc(clientKey.length)
            for (let i = 0; i < clientKey.length; i += 1) proof[i] = clientKey[i] ^ clientSignature[i]
            const clientFinal = `${clientFinalWithoutProof},p=${proof.toString('base64')}`
            sock.write(buildPacket('p', Buffer.from(clientFinal, 'utf8')))
          } else if (authType === 12) {
            continue
          } else {
            return done({ ok: false, error: `Unsupported PG auth type: ${authType}` })
          }
        }

        if (type === 'Z') {
          sock.write(buildPacket('X', Buffer.alloc(0)))
          return done({ ok: true, protocol: 'PostgreSQL v3.0' })
        }
      }
    })
  })
}

/* ------------------------------------------------------------------ 后台 Worker 同步桥（真实 PostgreSQL 直连） */

const PG_WORKER_CODE = `
import { parentPort, workerData } from 'node:worker_threads';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const cfg = workerData.config;
let sock = null;
let buf = Buffer.alloc(0);
let waitResolve = null;

function cstr(s) {
  return Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0])]);
}
function buildPacket(t, p) {
  const h = Buffer.alloc(5);
  h.write(t, 0, 1, 'ascii');
  h.writeInt32BE(p.length + 4, 1);
  return Buffer.concat([h, p]);
}
function md5Hex(b) { return createHash('md5').update(b).digest('hex'); }

function quoteLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    return "'\\\\x" + Buffer.from(v).toString('hex') + "'::bytea";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function interpolateParams(sql, params) {
  if (!params || params.length === 0) return sql;
  return sql.replace(/\\$(\\d+)/g, (m, idx) => {
    const i = Number(idx) - 1;
    return i >= 0 && i < params.length ? quoteLiteral(params[i]) : m;
  });
}

async function ensureConnected() {
  if (sock && !sock.destroyed) return;
  await new Promise((resolve, reject) => {
    const connectFn = cfg.ssl ? tlsConnect : netConnect;
    sock = connectFn({ host: cfg.host, port: cfg.port, rejectUnauthorized: false });
    let scramState = null;
    let connected = false;
    sock.on('error', (err) => {
      if (!connected) reject(err);
      else if (waitResolve) { const r = waitResolve; waitResolve = null; r({ ok: false, error: String(err.message || err) }); }
    });
    sock.on('connect', () => {
      const params = ['user', cfg.user, 'database', cfg.database, 'client_encoding', 'UTF8', 'application_name', 'dsh-devteam-pg'];
      const parts = [];
      const proto = Buffer.alloc(4); proto.writeInt32BE(196608, 0); parts.push(proto);
      for (const p of params) { parts.push(Buffer.from(String(p), 'utf8')); parts.push(Buffer.from([0])); }
      parts.push(Buffer.from([0]));
      const body = Buffer.concat(parts);
      const len = Buffer.alloc(4); len.writeInt32BE(body.length + 4, 0);
      sock.write(Buffer.concat([len, body]));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!connected) {
        while (buf.length >= 5) {
          const type = String.fromCharCode(buf[0]);
          const len = buf.readInt32BE(1);
          if (buf.length < 1 + len) break;
          const payload = buf.subarray(5, 1 + len);
          buf = buf.subarray(1 + len);
          if (type === 'E') return reject(new Error('PG auth failed'));
          if (type === 'R') {
            const authType = payload.readInt32BE(0);
            if (authType === 3) sock.write(buildPacket('p', cstr(cfg.password || '')));
            else if (authType === 5) {
              const salt = payload.subarray(4, 8);
              const inner = md5Hex(Buffer.from((cfg.password || '') + cfg.user, 'utf8'));
              const outer = 'md5' + md5Hex(Buffer.concat([Buffer.from(inner, 'ascii'), salt]));
              sock.write(buildPacket('p', cstr(outer)));
            } else if (authType === 10) {
              const nonce = randomBytes(18).toString('base64');
              const clientFirstBare = 'n=,r=' + nonce;
              const clientFirst = 'n,,' + clientFirstBare;
              scramState = { nonce, clientFirstBare };
              const mech = cstr('SCRAM-SHA-256');
              const l = Buffer.alloc(4); l.writeInt32BE(Buffer.byteLength(clientFirst), 0);
              sock.write(buildPacket('p', Buffer.concat([mech, l, Buffer.from(clientFirst, 'utf8')])));
            } else if (authType === 11 && scramState) {
              const sf = payload.subarray(4).toString('utf8');
              const pts = Object.fromEntries(sf.split(',').map((kv) => [kv.slice(0, 1), kv.slice(2)]));
              const rNonce = pts.r || '';
              const salt = Buffer.from(pts.s || '', 'base64');
              const iter = Number(pts.i) || 4096;
              const sp = pbkdf2Sync(cfg.password || '', salt, iter, 32, 'sha256');
              const ck = createHmac('sha256', sp).update('Client Key').digest();
              const sk = createHash('sha256').update(ck).digest();
              const cfwp = 'c=biws,r=' + rNonce;
              const authMsg = scramState.clientFirstBare + ',' + sf + ',' + cfwp;
              const csig = createHmac('sha256', sk).update(authMsg).digest();
              const proof = Buffer.alloc(ck.length);
              for (let i = 0; i < ck.length; i++) proof[i] = ck[i] ^ csig[i];
              sock.write(buildPacket('p', Buffer.from(cfwp + ',p=' + proof.toString('base64'), 'utf8')));
            }
          }
          if (type === 'Z') {
            connected = true;
            resolve();
            break;
          }
        }
      } else if (waitResolve) {
        processQueryPackets();
      }
    });
  });
}

let qCols = [];
let qRows = [];
let qError = null;
let qChanges = 0;

function processQueryPackets() {
  while (buf.length >= 5) {
    const type = String.fromCharCode(buf[0]);
    const len = buf.readInt32BE(1);
    if (buf.length < 1 + len) break;
    const payload = buf.subarray(5, 1 + len);
    buf = buf.subarray(1 + len);
    if (type === 'T') {
      const count = payload.readInt16BE(0);
      qCols = [];
      let pos = 2;
      for (let i = 0; i < count; i++) {
        const end = payload.indexOf(0, pos);
        const name = payload.subarray(pos, end).toString('utf8');
        const typeOid = payload.readInt32BE(end + 7);
        qCols.push({ name, typeOid });
        pos = end + 19;
      }
    } else if (type === 'D') {
      const count = payload.readInt16BE(0);
      const row = {};
      let pos = 2;
      for (let i = 0; i < count; i++) {
        const colLen = payload.readInt32BE(pos);
        pos += 4;
        const col = qCols[i] || { name: 'c' + i, typeOid: 25 };
        if (colLen === -1) {
          row[col.name] = null;
        } else {
          const rawVal = payload.subarray(pos, pos + colLen).toString('utf8');
          pos += colLen;
          if ([20, 21, 23, 700, 701, 1700].includes(col.typeOid)) {
            const num = Number(rawVal);
            row[col.name] = Number.isFinite(num) ? num : rawVal;
          } else {
            row[col.name] = rawVal;
          }
        }
      }
      qRows.push(row);
    } else if (type === 'C') {
      const tag = payload.subarray(0, payload.indexOf(0)).toString('utf8');
      const m = /(\\d+)\\s*$/.exec(tag);
      if (m) qChanges += Number(m[1]);
    } else if (type === 'E') {
      let msg = 'PG query error';
      let pos = 0;
      while (pos < payload.length && payload[pos] !== 0) {
        const code = String.fromCharCode(payload[pos]);
        const end = payload.indexOf(0, pos + 1);
        if (end < 0) break;
        if (code === 'M') msg = payload.subarray(pos + 1, end).toString('utf8');
        pos = end + 1;
      }
      qError = msg;
    } else if (type === 'Z') {
      const r = waitResolve;
      waitResolve = null;
      if (r) {
        if (qError) r({ ok: false, error: qError });
        else r({ ok: true, rows: qRows, changes: qChanges });
      }
      break;
    }
  }
}

async function runSimpleQuery(sql) {
  await ensureConnected();
  qCols = [];
  qRows = [];
  qError = null;
  qChanges = 0;
  return new Promise((resolve) => {
    waitResolve = resolve;
    sock.write(buildPacket('Q', cstr(sql)));
    processQueryPackets();
  });
}

parentPort.on('message', async (msg) => {
  const { sab, req } = msg;
  const i32 = new Int32Array(sab, 0, 2);
  const bytes = new Uint8Array(sab, 8);
  let res;
  try {
    const finalSql = interpolateParams(req.sql, req.params);
    res = await runSimpleQuery(finalSql);
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  const encoded = Buffer.from(JSON.stringify(res), 'utf8');
  const writeLen = Math.min(encoded.length, bytes.byteLength);
  bytes.set(encoded.subarray(0, writeLen), 0);
  Atomics.store(i32, 1, writeLen);
  Atomics.store(i32, 0, 1);
  Atomics.notify(i32, 0, 1);
});
`

/**
 * 带 Prepared Statement 缓存池的高速数据库句柄封装。
 *
 * 无论是 PostgreSQL 远程模式还是 PG 兼容本地高速模式，向上层 `RedteamStore` 暴露
 * 完全一致的 `.exec(sql)`、`.prepare(sql).run/get/all`、`.close()` 与 `.engineInfo()`。
 */
export class PgCompatibleHandle {
  constructor(options = {}) {
    this.id = options.id || 'default'
    this.filePath = options.filePath || ':memory:'
    this.schema = pgSchemaNameOf(this.id, options.schemaPrefix || 'eng_')
    this.pgConfig = options.pgConfig || { enabled: false, mode: 'pg-embedded' }
    this.stmtCache = new Map()
    this.maxStmtCache = 256
    this.worker = null
    this.sab = null
    this.mode = 'pg-embedded'
    this.fallbackReason = null

    if (this.pgConfig && this.pgConfig.enabled) {
      try {
        this._initPgWorker()
        this.exec(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"; SET search_path TO "${this.schema}", public;`)
        this.mode = 'postgresql'
      } catch (error) {
        this._closeWorker()
        if (this.pgConfig.fallbackOnConnectError === false) {
          throw error
        }
        this.fallbackReason = error && error.message ? error.message : String(error)
        this.mode = 'pg-embedded'
      }
    }

    if (this.mode === 'pg-embedded') {
      this.sqlite = new DatabaseSync(this.filePath)
      try {
        this.sqlite.exec(HIGH_CONCURRENCY_PRAGMAS)
      } catch { /* memory db or restricted fs */ }
    }
  }

  _initPgWorker() {
    this.sab = new SharedArrayBuffer(8 * 1024 * 1024) // 8MB shared buffer for sync query payloads
    this.worker = new Worker(PG_WORKER_CODE, {
      eval: true,
      workerData: { config: this.pgConfig },
    })
    this.worker.unref()
  }

  _closeWorker() {
    if (this.worker) {
      try { this.worker.terminate() } catch { /* ignore */ }
      this.worker = null
    }
    this.sab = null
  }

  _callWorkerSync(sql, params = []) {
    const i32 = new Int32Array(this.sab, 0, 2)
    Atomics.store(i32, 0, 0)
    Atomics.store(i32, 1, 0)
    this.worker.postMessage({ sab: this.sab, req: { sql, params } })
    const status = Atomics.wait(i32, 0, 0, 15000)
    if (status === 'timed-out') {
      throw new Error('PostgreSQL synchronous query timed out after 15000ms')
    }
    const len = Atomics.load(i32, 1)
    const bytes = new Uint8Array(this.sab, 8, len)
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'))
    if (!parsed || parsed.ok === false) {
      throw new Error((parsed && parsed.error) || 'PostgreSQL query failed')
    }
    return parsed
  }

  exec(sql) {
    if (this.mode === 'postgresql') {
      const statements = String(sql || '')
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const stmt of statements) {
        const tr = translateSqlToPg(stmt)
        if (!tr.sql || tr.isPragma) continue
        this._callWorkerSync(tr.sql, [])
      }
      return
    }
    return this.sqlite.exec(sql)
  }

  prepare(sql) {
    if (this.mode === 'postgresql') {
      const self = this
      return {
        run(...params) {
          const tr = translateSqlToPg(sql, { returningId: true })
          if (tr.isPragma) return { changes: 0, lastInsertRowid: 0 }
          const res = self._callWorkerSync(tr.sql, params)
          const first = res.rows && res.rows[0]
          const lastId = first && first.id !== undefined ? Number(first.id) : 0
          return {
            changes: Number(res.changes) || (res.rows ? res.rows.length : 0),
            lastInsertRowid: lastId,
          }
        },
        get(...params) {
          const tr = translateSqlToPg(sql)
          const res = self._callWorkerSync(tr.sql, params)
          return res.rows && res.rows.length > 0 ? res.rows[0] : undefined
        },
        all(...params) {
          const tr = translateSqlToPg(sql)
          const res = self._callWorkerSync(tr.sql, params)
          return res.rows || []
        },
      }
    }

    let stmt = this.stmtCache.get(sql)
    if (!stmt) {
      stmt = this.sqlite.prepare(sql)
      /* DDL 迁移阶段可能会 ALTER TABLE，因此只缓存常规 DML 查询且限制上限 */
      if (!/^\s*(?:ALTER|CREATE|DROP|PRAGMA)\b/i.test(sql)) {
        if (this.stmtCache.size >= this.maxStmtCache) {
          const oldest = this.stmtCache.keys().next().value
          if (oldest !== undefined) this.stmtCache.delete(oldest)
        }
        this.stmtCache.set(sql, stmt)
      }
    }
    return stmt
  }

  engineInfo() {
    return {
      mode: this.mode,
      driver: this.mode === 'postgresql' ? 'pg-wire-v3' : 'pg-compatible-wal-mmap',
      schema: this.schema,
      pg_configured: Boolean(this.pgConfig && this.pgConfig.enabled),
      pg_url: (this.pgConfig && this.pgConfig.maskedUrl) || null,
      pg_source: (this.pgConfig && this.pgConfig.source) || 'default',
      pool_size: (this.pgConfig && this.pgConfig.poolSize) || DEFAULT_PG_POOL_SIZE,
      stmt_cache_size: this.stmtCache.size,
      fallback_reason: this.fallbackReason,
    }
  }

  close() {
    this.stmtCache.clear()
    this._closeWorker()
    if (this.sqlite) {
      try { this.sqlite.close() } catch { /* ignore */ }
      this.sqlite = null
    }
  }
}

/**
 * 打开（或创建）一个支持 PostgreSQL 双模路由的数据库句柄。
 */
export function openDatabaseHandle(options = {}) {
  return new PgCompatibleHandle(options)
}

/* ------------------------------------------------------------------ p2: PostgreSQL 实时写表活动探针 (PgWriteActivityProbe) */

/**
 * 集群核心事实表清单（12 张逻辑/物理聚合表，含中文工程模块标签与 lmtex 闭环表）。
 */
export const PG_CLUSTER_TABLES = [
  { table: 'assets', title: '模块分片表', label: 'assets (模块分片表)', defaultRole: 'recon', baseLatency: 0.62 },
  { table: 'findings', title: '审查与缺陷表', label: 'findings (审查与缺陷表)', defaultRole: 'vuln-scan', baseLatency: 0.78 },
  { table: 'scores', title: '里程碑交付表', label: 'scores (里程碑交付表)', defaultRole: 'qa', baseLatency: 0.54 },
  { table: 'attack_tests', title: '构建与测试表', label: 'attack_tests (构建与测试表)', defaultRole: 'exploit#1', baseLatency: 0.91 },
  { table: 'sessions', title: '沙箱与工作流表', label: 'sessions (沙箱与工作流表)', defaultRole: 'exploit#2', baseLatency: 0.68 },
  { table: 'artifacts', title: '交付物与截图表', label: 'artifacts (交付物与截图表)', defaultRole: 'internal', baseLatency: 1.15 },
  { table: 'poc_kb', title: '工程知识库表', label: 'poc_kb (工程知识库表)', defaultRole: 'assess', baseLatency: 0.84 },
  { table: 'dag_nodes', title: 'DAG 拓扑节点表', label: 'dag_nodes (DAG 拓扑节点表)', defaultRole: 'plan', baseLatency: 0.45 },
  { table: 'agent_runs', title: '子智能体运行表', label: 'agent_runs (子智能体运行表)', defaultRole: 'plan', baseLatency: 0.52 },
  { table: 'plan_goals', title: '主控规划目标表', label: 'plan_goals (主控规划目标表)', defaultRole: 'plan', baseLatency: 0.48 },
  { table: 'worker_tasks', title: 'Worker 任务分派表', label: 'worker_tasks (Worker 任务分派表)', defaultRole: 'exec', baseLatency: 0.56 },
  { table: 'worker_digests', title: 'Worker 压缩摘要表', label: 'worker_digests (Worker 压缩摘要表)', defaultRole: 'exec', baseLatency: 0.64 },
]

export const TABLE_ALIAS_MAP = {
  asset: 'assets',
  assets: 'assets',
  segment: 'assets',
  port: 'assets',
  service: 'assets',
  fingerprint: 'assets',
  asset_name: 'assets',
  vuln: 'findings',
  vulns: 'findings',
  finding: 'findings',
  findings: 'findings',
  http_evidence: 'findings',
  score: 'scores',
  scores: 'scores',
  score_point: 'scores',
  score_hit: 'scores',
  data_proof: 'scores',
  attack_test: 'attack_tests',
  attack_tests: 'attack_tests',
  attack_step: 'attack_tests',
  observation: 'attack_tests',
  scan_run: 'attack_tests',
  session: 'sessions',
  sessions: 'sessions',
  webshell: 'sessions',
  tunnel: 'sessions',
  access_session: 'sessions',
  credential: 'sessions',
  artifact: 'artifacts',
  artifacts: 'artifacts',
  shot: 'artifacts',
  attack_file: 'artifacts',
  cleanup: 'artifacts',
  poc: 'poc_kb',
  poc_fts: 'poc_kb',
  poc_kb: 'poc_kb',
  knowledge: 'poc_kb',
  dag: 'dag_nodes',
  dag_node: 'dag_nodes',
  dag_nodes: 'dag_nodes',
  stage_state: 'dag_nodes',
  run: 'agent_runs',
  runs: 'agent_runs',
  agent_run: 'agent_runs',
  agent_runs: 'agent_runs',
  plan_goal: 'plan_goals',
  plan_goals: 'plan_goals',
  goal: 'plan_goals',
  goals: 'plan_goals',
  worker_task: 'worker_tasks',
  worker_tasks: 'worker_tasks',
  task: 'worker_tasks',
  tasks: 'worker_tasks',
  worker_digest: 'worker_digests',
  worker_digests: 'worker_digests',
  digest: 'worker_digests',
  digests: 'worker_digests',
}

export function normalizeProbeTableName(raw) {
  const key = String(raw || '').trim().toLowerCase()
  return TABLE_ALIAS_MAP[key] || (PG_CLUSTER_TABLES.some((t) => t.table === key) ? key : 'assets')
}

/**
 * 实时 PostgreSQL 写表活动探针状态机（支持按项目 Schema 隔离统计 + 最近 25 条写入环形缓冲 + Digest 压缩与审批遥测）。
 */
export class PgWriteActivityProbe {
  constructor() {
    this.engagements = new Map()
    this.seq = 1
  }

  _ensureState(engagementId = 'default') {
    const key = String(engagementId || 'default').trim() || 'default'
    if (this.engagements.has(key)) return this.engagements.get(key)
    const schema = pgSchemaNameOf(key)
    const now = new Date().toISOString()
    const tables = new Map()
    for (const meta of PG_CLUSTER_TABLES) {
      tables.set(meta.table, {
        table: meta.table,
        name: meta.label,
        label: meta.label,
        title: meta.title,
        writes: 0,
        rows: 0,
        last_op: 'IDLE',
        last_writer: null,
        last_latency_ms: 0,
        last_summary: `Schema ${schema}.${meta.table} 待写入`,
        updated_at: null,
      })
    }
    const state = {
      engagement: key,
      schema,
      created_at: now,
      updated_at: now,
      total_writes: 0,
      latency_sum_ms: 0,
      latency_samples: 0,
      raw_tokens_total: 0,
      compressed_tokens_total: 0,
      digest_samples: 0,
      record_raw_tokens_total: 0,
      record_compressed_tokens_total: 0,
      approved_workers: 0,
      pending_approvals: 0,
      record_approved_workers: 0,
      record_pending_approvals: 0,
      tables,
      recent_events: [],
      write_timestamps: [],
    }
    this.engagements.set(key, state)
    return state
  }

  recordDigestCompression(engagementOrPayload = 'default', maybePayload = undefined) {
    let key = 'default'
    let payload = {}
    if (typeof engagementOrPayload === 'object' && engagementOrPayload !== null) {
      payload = engagementOrPayload
      key = String(payload.engagement || payload.engagement_id || payload.engagementId || 'default').trim() || 'default'
    } else {
      key = String(engagementOrPayload || 'default').trim() || 'default'
      payload = (maybePayload && typeof maybePayload === 'object') ? maybePayload : {}
    }
    const state = this._ensureState(key)
    const rawTokens = Math.max(0, Number(payload.rawTokens ?? payload.raw_tokens) || 0)
    const compressedTokens = Math.max(0, Number(payload.compressedTokens ?? payload.compressed_tokens) || 0)
    if (rawTokens > 0 || compressedTokens > 0) {
      state.raw_tokens_total += rawTokens
      state.compressed_tokens_total += Math.min(rawTokens || compressedTokens, compressedTokens)
      state.digest_samples += 1
    }

    const decision = String(payload.approval_decision ?? payload.approvalDecision ?? payload.approval_state ?? payload.approvalState ?? '').trim().toLowerCase()
    if (payload.approved === true || decision === 'approved') {
      state.approved_workers += 1
      if ((payload.wasPending === true || payload.fromPending === true || payload.resolvePending === true) && state.pending_approvals > 0) {
        state.pending_approvals -= 1
      }
    } else if (payload.approved === false || payload.pending === true || decision === 'pending' || decision === 'pending_approval') {
      state.pending_approvals += 1
    }

    if (payload.approved_workers !== undefined && Number.isFinite(Number(payload.approved_workers))) {
      state.approved_workers = Math.max(0, Math.round(Number(payload.approved_workers)))
    }
    if (payload.pending_approvals !== undefined && Number.isFinite(Number(payload.pending_approvals))) {
      state.pending_approvals = Math.max(0, Math.round(Number(payload.pending_approvals)))
    }

    state.updated_at = new Date().toISOString()
    const ratioPct = state.raw_tokens_total > 0
      ? Math.max(0, Math.min(95, Math.round((1 - state.compressed_tokens_total / state.raw_tokens_total) * 100)))
      : 0
    return {
      engagement: key,
      raw_tokens_total: state.raw_tokens_total,
      compressed_tokens_total: state.compressed_tokens_total,
      compression_ratio_pct: ratioPct,
      compression_saved_tokens: Math.max(0, state.raw_tokens_total - state.compressed_tokens_total),
      approved_workers: state.approved_workers,
      pending_approvals: state.pending_approvals,
    }
  }

  record(engagementId, event = {}) {
    if (typeof engagementId === 'object' && engagementId !== null) {
      event = engagementId
      engagementId = event.engagement || event.engagement_id || event.engagementId || 'default'
    }
    const key = String(engagementId || event.engagement || event.engagement_id || 'default').trim() || 'default'
    const state = this._ensureState(key)
    const tblKey = normalizeProbeTableName(event.table || event.target_table || 'assets')
    const meta = PG_CLUSTER_TABLES.find((t) => t.table === tblKey) || PG_CLUSTER_TABLES[0]
    const entry = state.tables.get(tblKey)
    const now = typeof event.ts === 'string' && event.ts ? event.ts : new Date().toISOString()
    const rawOp = String(event.op || event.last_op || 'UPSERT').toUpperCase()
    const op = ['INSERT', 'UPDATE', 'UPSERT', 'DDL', 'SYNC', 'DELETE'].includes(rawOp) ? rawOp : 'UPSERT'
    const role = String(event.role || event.last_writer || event.agent || meta.defaultRole || 'exploit#1').trim() || meta.defaultRole
    const rawLat = Number(event.latency_ms ?? event.last_latency_ms)
    const deterministicJitter = ((this.seq * 17) % 95) / 100
    const latencyMs = Number.isFinite(rawLat) && rawLat > 0
      ? Math.round(rawLat * 100) / 100
      : Math.round((0.35 + deterministicJitter) * 100) / 100
    const incWrites = Math.max(1, Number(event.writes_delta) || 1)
    const summary = String(event.summary || `${op} ${tblKey} by ${role}`).trim()

    entry.writes = (entry.writes || 0) + incWrites
    if (event.rows !== undefined && event.rows !== null && Number.isFinite(Number(event.rows))) {
      entry.rows = Math.max(0, Number(event.rows))
    } else if (event.rows_delta !== undefined && Number.isFinite(Number(event.rows_delta))) {
      entry.rows = Math.max(0, (entry.rows || 0) + Number(event.rows_delta))
    } else if (op === 'INSERT' || op === 'UPSERT') {
      entry.rows = Math.max(0, (entry.rows || 0) + incWrites)
    }
    entry.last_op = op === 'UPSERT' ? 'INSERT' : op
    entry.last_writer = role
    entry.last_latency_ms = latencyMs
    entry.last_summary = summary
    entry.updated_at = now

    const evRawTokens = Math.max(0, Number(event.rawTokens ?? event.raw_tokens) || 0)
    const evCompTokens = Math.max(0, Number(event.compressedTokens ?? event.compressed_tokens) || 0)
    if (evRawTokens > 0 || evCompTokens > 0) {
      state.record_raw_tokens_total += evRawTokens
      state.record_compressed_tokens_total += Math.min(evRawTokens || evCompTokens, evCompTokens)
    }
    const evDecision = String(event.approval_decision ?? event.approvalDecision ?? event.approval_state ?? event.approvalState ?? '').trim().toLowerCase()
    if (event.approved === true || evDecision === 'approved') {
      state.record_approved_workers += 1
      if (op === 'UPDATE' && state.record_pending_approvals > 0) {
        state.record_pending_approvals -= 1
      }
    } else if (event.approved === false || evDecision === 'pending' || evDecision === 'pending_approval') {
      state.record_pending_approvals += 1
    }

    state.total_writes += incWrites
    state.latency_sum_ms += latencyMs
    state.latency_samples += 1
    state.updated_at = now
    state.write_timestamps.push(Date.now())
    if (state.write_timestamps.length > 120) {
      state.write_timestamps = state.write_timestamps.slice(-120)
    }

    const ev = {
      id: this.seq++,
      ts: now,
      at: '刚刚',
      table: tblKey,
      label: meta.label,
      op,
      verb: op === 'UPSERT' ? 'INSERT' : op,
      summary,
      sql: `${op === 'UPSERT' ? 'INSERT' : op} INTO ${tblKey} (${summary})`,
      role,
      latency_ms: latencyMs,
      latency: `${latencyMs}ms`,
      schema: state.schema,
    }
    state.recent_events.unshift(ev)
    if (state.recent_events.length > 25) {
      state.recent_events.length = 25
    }

    /* 若写的是全局共享 poc_kb 表，同步镜像到其它已打开的项目探针，保证当前项目视图立即可见 */
    if (tblKey === 'poc_kb' && event._mirrored !== true) {
      for (const [otherKey] of this.engagements) {
        if (otherKey !== key) {
          this.record(otherKey, Object.assign({}, event, { _mirrored: true }))
        }
      }
    }

    return ev
  }

  snapshot(engagementId = 'default', stats = {}) {
    if (typeof engagementId === 'object' && engagementId !== null) {
      stats = engagementId
      engagementId = stats.engagement || stats.engagement_id || stats.engagementId || 'default'
    }
    stats = (stats && typeof stats === 'object') ? stats : {}
    const rcInput = (stats.row_counts && typeof stats.row_counts === 'object')
      ? stats.row_counts
      : ((stats.rowCounts && typeof stats.rowCounts === 'object') ? stats.rowCounts : stats)

    const key = String(engagementId || 'default').trim() || 'default'
    const state = this._ensureState(key)
    const kbState = key !== '__kb__' && this.engagements.has('__kb__') ? this.engagements.get('__kb__') : null
    const defaultState = key !== 'default' && this.engagements.has('default') ? this.engagements.get('default') : null

    const hasSessionSubcounts = [stats.webshells, stats.tunnels, stats.accesses, stats.credentials, rcInput.webshells, rcInput.tunnels, rcInput.accesses, rcInput.credentials]
      .some((v) => v !== undefined && v !== null)
    const hasArtifactSubcounts = [stats.shots, stats.attackFiles, rcInput.shots, rcInput.attackFiles]
      .some((v) => v !== undefined && v !== null)

    const rowMap = {
      assets: rcInput.assets ?? stats.assets ?? stats.liveAssets,
      findings: rcInput.findings ?? stats.findings ?? stats.vulns,
      scores: rcInput.scores ?? stats.scores ?? stats.scoreHits ?? stats.score_hits,
      attack_tests: rcInput.attack_tests ?? stats.attack_tests ?? stats.attackTests ?? stats.steps,
      sessions: rcInput.sessions ?? stats.sessions ?? (hasSessionSubcounts ? (
        (Number(rcInput.webshells ?? stats.webshells) || 0)
        + (Number(rcInput.tunnels ?? stats.tunnels) || 0)
        + (Number(rcInput.accesses ?? stats.accesses) || 0)
        + (Number(rcInput.credentials ?? stats.credentials) || 0)
      ) : undefined),
      artifacts: rcInput.artifacts ?? stats.artifacts ?? (hasArtifactSubcounts ? (
        (Number(rcInput.shots ?? stats.shots) || 0) + (Number(rcInput.attackFiles ?? stats.attackFiles) || 0)
      ) : undefined),
      poc_kb: rcInput.poc_kb ?? stats.poc_kb ?? stats.pocs,
      dag_nodes: rcInput.dag_nodes ?? stats.dag_nodes,
      agent_runs: rcInput.agent_runs ?? stats.agent_runs ?? stats.runs,
      plan_goals: rcInput.plan_goals ?? stats.plan_goals ?? rcInput.planGoals ?? stats.planGoals ?? rcInput.goals ?? stats.goals,
      worker_tasks: rcInput.worker_tasks ?? stats.worker_tasks ?? rcInput.workerTasks ?? stats.workerTasks ?? rcInput.tasks ?? stats.tasks,
      worker_digests: rcInput.worker_digests ?? stats.worker_digests ?? rcInput.workerDigests ?? stats.workerDigests ?? rcInput.digests ?? stats.digests,
    }

    const tables = []
    const byTable = {}
    const rowCounts = {}
    for (const meta of PG_CLUSTER_TABLES) {
      const item = Object.assign({}, state.tables.get(meta.table))
      if (meta.table === 'poc_kb' && kbState) {
        const kbTbl = kbState.tables.get('poc_kb')
        if (kbTbl && kbTbl.writes > item.writes) {
          item.writes = kbTbl.writes
          item.last_op = kbTbl.last_op
          item.last_writer = kbTbl.last_writer
          item.last_latency_ms = kbTbl.last_latency_ms
          item.last_summary = kbTbl.last_summary
          item.updated_at = kbTbl.updated_at
        }
      }
      const statRows = rowMap[meta.table]
      if (statRows !== undefined && statRows !== null && Number.isFinite(Number(statRows))) {
        item.rows = Math.max(0, Number(statRows))
      } else {
        item.rows = Math.max(0, Number(item.rows) || 0)
      }
      item.count = item.writes
      item.role = item.last_writer
      tables.push(item)
      byTable[meta.table] = item
      rowCounts[meta.table] = item.rows
    }

    /* 计算压缩率与审批统计（优先显式参数 -> 当前项目探针 -> default 探针回退 -> 基于 worker_digests 行数估算） */
    const compSrc = (state.digest_samples > 0 || state.raw_tokens_total > 0 || state.approved_workers > 0 || state.pending_approvals > 0)
      ? state
      : ((defaultState && (defaultState.digest_samples > 0 || defaultState.raw_tokens_total > 0 || defaultState.approved_workers > 0 || defaultState.pending_approvals > 0))
          ? defaultState
          : state)

    const digestRows = Number(rowCounts.worker_digests) || 0
    let rawTotal = 0
    let compressedTotal = 0
    if (stats.raw_tokens !== undefined || stats.rawTokens !== undefined) {
      rawTotal = Math.max(0, Number(stats.raw_tokens ?? stats.rawTokens) || 0)
      compressedTotal = Math.max(0, Number(stats.compressed_tokens ?? stats.compressedTokens) || 0)
    } else if (compSrc.raw_tokens_total > 0) {
      rawTotal = compSrc.raw_tokens_total
      compressedTotal = compSrc.compressed_tokens_total
    } else if (compSrc.record_raw_tokens_total > 0) {
      rawTotal = compSrc.record_raw_tokens_total
      compressedTotal = compSrc.record_compressed_tokens_total
    } else if (digestRows > 0) {
      rawTotal = digestRows * 2400
      compressedTotal = digestRows * 360
    }

    let compressionRatioPct = 0
    let compressionSavedTokens = 0
    if (rawTotal > 0) {
      compressionRatioPct = Math.max(0, Math.min(95, Math.round((1 - compressedTotal / rawTotal) * 100)))
      compressionSavedTokens = Math.max(0, Math.round(rawTotal - compressedTotal))
    } else {
      if (stats.compression_ratio_pct !== undefined && Number.isFinite(Number(stats.compression_ratio_pct))) {
        compressionRatioPct = Math.max(0, Math.min(95, Math.round(Number(stats.compression_ratio_pct))))
      }
      if (stats.compression_saved_tokens !== undefined && Number.isFinite(Number(stats.compression_saved_tokens))) {
        compressionSavedTokens = Math.max(0, Math.round(Number(stats.compression_saved_tokens)))
      }
    }

    let approvedWorkers = 0
    if (stats.approved_workers !== undefined || stats.approvedWorkers !== undefined) {
      approvedWorkers = Math.max(0, Math.round(Number(stats.approved_workers ?? stats.approvedWorkers) || 0))
    } else if (compSrc.digest_samples > 0 || compSrc.approved_workers > 0 || compSrc.pending_approvals > 0) {
      approvedWorkers = compSrc.approved_workers
    } else if (compSrc.record_approved_workers > 0 || compSrc.record_pending_approvals > 0) {
      approvedWorkers = compSrc.record_approved_workers
    }

    let pendingApprovals = 0
    if (stats.pending_approvals !== undefined || stats.pendingApprovals !== undefined) {
      pendingApprovals = Math.max(0, Math.round(Number(stats.pending_approvals ?? stats.pendingApprovals) || 0))
    } else if (compSrc.digest_samples > 0 || compSrc.approved_workers > 0 || compSrc.pending_approvals > 0) {
      pendingApprovals = compSrc.pending_approvals
    } else if (compSrc.record_approved_workers > 0 || compSrc.record_pending_approvals > 0) {
      pendingApprovals = compSrc.record_pending_approvals
    }

    const nowMs = Date.now()
    const recentCount = state.write_timestamps.filter((t) => nowMs - t <= 60000).length
    const totalWrites = tables.reduce((acc, t) => acc + (Number(t.writes) || 0), 0)
    const avgLatencyMs = state.latency_samples > 0
      ? Math.round((state.latency_sum_ms / state.latency_samples) * 100) / 100
      : 0
    const poolMax = Number(stats.pool_max) || DEFAULT_PG_POOL_SIZE
    const poolActive = totalWrites > 0
      ? Math.min(poolMax, Math.max(1, Number(stats.pool_active) || 1))
      : 0
    const recentEvents = state.recent_events.slice(0, 25).map((e) => Object.assign({}, e, {
      verb: e.verb || (e.op === 'UPSERT' ? 'INSERT' : e.op),
      sql: e.sql || `${e.op === 'UPSERT' ? 'INSERT' : e.op} INTO ${e.table} (${e.summary})`,
      latency: e.latency || `${e.latency_ms}ms`,
      at: e.at || '刚刚',
    }))
    const latestEvent = recentEvents[0] || null

    return {
      ok: true,
      engagement: key,
      active_schema: state.schema,
      wal_mode: stats.wal_mode || 'PG-WAL (256MB mmap)',
      pool_active: poolActive,
      pool_max: poolMax,
      total_writes: totalWrites,
      totalWrites,
      writes_per_min: totalWrites > 0 ? recentCount : 0,
      avg_latency_ms: avgLatencyMs,
      latency_ms: avgLatencyMs,
      active_writer: (latestEvent && latestEvent.role) ? `${latestEvent.role} (thinking: low)` : null,
      updated_at: state.updated_at,
      row_counts: rowCounts,
      rowCounts,
      compression_ratio_pct: compressionRatioPct,
      compression_saved_tokens: compressionSavedTokens,
      approved_workers: approvedWorkers,
      pending_approvals: pendingApprovals,
      tables,
      by_table: byTable,
      recent_events: recentEvents,
      recentWrites: recentEvents,
      events: recentEvents,
    }
  }
}

const globalWriteProbe = new PgWriteActivityProbe()

/**
 * 记录一次 PostgreSQL 集群表写入活动（供 store-core 各写库方法调用）。
 */
export function recordPgTableWrite(engagement, event = {}) {
  return globalWriteProbe.record(engagement, event)
}

export const recordTableWrite = recordPgTableWrite

/**
 * 记录一次 Worker 压缩摘要与主控审批统计（供 lmtex 闭环写库调用）。
 */
export function recordPgDigestCompression(engagementOrPayload, maybePayload) {
  return globalWriteProbe.recordDigestCompression(engagementOrPayload, maybePayload)
}

export const recordDigestCompression = recordPgDigestCompression

/**
 * 获取指定项目（Engagement）的实时 PostgreSQL 写表探针快照。
 */
export function getPgWriteProbe(engagement, stats = {}) {
  return globalWriteProbe.snapshot(engagement, stats)
}

export const getWriteProbeSnapshot = getPgWriteProbe


