# Design System — IPTV Web

Regras de design da interface (área de acesso: catálogo + player). Foco em um
visual **moderno, escuro por padrão**, com identidade voltada ao **público
brasileiro**. Tudo é implementado com **CSS custom properties** (tokens) em
`public/css/styles.css`, alternadas por `[data-theme]` no `<html>`.

> Princípio nº 1: **toda cor, raio, sombra e espaçamento sai de um token.**
> Não usar valores "mágicos" hardcoded em componentes novos — adicione/usar um
> token. Assim o tema claro/escuro e ajustes globais ficam consistentes.

## Temas

Dois temas, trocados por `data-theme="dark|light"` (persistido em
`localStorage` na chave `iptv-theme`). `dark` é o padrão. Cada tema redefine o
mesmo conjunto de tokens.

## Tokens

### Superfícies

| Token         | Uso                                              |
| ------------- | ------------------------------------------------ |
| `--bg`        | Fundo da página (sob os gradientes radiais)      |
| `--bg-elev`   | Superfície elevada (sidebar, hero, player)       |
| `--bg-elev-2` | Segundo nível de elevação                        |
| `--bg-card`   | Cards, inputs, selects, chips                    |
| `--glass`     | Fundo translúcido (topbar/fav com `backdrop`)    |

### Borda / texto

`--border`, `--border-soft`, `--border-strong` · `--text`, `--text-dim`,
`--text-mute`.

### Acentos

| Token            | Uso                                                |
| ---------------- | -------------------------------------------------- |
| `--accent`       | Cor primária (foco, links, badges)                 |
| `--accent-2`     | Segunda cor do gradiente                           |
| `--accent-3`     | Terceira cor (violeta) do gradiente                |
| `--accent-soft`  | Fundo suave de elementos de acento (badge, focus)  |
| `--accent-line`  | Borda/linha de acento                              |
| `--grad`         | Gradiente da marca (violeta → azul → ciano)        |
| `--grad-soft`    | Versão translúcida do gradiente (fundos)           |
| `--live`         | Vermelho "AO VIVO"                                 |
| `--warn`         | Avisos (selo de qualidade/aviso)                   |
| `--gold`         | Favorito (estrela)                                 |

### Loading

`--skeleton` (base do placeholder) · `--shimmer` (faixa que desliza).

### Raio

`--radius-sm` (10px) · `--radius` (14px) · `--radius-lg` (20px) ·
`--radius-pill` (999px).

### Elevação (sombra)

`--shadow-sm` · `--shadow` · `--shadow-glow` (brilho com a cor de acento — usado
em hover de cards/botões e no chip ativo).

### Espaçamento (escala 4px)

`--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 22 · `--sp-6` 32.

## Tipografia

- Fonte: `system-ui` stack (sem dependência externa → carregamento instantâneo e
  offline). Segoe UI (Windows), Roboto (Android), SF (Apple).
- Título do hero: `clamp(26px, 4.4vw, 40px)`, peso 800, `letter-spacing -0.025em`.
- Texto base: 15px / 1.55. Rótulos de filtro em maiúsculas com `letter-spacing`.

## Componentes

- **Topbar**: "vidro" (`--glass` + `backdrop-filter`), sticky.
- **Hero**: card elevado com gradiente suave, _eyebrow_ "Ao vivo · 100% grátis"
  (com ponto pulsante), título em gradiente e uma lista de **provas de
  confiança** (`.hero-trust`).
- **Chips**: filtros rápidos roláveis; ativo recebe `--grad` + `--shadow-glow`.
- **Card**: hover eleva (`translateY(-4px)`), borda de acento, filete superior em
  gradiente (`.card::after`) e `--shadow-glow`.
- **Skeleton**: `.card.skeleton` com caixas `.skel-box` (shimmer) durante o load.
- **Botões**: primário = `--grad`; `.btn-ghost` = contorno.
- **Selo AO VIVO** e **favorito** posicionados sobre o card.

## Movimento

Transições curtas (100–160ms, `ease`). Animações de destaque: `live-pulse`
(ponto AO VIVO) e `shimmer` (skeleton). **Tudo é desligado** sob
`prefers-reduced-motion: reduce`.

## Acessibilidade

- `:focus-visible` global com anel de `--accent`.
- Cards são `role="button"` com `aria-label`; sidebar e chips rotulados.
- Elementos puramente decorativos usam `aria-hidden="true"`.
- Contraste de texto mantido em ambos os temas.

## Como evoluir

1. Precisa de uma cor/medida nova? Adicione um **token** no `:root` e no
   `[data-theme='light']`.
2. Reutilize classes/utilitários existentes antes de criar novos.
3. Atualize este arquivo quando adicionar um token ou componente.
4. Ao mexer no app shell (CSS/JS/HTML), **suba a versão do cache** em
   `public/sw.js` (`iptv-web-vN`) para os usuários receberem a atualização.
