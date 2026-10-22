# Protótipo estático — vdkids / Kyrios (PT)

## Por que o index.html “não abre”?

Se você der **duplo clique** no `index.html`, o Chrome tenta ir para `C:/pt-br/` e mostra **ERR_FILE_NOT_FOUND**.

Isso é normal: o site usa caminhos absolutos (`/pt-br/`, `/_next/…`). No protocolo `file://` o Windows trata `/pt-br/` como pasta na unidade C:, que não existe.

**Não abra pelo Explorer.** Use um servidor local (abaixo).

## Windows (mais fácil)

1. Copie a pasta `vdkids-pt` (ou descompacte o zip) para o PC  
2. Dê duplo clique em **`ABRIR-WINDOWS.bat`**  
3. O navegador abre em http://127.0.0.1:4173/pt-br/  
4. Deixe a janela preta aberta enquanto usar o site  

(Precisa ter [Node.js](https://nodejs.org) instalado.)

## Manual (qualquer OS)

```bash
cd vdkids-pt
npx --yes serve -l 4173 .
```

Abra: http://127.0.0.1:4173/pt-br/

No repo `site-cloner`:

```bash
npm run serve -- ./prototypes/vdkids-pt
```

## Copiar para outro repo

Leve a pasta inteira `vdkids-pt` (ou `vdkids-pt-frontend.zip`).  
Lá, use o mesmo `ABRIR-WINDOWS.bat` ou `npx serve`.

## Limite

É espelho HTML + assets (front). Animações funcionam **com o servidor**.  
Não é o código-fonte Next.js editável como app.
