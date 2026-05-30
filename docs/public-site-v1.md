# Nicole Beauty — Site público · v1 (one-pager)

> Capture do brainstorm de produto (2026-05-29). Base de construção do site público voltado a clientes — separado do sistema interno de gestão.

## Objetivo
Converter o curioso (que veio de Instagram / 2gis / Telegram) em **solicitação de agendamento**, passando credibilidade e profissionalismo — **sem perder o toque humano**.

**Reframe central:** o site **não** é ímã de descoberta. A descoberta já acontece em Instagram, Telegram, 2gis.ru, WhatsApp e telefone. O site é a **camada de conversão + prova de credibilidade** + presença em busca (Yandex, não Google — mercado russo).

### Não-objetivos (v1)
Agendamento em tempo real · pagamento online · login/conta de cliente · lembretes automáticos (admin confirma na mão) · blog · idiomas além do russo.

## Público & contexto
- **Mercado/idioma:** Rússia, **russo**. Texto revisado por falante nativa ao vivo (risco de credibilidade neutralizado na fonte).
- **Canais de descoberta existentes:** Instagram, Telegram, 2gis.ru, WhatsApp, telefone.
- **Cliente escolhe a profissional específica** (vinda do DB atual), com a opção *«не знаю, кого выбрать — помогите»* para não travar o cliente novo, que ainda não conhece ninguém.

## Métrica de sucesso
- **Primária:** nº de **solicitações/mês** vindas do site (contadas pelo bot).
- **Secundária:** funil de tráfego no **Yandex.Metrica** (view da landing → clique no CTA → pedido enviado).

## Arquitetura em uma frase
Site **lê** serviços + profissionais do **Supabase existente**; **escreve** o pedido via **bot de Telegram** (que registra a solicitação e avisa a admin). Nenhuma segunda fonte de verdade.

## Fluxo do pedido (o coração) — Modelo B com bot
1. Cliente monta na página: **serviço** → **profissional** (ou *«помогите выбрать»*) → **horário preferido** (dia + período — é pedido, não slot exato) → **nome + contato** (+ observação opcional).
2. Dois botões de envio:
   - **«Записаться через Telegram»** → deep-link `t.me/<bot>?start=<payload>`: abre o Telegram, o bot confirma à cliente e **avisa a admin** com tudo preenchido.
   - **«Написать в WhatsApp»** → `wa.me/<num>?text=…` com a mensagem montada (alternativa pra quem prefere WhatsApp).
3. O bot **grava cada pedido** numa tabela `booking_requests` no Supabase → isto **É** a métrica primária, e de quebra vira um registro estruturado leve (Model C de graça). A admin dá a sequência humana onde já trabalha.

> **Por que bot e não só links?** O WhatsApp pré-preenche mensagem (`wa.me?text=`); o Telegram **não** pré-preenche um chat normal de usuário. O bot resolve o pré-preenchimento, **conta as solicitações de verdade** (não só cliques) e mantém o atendimento dentro do Telegram, onde a admin já vive.

## Estrutura de páginas
- **Landing única, mobile-first, em rolagem** (≈todo o tráfego vem do celular), com CTA **«Записаться»** sempre alcançável. Ordem = pilha de confiança:
  herói → galeria/prova → profissionais → serviços + preços → interior → reviews (2gis/Yandex) → mapa/como chegar → contato.
- **Páginas de profundidade:** catálogo completo de serviços + preços · perfil de cada profissional (foto, especialidade, portfólio dela, botão "pedir com ela") · galeria completa.

## Conteúdo / prova
Fotos reais tratadas (já disponíveis): **antes/depois, organizadas por serviço, ligadas à profissional que fez** — a galeria é o funil, não decoração. Retrato + bio curta de cada mestra. Reviews de terceiros (2gis/Yandex) valem mais que autoelogio.

## Stack / integrações
- **Frontend:** alinhar ao repo atual — **HTML/CSS/JS estático** (consistente com `index.html`, `register.html`, etc.), ótimo para SEO. *Opção:* app Next.js dedicado se quisermos SSR/templating — decisão do plano de implementação.
- **Backend:** função serverless em `/api` (webhook do bot de Telegram).
- **Dados:** Supabase existente — read de serviços/profissionais; nova tabela `booking_requests` (write).
- **Bot:** Telegram Bot API.
- **Analytics:** **Yandex.Metrica** (padrão russo; mapa de calor + replay de sessão).

## Fora de escopo v1 (consciente)
Tempo real · pagamento · conta de cliente · lembretes automáticos · blog · multi-idioma.

## Maior incógnita + teste mais barato
*"O handoff via bot soa confiável pra cliente russa, e a admin acompanha o ritmo?"*
→ **Soft-launch:** publicar a landing, pôr o link no bio do Instagram + no 2gis, e observar o funil no Yandex.Metrica por ~2–3 semanas **antes** de investir em SEO/expansão.

## Próximos passos
1. Decidir frontend (estático vs Next.js).
2. Plano de implementação: schema `booking_requests` → bot de Telegram (`/api`) → landing → páginas de profundidade → Yandex.Metrica.
3. Soft-launch + leitura do funil.
