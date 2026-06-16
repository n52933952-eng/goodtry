import { apiService } from '../services/api';
import { ENDPOINTS } from './constants';

export interface GameOpponentUser {
  _id: string;
  name: string;
  username: string;
  profilePic?: string;
}

/** Following + followers from Follow collection (`/following`, `/followers`). */
export async function fetchOnlineGameOpponents(
  currentUserId: string,
  isUserOnline: (userId: string) => boolean,
  busyChessUserIds: string[],
  busyCardUserIds: string[],
): Promise<GameOpponentUser[]> {
  const [followingList, followersList] = await Promise.all([
    apiService.get(ENDPOINTS.GET_FOLLOWING_USERS).catch(() => []),
    apiService.get(ENDPOINTS.GET_FOLLOWERS_USERS).catch(() => []),
  ]);

  const byId = new Map<string, GameOpponentUser>();
  const addUser = (u: unknown) => {
    const row = u as { _id?: string; name?: string; username?: string; profilePic?: string };
    if (!row?._id) return;
    const id = String(row._id);
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return;
    if (!byId.has(id)) {
      byId.set(id, {
        _id: id,
        name: row.name || row.username || 'User',
        username: row.username || '',
        profilePic: row.profilePic,
      });
    }
  };

  if (Array.isArray(followingList)) followingList.forEach(addUser);
  if (Array.isArray(followersList)) followersList.forEach(addUser);

  const myId = String(currentUserId);
  const busyChess = new Set(busyChessUserIds);
  const busyCard = new Set(busyCardUserIds);

  return [...byId.values()].filter((u) => {
    if (u._id === myId) return false;
    if (!isUserOnline(u._id)) return false;
    if (busyChess.has(u._id) || busyCard.has(u._id)) return false;
    return true;
  });
}
