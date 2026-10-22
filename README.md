# site-cloner

Clonador **local, auditável e sem telemetria** — HTML renderizado + CSS/JS/imagens para arquivo offline.

## Começar (branch pronta para usar)

```bash
git clone -b release/site-cloner-dacd --single-branch \
  https://github.com/gabrielramospina-ux/cursor-design-kit.git site-cloner
cd site-cloner
npm install
npm run install:browser
npm run validate
npm run clone -- https://vdkids.com.br/ --depth 2
```

Para publicar como repositório GitHub próprio (o agent não tem permissão de criar repo novo):

```bash
gh repo create site-cloner --public --source=. --remote=origin --push
```

## Segurança (resumo)

| Pergunta | Resposta |
|---|---|
| É seguro usar **este** projeto? | **Sim**, para uso local — código aberto, 1 dependência (`playwright`), validação inclusa |
| É seguro o **websnap** (uirip)? | **Não** — GitHub sem código; `npm i websnap` instala pacote errado de 2014 |
| Envia dados para a internet (além do site alvo)? | **Não** |

Detalhes em [SECURITY.md](./SECURITY.md).

## Requisitos

- Node.js ≥ 20  
- (Opcional) Go ≥ 1.20 para Goclone

## Comandos

```bash
# SPA / Next.js (recomendado)
npm run clone -- https://exemplo.com --depth 2

# Servir o clone no localhost (mapeia /_next, /brand, /media → _assets/)
npm run serve -- ./output/vdkids
# → http://127.0.0.1:4173/

# Site estático (Goclone)
go install github.com/goclone-dev/goclone/cmd/goclone@latest
export PATH="$(go env GOPATH)/bin:$PATH"
npm run clone:goclone -- https://exemplo.com

# Revalidar o pacote
npm run validate
```

### Flags do Playwright

| Flag | Default | Limite |
|---|---|---|
| `--depth N` | `1` | 0–5 |
| `--out DIR` | `output/<host>-<data>` | — |
| `--max-pages N` | `30` | 1–100 |
| `--wait MS` | `800` | 0–30000 |
| `--wait-until` | `load` | `load` / `domcontentloaded` / `networkidle` |
| `--path-prefix /pt-br` | off | só crawla paths nesse prefixo (ex.: ignora `/en`) |
| `--no-scroll` | off | desliga scroll que dispara lazy-load/animações |

O clonador 1.3 captura **HTML SSR** (não o DOM pós-GSAP), baixa `srcset`, faz harvest paralelo de assets, mantém `/_next`·`/media`·`/brand` absolutos e serve no localhost para hidratar o Next.js.

Front Next (só PT), rápido:

```bash
npm run clone -- https://vdkids.com.br/pt-br/ \
  --depth 2 --max-pages 25 --path-prefix /pt-br \
  --wait-until load --wait 500 --out ./output/vdkids-pt
npm run serve -- ./output/vdkids-pt
```

## Uso responsável

Só em sites seus, autorizados, ou arquivo pessoal offline. Não republicar cópia alheia.

## Licença

MIT
