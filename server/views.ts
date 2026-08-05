import type { PublicUser } from '../shared/types';
import { db, type UserRow } from './db';
import { masterByVkId } from './masters';

export function toPublicUser(user: UserRow): PublicUser {
  const visits = db
    .prepare(`SELECT COUNT(*) AS count FROM bookings WHERE user_id = ? AND status = 'completed'`)
    .get(user.id) as { count: number };

  const master = masterByVkId(user.vk_id);

  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    photo: user.photo,
    phone: user.phone,
    bonusPercent: user.bonus_percent,
    vkMessagesAllowed: Boolean(user.vk_messages_allowed),
    visitsCount: visits.count,
    masterId: master?.id ?? null,
    masterName: master?.name ?? null,
  };
}
