// EPG (Electronic Program Guide) — "Agora/A seguir" para um stream.
//
// É um recurso best-effort: a programação real vive em arquivos XMLTV externos
// (fontes mapeadas em guides.json da API do iptv-org). Buscamos sob demanda,
// com timeout, limite de tamanho e cache, e degradamos graciosamente — se a
// fonte estiver indisponível, devolvemos lista vazia e a UI simplesmente não
// mostra o guia. Inspirado nas "EPG Sources" do awesome-iptv.

import zlib from 'node:zlib'
import { promisify } from 'node:util'

const gunzip = promisify(zlib.gunzip)

const FETCH_TIMEOUT_MS = 12000
const MAX_BYTES = 30 * 1024 * 1024 // 30 MB por arquivo XMLTV
const RAW_TTL_MS = 10 * 60 * 1000 // cache do XMLTV bruto: 10 min
const RESULT_TTL_MS = 30 * 60 * 1000 // cache do resultado now/next: 30 min
const MAX_RAW_CACHE = 3 // no máx. 3 arquivos brutos em memória

// Cache LRU pequeno do XMLTV bruto (texto), por URL.
const rawCache = new Map() // url -> { at, text }
// Cache do resultado processado, por "url|siteId".
const resultCache = new Map() // key -> { at, programs }

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Converte data XMLTV ("20260612180000 +0000") em epoch ms, ou null. */
function parseXmltvDate(value) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/)
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00', tz] = m
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`
  if (tz) iso += `${tz.slice(0, 3)}:${tz.slice(3)}`
  else iso += 'Z'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** Decodifica as entidades XML mais comuns. */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/** Baixa o XMLTV (XML ou GZIP) com timeout e limite de tamanho. */
async function fetchXmltv(source) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) return null

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return null

    const isGzip = source.format === 'GZIP' || (buf[0] === 0x1f && buf[1] === 0x8b)
    const out = isGzip ? await gunzip(buf) : buf
    if (out.byteLength > MAX_BYTES) return null
    return out.toString('utf8')
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Pega o XMLTV bruto do cache ou baixa, mantendo o cache pequeno. */
async function getRaw(source) {
  const cached = rawCache.get(source.url)
  if (cached && Date.now() - cached.at < RAW_TTL_MS) return cached.text

  const text = await fetchXmltv(source)
  if (text == null) return null

  rawCache.set(source.url, { at: Date.now(), text })
  // Evita crescer demais: descarta o mais antigo.
  while (rawCache.size > MAX_RAW_CACHE) {
    const oldestKey = rawCache.keys().next().value
    rawCache.delete(oldestKey)
  }
  return text
}

/** Extrai os programas cujo `channel` casa com algum dos ids candidatos. */
function extractPrograms(xmltv, ids) {
  const idSet = new Set(ids)
  // Atalho: se nenhum id aparece no arquivo, não há o que processar.
  if (!ids.some(id => xmltv.includes(`"${id}"`))) return []

  const programs = []
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi
  let match
  while ((match = re.exec(xmltv)) !== null) {
    const attrs = match[1]
    const channelMatch = attrs.match(/\bchannel="([^"]*)"/i)
    if (!channelMatch || !idSet.has(channelMatch[1])) continue

    const start = parseXmltvDate((attrs.match(/\bstart="([^"]*)"/i) || [])[1])
    const stop = parseXmltvDate((attrs.match(/\bstop="([^"]*)"/i) || [])[1])
    const titleMatch = match[2].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? decodeEntities(titleMatch[1]) : ''
    if (start && title) programs.push({ title, start, stop })
  }
  programs.sort((a, b) => a.start - b.start)
  return programs
}

/** Seleciona "agora" + os próximos 2 programas. */
function pickNowNext(programs) {
  const now = Date.now()
  const current = programs.find(p => p.start <= now && (!p.stop || p.stop > now))
  const upcoming = programs.filter(p => p.start > now).slice(0, 2)
  const selected = []
  if (current) selected.push({ ...current, isNow: true })
  for (const p of upcoming) selected.push({ ...p, isNow: false })
  return selected
}

/**
 * Retorna até 3 programas (agora + próximos) para um guia.
 * @param {{ ids: string[], sources: {url:string,format:string}[] }} guide
 */
async function getNowNext(guide) {
  if (!guide || !guide.ids?.length || !guide.sources?.length) return []

  for (const source of guide.sources) {
    const key = `${source.url}|${guide.ids[0]}`
    const cached = resultCache.get(key)
    // Só usa o cache quando há programas: assim uma fonte vazia não impede
    // tentar as fontes seguintes até o TTL expirar (o XMLTV bruto ainda é
    // cacheado por getRaw, então não há novo download).
    if (cached && cached.programs.length > 0 && Date.now() - cached.at < RESULT_TTL_MS) {
      return cached.programs
    }

    const raw = await getRaw(source)
    if (!raw) continue

    const programs = pickNowNext(extractPrograms(raw, guide.ids))
    if (programs.length > 0) {
      resultCache.set(key, { at: Date.now(), programs })
      return programs
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// EPG completo em XMLTV (para apps de TV via Xtream /xmltv.php).
// Foco nos canais brasileiros: monta <channel> + <programme> a partir das
// mesmas fontes XMLTV, com janela de tempo limitada, cache longo e build em
// segundo plano (o request nunca bloqueia esperando downloads).
// ---------------------------------------------------------------------------

const XMLTV_TTL_MS = 3 * 60 * 60 * 1000 // 3 h
const XMLTV_BUILD_BUDGET_MS = 22_000 // tempo máx. por build
const XMLTV_MAX_SOURCES = 25 // nº máx. de fontes baixadas por build
const XMLTV_WINDOW_BACK_MS = 6 * 60 * 60 * 1000
const XMLTV_WINDOW_FWD_MS = 48 * 60 * 60 * 1000
const XMLTV_MAX_PROGS_PER_CH = 60
const EMPTY_XMLTV =
  '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iptv-web"></tv>\n'

let xmltvCache = { at: 0, xml: null }
let xmltvBuilding = false

function xmlText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function xmlAttr(value) {
  return xmlText(value).replace(/"/g, '&quot;')
}
function formatXmltvDate(ms) {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
  )
}

/** Normaliza um nome de canal para casar entre fontes (sem acento/cidade/pontuação). */
function canonName(raw) {
  let s = String(raw == null ? '' : raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  s = s.replace(/^.*?\/[a-z]{2}\s+/, '') // remove prefixo "cidade/uf " (ex.: "são paulo/sp ")
  return s.replace(/[^a-z0-9]+/g, '')
}

/** Canônico a partir do id da fonte (ex.: "São.Paulo/SP..SporTV.2.br" -> "sportv2"). */
function canonFromId(id) {
  let s = String(id == null ? '' : id)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  s = s.replace(/^.*?\/[a-z]{2}[.\s]+/, '') // remove "cidade/uf" (ponto ou espaço)
  s = s.replace(/\.br$/, '')
  return s.replace(/[^a-z0-9]+/g, '')
}

/** Lê os <channel> da fonte XMLTV: id da fonte -> nome canônico. */
function parseSourceChannels(xmltv) {
  const map = new Map()
  const re = /<channel\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/gi
  let m
  while ((m = re.exec(xmltv)) !== null) {
    const dn = m[2].match(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/i)
    if (dn) map.set(m[1], canonName(decodeEntities(dn[1])))
  }
  return map
}

/**
 * Monta o XMLTV dos canais informados a partir de fontes XMLTV externas,
 * casando por id direto ou por nome canônico. Janela de tempo limitada, teto de
 * programas por canal e orçamento de tempo (o resto fica para o próximo build).
 * @param {{ epgId:string, name:string }[]} channels
 * @param {{ url:string, format?:string }[]} sources
 */
async function buildXmltv(channels, sources) {
  if (!channels?.length || !sources?.length) return EMPTY_XMLTV

  // Índices dos nossos canais: id direto e nome canônico -> epgId.
  const idSet = new Set(channels.map(c => c.epgId))
  const nameToEpg = new Map()
  const nameByEpg = new Map()
  for (const c of channels) {
    nameByEpg.set(c.epgId, c.name)
    const key = canonName(c.name)
    if (key && !nameToEpg.has(key)) nameToEpg.set(key, c.epgId)
  }

  const deadline = Date.now() + XMLTV_BUILD_BUDGET_MS
  const since = Date.now() - XMLTV_WINDOW_BACK_MS
  const until = Date.now() + XMLTV_WINDOW_FWD_MS
  const programsByEpg = new Map() // epgId -> [{title,start,stop}]
  let used = 0

  for (const source of sources) {
    if (used++ >= XMLTV_MAX_SOURCES || Date.now() > deadline) break
    const raw = await getRaw(source)
    if (!raw) continue

    // id-da-fonte -> epgId (via id direto ou nome canônico do <display-name>).
    const srcToEpg = new Map()
    for (const [srcId, cname] of parseSourceChannels(raw)) {
      if (idSet.has(srcId)) {
        srcToEpg.set(srcId, srcId)
        continue
      }
      const epgId = nameToEpg.get(cname) || nameToEpg.get(canonFromId(srcId))
      if (epgId) srcToEpg.set(srcId, epgId)
    }

    const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi
    let m
    while ((m = re.exec(raw)) !== null) {
      const ch = (m[1].match(/\bchannel="([^"]*)"/i) || [])[1]
      const epgId = ch && srcToEpg.get(ch)
      if (!epgId) continue
      const start = parseXmltvDate((m[1].match(/\bstart="([^"]*)"/i) || [])[1])
      if (!start || start < since || start > until) continue
      const arr = programsByEpg.get(epgId)
      if (arr && arr.length >= XMLTV_MAX_PROGS_PER_CH) continue
      const stop = parseXmltvDate((m[1].match(/\bstop="([^"]*)"/i) || [])[1])
      const titleMatch = m[2].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
      const title = titleMatch ? decodeEntities(titleMatch[1]) : ''
      if (!title) continue
      if (arr) arr.push({ title, start, stop })
      else programsByEpg.set(epgId, [{ title, start, stop }])
    }
  }

  const channelTags = []
  const programmeTags = []
  for (const [epgId, programs] of programsByEpg) {
    if (!programs.length) continue
    programs.sort((a, b) => a.start - b.start)
    channelTags.push(
      `  <channel id="${xmlAttr(epgId)}"><display-name>${xmlText(nameByEpg.get(epgId) || epgId)}</display-name></channel>`
    )
    for (const p of programs) {
      programmeTags.push(
        `  <programme start="${formatXmltvDate(p.start)}" stop="${formatXmltvDate(
          p.stop || p.start + 3600_000
        )}" channel="${xmlAttr(epgId)}"><title lang="pt">${xmlText(p.title)}</title></programme>`
      )
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<tv generator-info-name="iptv-web">\n' +
    channelTags.join('\n') +
    (channelTags.length ? '\n' : '') +
    programmeTags.join('\n') +
    (programmeTags.length ? '\n' : '') +
    '</tv>\n'
  )
}

/**
 * XMLTV cacheado (3 h). Devolve o cache imediatamente e, se vencido, dispara um
 * novo build em segundo plano — o request nunca espera o download.
 */
function getXmltvCached(channels, sources) {
  const fresh = xmltvCache.xml && Date.now() - xmltvCache.at < XMLTV_TTL_MS
  if (!fresh && !xmltvBuilding) {
    xmltvBuilding = true
    buildXmltv(channels, sources)
      .then(xml => {
        xmltvCache = { at: Date.now(), xml }
      })
      .catch(() => {})
      .finally(() => {
        xmltvBuilding = false
      })
  }
  return xmltvCache.xml || EMPTY_XMLTV
}

/** Limpa os caches (chamado no /api/reload). */
function clearCache() {
  rawCache.clear()
  resultCache.clear()
  xmltvCache = { at: 0, xml: null }
}

export default { getNowNext, getXmltvCached, clearCache }
