# GestFi — Finanças Pessoais

Aplicação web pessoal de gestão de finanças: contas, movimentos, categorias,
etiquetas e orçamentos mensais. Sem ligação a bancos — os movimentos são
inseridos à mão.

HTML, CSS e JavaScript puro, sem passo de compilação. Base de dados e
autenticação na Supabase. Instalável como PWA no telemóvel e no PC.

## Segurança

O código é público; os dados não são.

- **Row Level Security** ativo nas 6 tabelas, com políticas que restringem
  todas as operações a `auth.uid() = user_id`. É esta a proteção real dos
  dados — não o repositório ser público ou privado.
- A chave em `js/supabaseClient.js` é a **publishable** (equivalente moderno da
  antiga `anon key`), desenhada para ser exposta em clientes públicos. A chave
  `sb_secret_` / `service_role` **nunca** entra neste repositório.
- **Registo público desativado** no projeto Supabase: não há forma de criar
  contas novas.
- **MFA (TOTP) obrigatório** — a aplicação só mostra dados com a sessão em AAL2.
- As funções de agregação são `security invoker`, por isso o RLS continua a
  aplicar-se dentro delas. Se fossem `security definer` ignoravam-no.
- `Site URL` e `Redirect URLs` restritos ao domínio de publicação.
- Sem proteção contra palavras-passe vazadas (exige plano Pro). Compensado com
  uma palavra-passe aleatória longa mais o MFA.

## Execução local

```
python -m http.server 5500
```

E abrir <http://localhost:5500>.

## Publicação no GitHub Pages

O repositório <https://github.com/tonyaze94/GestFiPersonal> já é público, tem o
GitHub Pages ativo e a branch `main` como origem.

```
git push -u origin main
```

Um a dois minutos depois a aplicação fica em
<https://tonyaze94.github.io/GestFiPersonal/>.

Se o remote ainda não estiver ligado:

```
git remote add origin https://github.com/tonyaze94/GestFiPersonal.git
```

Para publicar noutro sítio (Vercel, Netlify), basta servir a pasta como
estática — não há build nem servidor. Nesse caso é preciso acrescentar o novo
domínio às `Redirect URLs` da Supabase.

## Base de dados

`sql/schema.sql` corre no SQL Editor da Supabase e cria tudo: tabelas, índices,
triggers, políticas de RLS e as funções de agregação (`rpc_account_balances`,
`rpc_month_summary`, `rpc_category_spend`, `rpc_tag_spend`).

## Estrutura

```
index.html            estrutura e ecrã de entrada
manifest.json         instalação como PWA
service-worker.js     cache dos ficheiros estáticos
css/style.css         tema escuro único
js/supabaseClient.js  URL e chave do projeto (ponto único de configuração)
js/format.js          formatação de dinheiro e datas
js/ui.js              utilitários de interface
js/modal.js           janelas de diálogo
js/db.js              acesso a dados e agregações
js/auth.js            entrada, MFA e sessão
js/app.js             arranque e encaminhamento
js/dashboard.js       ecrã Resumo
js/transactions.js    ecrã Movimentos
js/budgets.js         ecrã Orçamento
js/accounts.js        ecrã Contas
js/categories.js      ecrã Categorias
js/tags.js            ecrã Etiquetas
js/charts.js          gráficos (Chart.js)
sql/schema.sql        esquema completo
```

## Notas de implementação

- **Formato monetário**: separador de milhares `,` e decimal `.`
  (`1,234.56 €`), por escolha deliberada, ao contrário do costume português.
  Está centralizado em `formatMoney()` — não usar `toLocaleString('pt-PT')`.
- **Entrada / Saída**: a interface nunca fala em "receita" ou "despesa", porque
  numa conta de investimentos o dinheiro que entra é um custo e o que sai é
  lucro. Na base de dados os valores continuam `receita` e `despesa`; a
  tradução está em `TIPOS_CATEGORIA`, em `js/db.js`.
- **Agregações**: todas as somas por conta, mês, categoria e etiqueta são
  feitas em Postgres, nunca em JavaScript depois de trazer os movimentos todos.
- **Ocultar da análise**: um movimento oculto continua a contar para o saldo da
  conta — é dinheiro que se moveu — mas fica de fora dos totais do mês, dos
  gráficos e da comparação com o orçamento.
