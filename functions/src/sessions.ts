// Upcoming repair sessions, for rebooking a Needs follow-up item. Only
// sessions listed on Restarters are offered, so a cancelled Saturday never
// appears. Restarters is usually filled in about four weeks ahead.
import type {RestartersEvent} from "./restarters";
import {londonDate} from "./restarters";

export type UpcomingSession = {date: string; title: string};

// Events after today, soonest first, one per day (YYYY-MM-DD, UK).
export const upcomingSessions = (
  events: RestartersEvent[],
  today: string,
): UpcomingSession[] => {
  const byDate = new Map<string, string>();
  for (const e of events) {
    const date = londonDate(new Date(e.start));
    if (date > today && !byDate.has(date)) byDate.set(date, e.title);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, title]) => ({date, title}));
};
