# Segurança

## Veredito

Este projeto é **seguro para uso local** se você:

1. Clonar deste repositório (código aberto, auditável)
2. Rodar `npm run validate` após `npm install`
3. Só apontar para URLs que você tem direito de arquivar

## O que ele faz / não faz

| Faz | Não faz |
|---|---|
| Abre Chromium local (Playwright) | Enviar URLs ou HTML para servidores nossos |
| Baixa HTML/CSS/JS/imagens do site alvo | Instalar websnap ou pacotes opacos |
| Grava só dentro da pasta `--out` | Executar shell remoto / telemetria |
| Limita depth, páginas e tamanho de asset | Aceitar `file://`, `ftp://`, etc. |

## Riscos residuais (normais em qualquer browser headless)

- O site alvo pode servir JS malicioso **dentro do Chromium isolado** (igual abrir no Chrome).
- Assets de CDN de terceiros que o site carregar também são salvos localmente.
- Não use em sites autenticados com dados sensíveis sem isolamento extra (VM/container).

## websnap (uirip) — não use

- GitHub sem código-fonte (só README)
- `npm i websnap` = pacote errado de 2014
- Pipeline ui.rip envia captura a servidor proprietário

## Validar

```bash
npm install
npm run install:browser
npm run validate
```
