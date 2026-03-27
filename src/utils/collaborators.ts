/** Usernames excluded from collaborator pick / search (channels & system accounts). */
export const SYSTEM_COLLABORATOR_USERNAMES = new Set([
  'Weather',
  'Football',
  'AlJazeera',
  'NBCNews',
  'BeinSportsNews',
  'SkyNews',
  'Cartoonito',
  'NatGeoKids',
  'SciShowKids',
  'JJAnimalTime',
  'KidsArabic',
  'NatGeoAnimals',
  'MBCDrama',
  'Fox11',
]);

export type CollaboratorUser = {
  _id: string;
  name?: string;
  username?: string;
  profilePic?: string;
  bio?: string;
};

export function buildInitialContributorIds(
  creatorId: string | undefined,
  extra: CollaboratorUser[]
): string[] {
  if (!creatorId) return [];
  const ids = new Set<string>();
  ids.add(String(creatorId));
  extra.forEach((u) => {
    const id = String(u._id);
    if (id && id !== String(creatorId)) ids.add(id);
  });
  return Array.from(ids);
}
