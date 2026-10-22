# Protótipo estático — vdkids / Kyrios (PT)

Espelho do front em `https://vdkids.com.br/pt-br/` para referência e edição local.

## Abrir

Na raiz do `site-cloner`:

```bash
npm run serve -- ./prototypes/vdkids-pt
```

Abra http://127.0.0.1:4173/pt-br/

Ou descompacte/use a pasta direto com qualquer servidor estático (`npx serve`).

## O que dá para editar

- Textos e markup em `pt-br/**/index.html`
- Imagens/logos em `_assets/vdkids.com.br/brand` e `media`
- CSS em `_assets/.../_next/static/chunks/*.css` (com cuidado)

## Limite

Isto **não** é o código-fonte Next.js. Scripts `/_next` esperam hidratação; mudanças grandes em HTML podem quebrar animações/JS. Para um app editável de verdade, recrie o front no outro repo usando esta pasta como referência visual/conteúdo.

Arquivo único: `../vdkids-pt-frontend.zip`
