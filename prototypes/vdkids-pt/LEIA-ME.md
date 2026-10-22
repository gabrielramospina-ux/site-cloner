# Prototipo estatico — vdkids / Kyrios (PT)

## Windows (certo)

1. Descompacte o zip (pasta `vdkids-pt-frontend`)
2. Entre na pasta que tem `ABRIR-WINDOWS.bat` e `servidor.mjs`
3. Duplo clique em **ABRIR-WINDOWS.bat**
4. Deixe a janela preta aberta
5. O site abre em http://127.0.0.1:4173/pt-br/

Precisa de Node.js: https://nodejs.org

## Por que deu 404 / conexao recusada?

- `npx serve` **nao** mapeia `/_next` e `/brand` → tudo 404. Use o `ABRIR-WINDOWS.bat` (ele roda `servidor.mjs`).
- Se fechar a janela preta, o Chrome mostra **ERR_CONNECTION_REFUSED**.

## Nao abra o index.html no Explorer

Duplo clique no HTML faz o Chrome ir para `C:/pt-br/` e falha.

## Manual

```bash
cd vdkids-pt-frontend
node servidor.mjs
```
