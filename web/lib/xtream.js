// Emulação mínima da Xtream Codes API — o login "host + usuário + senha" que
// muitos apps de IPTV (IPTV Smarters, IBO, Duplex…) chamam de "DNS".
//
// Cobre o necessário para TV AO VIVO:
//   GET /player_api.php            -> auth + categorias + lista de streams (JSON)
//   GET /live/:user/:pass/:id.ext  -> redireciona para o stream (via /stream)
//   GET /xmltv.php                 -> EPG XMLTV (mínimo; ver limitação)
// Não há VOD/séries (o catálogo é só canal ao vivo) — as ações respondem vazio.
//
// Autenticação: se XTREAM_USER/XTREAM_PASS estiverem definidos no ambiente,
// exige exatamente eles. Caso contrário (modo demo, catálogo público/gratuito),
// qualquer usuário/senha não-vazios são aceitos.

import { contextLabel, isBrazil } from './grouping.js'

/** Catálogo canônico: mesma ordem dos dados → stream_id estável. Sem adulto. */
function catalog(data) {
  return data.filtered({ includeNsfw: false })
}

/** Remove quebras de linha (não pode vazar para header Location/format). */
function clean(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Categorias ao vivo derivadas do contexto (Brasil por gênero; o resto em
 * "Internacionais"). Brasil primeiro; depois alfabético. Id numérico estável
 * por rótulo dentro de uma versão dos dados.
 */
function liveCategories(data) {
  const seen = new Map() // label -> isBr
  for (const s of catalog(data)) {
    const label = contextLabel(s)
    if (!seen.has(label)) seen.set(label, isBrazil(s))
  }
  const labels = [...seen.entries()]
    .map(([label, br]) => ({ label, br }))
    .sort((a, b) => (a.br !== b.br ? (a.br ? -1 : 1) : a.label.localeCompare(b.label, 'pt-BR')))
  return labels.map((l, i) => ({
    category_id: String(i + 1),
    category_name: l.label,
    parent_id: 0,
    _label: l.label
  }))
}

/** Mapa rótulo-de-contexto -> category_id numérico. */
function categoryIdByLabel(data) {
  return new Map(liveCategories(data).map(c => [c._label, c.category_id]))
}

/** Lista de streams ao vivo no formato Xtream (opcionalmente por categoria). */
function liveStreams(data, categoryId) {
  const idByLabel = categoryIdByLabel(data)
  const list = catalog(data)
  const out = []
  list.forEach((s, idx) => {
    if (!s.url) return
    const catId = idByLabel.get(contextLabel(s)) || '0'
    if (categoryId && String(categoryId) !== String(catId)) return
    out.push({
      num: idx + 1,
      name: clean(s.name),
      stream_type: 'live',
      stream_id: idx + 1, // = índice no catálogo (resolvido em /live)
      stream_icon: clean(s.logo || ''),
      epg_channel_id: clean(s.channel || ''),
      added: '0',
      category_id: catId,
      custom_sid: '',
      tv_archive: 0,
      direct_source: '',
      tv_archive_duration: 0
    })
  })
  return out
}

/** Resolve um stream_id (1-based) para o stream do catálogo, ou null. */
function resolveStream(data, streamId) {
  const idx = parseInt(streamId, 10) - 1
  if (!Number.isInteger(idx) || idx < 0) return null
  return catalog(data)[idx] || null
}

/** Confere as credenciais (ver regra de XTREAM_USER/PASS no topo). */
function checkAuth(username, password) {
  const U = process.env.XTREAM_USER
  const P = process.env.XTREAM_PASS
  if (U || P) return username === U && password === P
  return Boolean(username && password)
}

function userInfo(username, password) {
  return {
    username,
    password,
    message: '',
    auth: 1,
    status: 'Active',
    exp_date: null,
    is_trial: '0',
    active_cons: '0',
    created_at: '0',
    max_connections: '0',
    allowed_output_formats: ['m3u8', 'ts']
  }
}

function serverInfo(req) {
  const hostHeader = clean(req.get('host') || '')
  const host = hostHeader.split(':')[0]
  const proto = req.protocol === 'https' ? 'https' : 'http'
  return {
    url: host,
    port: proto === 'https' ? '443' : '80',
    https_port: '443',
    server_protocol: proto,
    rtmp_port: '0',
    timezone: 'America/Sao_Paulo',
    timestamp_now: Math.floor(Date.now() / 1000),
    time_now: new Date().toISOString().replace('T', ' ').slice(0, 19)
  }
}

/** Trata GET /player_api.php e devolve o objeto JSON de resposta. */
function handlePlayerApi(req, data) {
  const username = clean(req.query.username || '')
  const password = clean(req.query.password || '')
  if (!checkAuth(username, password)) {
    return { user_info: { auth: 0, status: 'Disabled' }, server_info: serverInfo(req) }
  }

  const action = typeof req.query.action === 'string' ? req.query.action : ''
  switch (action) {
    case '':
      return { user_info: userInfo(username, password), server_info: serverInfo(req) }
    case 'get_live_categories':
      return liveCategories(data).map(({ _label, ...c }) => c)
    case 'get_live_streams':
      return liveStreams(data, req.query.category_id)
    // Sem VOD/séries: respostas vazias para os apps não quebrarem.
    case 'get_vod_categories':
    case 'get_series_categories':
    case 'get_vod_streams':
    case 'get_series':
      return []
    default:
      return []
  }
}

/**
 * URL de destino para /live/:user/:pass/:id. Por padrão roteia pelo /stream
 * (aplica headers/HTTPS; mais confiável). XTREAM_DIRECT=1 usa a URL direta.
 */
function liveTarget(req, data, streamId) {
  const s = resolveStream(data, streamId)
  if (!s || !s.url) return null
  const direct = process.env.XTREAM_DIRECT === '1'
  if (direct) return clean(s.url)
  const base = `${req.protocol}://${clean(req.get('host') || '')}`
  const params = new URLSearchParams({ url: s.url })
  if (s.referrer) params.set('ref', s.referrer)
  if (s.userAgent) params.set('ua', s.userAgent)
  return `${base}/stream?${params.toString()}`
}

/**
 * Canais brasileiros para o EPG: um por id de canal (id + nome). O casamento
 * com a programação é feito por id/nome contra a fonte XMLTV externa.
 * @returns {{ epgId: string, name: string }[]}
 */
function brEpgChannels(data) {
  const seen = new Set()
  const out = []
  for (const s of catalog(data)) {
    if (!isBrazil(s) || !s.channel) continue
    if (seen.has(s.channel)) continue
    seen.add(s.channel)
    out.push({ epgId: s.channel, name: s.channelName || s.name })
  }
  return out
}

export default { handlePlayerApi, liveTarget, checkAuth, brEpgChannels }
