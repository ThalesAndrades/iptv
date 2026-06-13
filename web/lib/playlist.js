// Geração de playlist M3U (lista de canais) consumível por apps de IPTV de TV
// — IPTV Smarters, Smart IPTV, TiViMate, OTT Navigator, IBO, etc.
//
// Por padrão usa a URL DIRETA de cada stream: apps nativos não têm restrição de
// CORS/mixed-content (ao contrário do navegador) e isso poupa a banda do nosso
// servidor. Com `useProxy`, roteia tudo pelo /stream (resolve headers/HTTPS,
// mas consome banda do servidor).

/** Remove quebras de linha e espaços nas pontas (não pode corromper o M3U). */
function oneLine(value) {
  return String(value == null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/** Valor seguro para atributo entre aspas: sem aspas duplas nem quebras. */
function attr(value) {
  return oneLine(value).replace(/"/g, "'")
}

/**
 * Monta o texto de uma playlist M3U a partir de uma lista de streams
 * normalizados (ver lib/data.js).
 *
 * @param {Array} streams
 * @param {object} opts
 * @param {string} [opts.baseUrl]  Origem pública (ex.: https://meusite) — usada quando useProxy.
 * @param {boolean} [opts.useProxy=false]  Roteia as URLs pelo /stream.
 * @param {'category'|'country'} [opts.group='category']  Como agrupar (group-title).
 */
export function buildM3U(streams, { baseUrl = '', useProxy = false, group = 'category' } = {}) {
  const lines = ['#EXTM3U']

  for (const s of streams) {
    if (!s || !s.url) continue

    const name = oneLine(s.name || s.channelName || 'Sem nome')
    const tvgId = attr(s.channel || '')
    const tvgLogo = attr(s.logo || '')
    const groupTitle = attr(
      group === 'country'
        ? s.country?.name || 'Geral'
        : s.categories?.[0]?.name || s.country?.name || 'Geral'
    )

    lines.push(
      `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${attr(name)}" tvg-logo="${tvgLogo}" ` +
        `group-title="${groupTitle}",${name}`
    )

    // Headers que alguns streams exigem (suportado pela maioria dos players).
    if (s.referrer) lines.push(`#EXTVLCOPT:http-referrer=${oneLine(s.referrer)}`)
    if (s.userAgent) lines.push(`#EXTVLCOPT:http-user-agent=${oneLine(s.userAgent)}`)

    let url = oneLine(s.url)
    if (useProxy && baseUrl) {
      const params = new URLSearchParams({ url: s.url })
      if (s.referrer) params.set('ref', s.referrer)
      if (s.userAgent) params.set('ua', s.userAgent)
      url = `${baseUrl}/stream?${params.toString()}`
    }
    lines.push(url)
  }

  return lines.join('\n') + '\n'
}

export default { buildM3U }
