# site-cloner

Clonador **local, auditável e sem telemetria** — HTML renderizado + CSS/JS/imagens para arquivo offline.

```bash
npm install
npm run install:browser
npm run validate
npm run clone -- https://vdkids.com.br/ --depth 2
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
| `--wait MS` | `1500` | 0–30000 |

## Uso responsável

Só em sites seus, autorizados, ou arquivo pessoal offline. Não republicar cópia alheia.

## Licença

MIT
