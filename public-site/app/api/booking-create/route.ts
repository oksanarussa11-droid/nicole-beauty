import { notifyAdmin } from '@/lib/telegram';

function escapeMarkdownV2(text: string): string {
  return String(text || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const body = await req.json();
    
    if (!body.client_name || !body.client_contact) {
      return Response.json({ error: 'Name and contact required' }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    // Rate limit check: count requests from IP in last minute
    const limitRes = await fetch(`${url}/rest/v1/booking_requests?ip=eq.${ip}&created_at=gte.${new Date(Date.now() - 60000).toISOString()}`, {
      headers: {
        'apikey': serviceRole!,
        'Authorization': `Bearer ${serviceRole}`,
        'Range-Unit': 'items'
      }
    });
    const limitData = await limitRes.json();
    if (limitData.length >= 5) {
      return Response.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Insert record
    const insertData = {
      service_id: body.service_id,
      service_name: body.service_name,
      master_id: body.help_choosing ? null : body.master_id,
      master_name: body.help_choosing ? 'Помогите выбрать' : body.master_name,
      help_choosing: body.help_choosing || false,
      preferred_day: body.preferred_day,
      preferred_period: body.preferred_period,
      client_name: body.client_name.substring(0, 100),
      client_contact: body.client_contact.substring(0, 100),
      contact_method: body.contact_method,
      notification_consent_at: body.notification_consent === true ? new Date().toISOString() : null,
      notification_consent_version: body.notification_consent === true ? 'reminders-v1' : null,
      note: body.note ? body.note.substring(0, 500) : null,
      ip,
      user_agent: req.headers.get('user-agent') || 'unknown'
    };

    const res = await fetch(`${url}/rest/v1/booking_requests`, {
      method: 'POST',
      headers: {
        'apikey': serviceRole!,
        'Authorization': `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(insertData)
    });
    
    if (!res.ok) throw new Error('DB insert failed');
    const inserted = await res.json();
    
    // Notify Admin
    const msg = `${escapeMarkdownV2('*Новая заявка с сайта* 💅')}\n\n` +
      `👤 Клиент: ${escapeMarkdownV2(insertData.client_name)}\n` +
      `📞 Контакт: ${escapeMarkdownV2(insertData.client_contact)} ${escapeMarkdownV2('(')}${escapeMarkdownV2(insertData.contact_method)}${escapeMarkdownV2(')')}\n\n` +
      `✂️ Услуга: ${escapeMarkdownV2(insertData.service_name || '?')}\n` +
      `👩‍🎨 Мастер: ${escapeMarkdownV2(insertData.master_name)}\n` +
      `📅 Желаемое время: ${escapeMarkdownV2(insertData.preferred_day || '?')} / ${escapeMarkdownV2(insertData.preferred_period || '?')}\n` +
      (insertData.note ? `📝 Комментарий: ${escapeMarkdownV2(insertData.note)}` : '');
      
    await notifyAdmin(msg);

    return Response.json({ ok: true, id: inserted[0].id });
  } catch (err: unknown) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
