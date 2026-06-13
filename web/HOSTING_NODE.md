# Deploy do app Node (Hostinger / qualquer host Node) a partir do GitHub

O app é um servidor **Node.js (Express, ESM)** que fica em **`web/`** dentro do
repositório. Para rodar do GitHub no Hostinger (VPS ou painel com Node), use as
configurações abaixo.

## ⚠️ O ponto nº 1: a pasta da aplicação é `web/`
O repositório é o fork do iptv-org; o app vive em **`web/`**. Ao configurar o
deploy/app Node, defina o **diretório raiz da aplicação como `web`** (não a raiz
do repo). É o erro mais comum.

## Configuração

| Campo | Valor |
| --- | --- |
| Repositório | `ThalesAndrades/iptv` · branch `master` |
| **App root / subpasta** | **`web`** |
| Versão do Node | **18+** (ideal 20 ou 22) |
| Instalar | `npm ci --omit=dev` (ou `npm install`) |
| Arquivo de início | `server.js` |
| Comando de start | `npm start` (= `node server.js`) |

O app escuta em `process.env.PORT` (o painel costuma injetar) e em `HOST=0.0.0.0`.

## Variáveis de ambiente (recomendadas)

Veja `.env.example` para a lista completa. As principais:

```
TRUST_PROXY=1            # atrás do proxy reverso do host (IP/HTTPS reais)
REFRESH_INTERVAL_MIN=360 # atualização do catálogo (min)
RELOAD_TOKEN=<segredo>   # habilita POST /api/reload
# Xtream / EPG / VOD: ver .env.example (XTREAM_*, EPG_XMLTV_URL, CATALOG_FILE, VOD_*)
```

## Requisitos do ambiente
- **Internet de saída** liberada: o app baixa os dados do iptv-org, o EPG (XMLTV)
  e o acervo de Filmes (Internet Archive), e o `/stream` faz proxy dos canais.
  Em VPS isso é padrão; em hospedagem muito restrita pode ser bloqueado.
- ~256–512 MB de RAM bastam; o catálogo fica em memória.

## Domínio e HTTPS
- Aponte seu domínio/subdomínio (ex.: `tv.seudominio.com`) para o app pelo painel
  do Hostinger. Em **VPS**, use o **Caddy** (HTTPS automático) ou o Nginx como
  proxy reverso na porta do app.
- Healthcheck: `GET /healthz` → `200` quando os dados carregaram.

## Atualizar
- Se o deploy do Hostinger acompanha o GitHub, cada push no `master` republica.
- Senão, use o botão de redeploy/pull do painel após o push.

## Conteúdo
Use apenas conteúdo que você tem direito de distribuir (canais públicos do
iptv-org, domínio público, produção própria ou licenciado). O catálogo próprio
de Filmes/Séries fica em `data/catalog.json`.
