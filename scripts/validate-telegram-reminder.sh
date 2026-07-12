#!/usr/bin/env bash

set -euo pipefail

PHONE="${1:-}"
if [[ ! "$PHONE" =~ ^\+[1-9][0-9]{7,14}$ ]]; then
  echo "Uso: $0 +5548991980411" >&2
  exit 2
fi

SQL="select net.http_post(
  url := 'https://nicole-beauty.vercel.app/api/appointment-reminders',
  headers := jsonb_build_object(
    'Authorization',
    'Bearer ' || coalesce((
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'appointment_reminder_cron_secret'
      limit 1
    ), ''),
    'Content-Type', 'application/json'
  ),
  body := jsonb_build_object(
    'action', 'validate_telegram_reminder',
    'phone', '${PHONE}'
  ),
  timeout_milliseconds := 15000
) as request_id"

REQUEST_ID=$(supabase db query --linked --agent=no --output csv "$SQL" | tail -n 1 | tr -d '\r')
if [[ ! "$REQUEST_ID" =~ ^[0-9]+$ ]]; then
  echo "Não foi possível iniciar a validação no Supabase." >&2
  exit 1
fi

for _ in {1..15}; do
  RESULT=$(supabase db query --linked --agent=no --output csv \
    "select status_code || '|' || encode(convert_to(content::text, 'UTF8'), 'base64') from net._http_response where id = ${REQUEST_ID}" \
    | tail -n 1 | tr -d '\r')
  if [[ "$RESULT" == *"|"* ]]; then
    STATUS="${RESULT%%|*}"
    PAYLOAD_B64="${RESULT#*|}"
    PAYLOAD=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "base64").toString("utf8"))' "$PAYLOAD_B64")
    echo "$PAYLOAD" | jq .
    if [[ "$STATUS" == "200" ]]; then
      echo "Validação concluída: lembrete de teste enviado por Telegram."
      exit 0
    fi
    echo "Validação não enviada (HTTP ${STATUS})." >&2
    exit 1
  fi
  sleep 1
done

echo "Timeout aguardando a resposta da função de lembretes." >&2
exit 1
